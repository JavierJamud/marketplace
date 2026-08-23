import { z } from "zod";
import bcrypt from "bcryptjs";
import jwt from "jsonwebtoken";
import { randomBytes, randomUUID } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { hashToken } from "../utils/hashToken.js";
import { sendPasswordResetEmail, sendTwoFactorCodeEmail, sendRegistrationCodeEmail, sendEmailChangeCodeEmail } from "../lib/email.js";

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días, ventana rodante (se extiende en cada refresh)
const TRUSTED_DEVICE_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 días, ventana rodante (se extiende en cada login saltado)

// Bloque 60: reemplaza el viejo signTokens(user) (JWT de refresco sin
// estado, imposible de revocar de verdad) — el refresh token pasa a ser un
// token opaco respaldado por la tabla Session, así que "cerrar sesión" (o
// "cerrar en todos los dispositivos") puede invalidarlo de verdad del lado
// del servidor. `browserId` identifica ESTE navegador (no la sesión
// puntual): un login nuevo revoca cualquier Session previa no revocada de
// ese mismo (userId, browserId) antes de crear la nueva — así nunca quedan
// dos sesiones activas en el mismo navegador. El access token sigue siendo
// un JWT corto (1h), pero ahora lleva `sid` (el id de la Session) para que
// `authenticate` pueda validarlo contra la DB en cada request (ver
// middleware/auth.js) — eso es lo que hace que una revocación tenga efecto
// inmediato en vez de esperar a que el access token expire solo.
async function createSession(user, browserId) {
  const resolvedBrowserId = browserId || randomUUID();
  await prisma.session.updateMany({
    where: { userId: user.id, browserId: resolvedBrowserId, revokedAt: null },
    data: { revokedAt: new Date() },
  });

  const refreshToken = randomBytes(48).toString("hex");
  const session = await prisma.session.create({
    data: {
      userId: user.id,
      browserId: resolvedBrowserId,
      refreshTokenHash: hashToken(refreshToken),
      expiresAt: new Date(Date.now() + SESSION_TTL_MS),
    },
  });

  const accessToken = jwt.sign({ sub: user.id, role: user.role, sid: session.id }, env.jwtSecret, { expiresIn: "1h" });
  return { accessToken, refreshToken };
}

// Bloque 60: genera y guarda un nuevo "dispositivo de confianza" para este
// usuario — se llama justo después de que probó ser dueño de la cuenta (2FA
// de login verificado, o registro recién verificado). Devuelve el token en
// texto plano UNA sola vez (el frontend lo guarda en localStorage); nunca
// se puede volver a leer después, solo re-validar su hash.
async function issueTrustedDevice(userId) {
  const deviceToken = randomBytes(32).toString("hex");
  await prisma.trustedDevice.create({
    data: { userId, tokenHash: hashToken(deviceToken), expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS) },
  });
  return deviceToken;
}

// Bloque 47: se suman los campos de 2FA a la lista de lo que nunca sale del
// servidor — mismo criterio que passwordHash, pero más sensible todavía
// (twoFactorCodeHash es el hash de un código de solo 6 dígitos, mucho más
// fuerza-bruteable que una contraseña real si se llegara a filtrar).
function publicUser(user) {
  const {
    passwordHash,
    resetCodeHash,
    resetCodeExpiresAt,
    twoFactorCodeHash,
    twoFactorCodeExpiresAt,
    pendingEmail,
    emailChangeCodeHash,
    emailChangeCodeExpiresAt,
    ...rest
  } = user;
  return rest;
}

// E.164 laxo (+5355512345) — el frontend siempre arma el string completo con
// PhoneInput/toE164(), esto es solo una validación de forma del lado servidor.
const E164_REGEX = /^\+\d{7,15}$/;

// Bloque 11: todos los campos de creación de cuenta son obligatorios (antes
// phone/country quedaban opcionales) — validado acá y en el frontend.
const registerSchema = z.object({
  email: z.string().email("Ingresá un correo electrónico válido."),
  password: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
  fullName: z.string().min(2, "Ingresá tu nombre completo."),
  phone: z.string().regex(E164_REGEX, "El teléfono debe incluir código de país (ej. +5355512345)."),
  country: z.string().length(2, "Seleccioná tu país."),
});

// Bloque 59 (pedido explícito): antes de crear la cuenta de verdad (cliente
// o vendedor — el registro de vendedor es este mismo endpoint + un POST
// /vendors después, así que gatearlo acá alcanza para los dos), hay que
// confirmar que el correo es real. Se manda un código de 6 dígitos y la
// cuenta recién se crea cuando ese código se verifica (ver
// verifyRegistration) — mientras tanto los datos del formulario viven en
// PendingRegistration (ver schema.prisma), nunca en un User a medio crear.
const REGISTER_CODE_LENGTH = 6;
const REGISTER_CODE_TTL_MINUTES = 10;

export async function register(req, res) {
  const data = registerSchema.parse(req.body);

  const existing = await prisma.user.findUnique({ where: { email: data.email } });
  // Nunca se puede registrar dos veces el mismo correo — en vez de un error
  // seco, `duplicate: true` en `details` le avisa al frontend que mande
  // directo al flujo de "olvidé mi contraseña" (ver Account.jsx).
  if (existing) {
    throw new AppError("Ya existe una cuenta con ese correo. Te ayudamos a restablecer tu contraseña.", 409, { duplicate: true });
  }

  const passwordHash = await bcrypt.hash(data.password, 10);
  const code = String(Math.floor(Math.random() * 10 ** REGISTER_CODE_LENGTH)).padStart(REGISTER_CODE_LENGTH, "0");
  const codeHash = await bcrypt.hash(code, 10);
  const codeExpiresAt = new Date(Date.now() + REGISTER_CODE_TTL_MINUTES * 60 * 1000);

  // upsert por email: si el cliente no recibió el código o se equivocó en
  // algún campo, reenviar el formulario simplemente pisa el intento anterior
  // con datos y código frescos — nunca queda "ya hay un registro pendiente"
  // como error que trabe un segundo intento.
  await prisma.pendingRegistration.upsert({
    where: { email: data.email },
    update: { passwordHash, fullName: data.fullName, phone: data.phone, country: data.country, codeHash, codeExpiresAt },
    create: { email: data.email, passwordHash, fullName: data.fullName, phone: data.phone, country: data.country, codeHash, codeExpiresAt },
  });

  await sendRegistrationCodeEmail({ fullName: data.fullName, email: data.email }, code);
  res.json({ requiresVerification: true, email: data.email });
}

const verifyRegistrationSchema = z.object({
  email: z.string().email("Ingresá un correo electrónico válido."),
  code: z.string().length(REGISTER_CODE_LENGTH, `El código debe tener ${REGISTER_CODE_LENGTH} dígitos.`),
  browserId: z.string().nullish(),
});

// Segundo paso del registro: recién ACÁ se crea el User real, a partir de lo
// guardado en PendingRegistration.
export async function verifyRegistration(req, res) {
  const { email, code, browserId } = verifyRegistrationSchema.parse(req.body);

  const pending = await prisma.pendingRegistration.findUnique({ where: { email } });
  const valid = pending && pending.codeExpiresAt.getTime() > Date.now() ? await bcrypt.compare(code, pending.codeHash) : false;
  if (!valid) throw new AppError("Código inválido o vencido.", 400);

  // Carrera improbable pero barata de chequear: la cuenta se creó por otro
  // medio mientras este código estaba pendiente.
  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError("Ya existe una cuenta con ese correo. Te ayudamos a restablecer tu contraseña.", 409, { duplicate: true });

  const { user, linkedOrdersCount } = await prisma.$transaction(async (tx) => {
    // Bloque 62: completar el registro ya es un "login" real (se emite
    // sesión de una) — cuenta como el primer acceso para el cron de
    // inactividad de vendedor si esta cuenta llega a crear una tienda.
    const created = await tx.user.create({
      data: {
        email: pending.email,
        passwordHash: pending.passwordHash,
        fullName: pending.fullName,
        phone: pending.phone,
        country: pending.country,
        lastLoginAt: new Date(),
      },
    });
    await tx.pendingRegistration.delete({ where: { email } });

    // Bloque 59 (pedido explícito): si ya había comprado como invitado con
    // este mismo correo (sin cuenta), esos pedidos se vinculan a la cuenta
    // recién creada. getMyOrders ya los mostraba igual por correo (OR de
    // customerId/customerEmail), pero el customerId real es lo que de
    // verdad cuenta para las estadísticas del vendedor ("clientes
    // potenciales", "ya compró", etc. filtran por customerId, no por email).
    const linked = await tx.order.updateMany({ where: { customerEmail: email, customerId: null }, data: { customerId: created.id } });

    return { user: created, linkedOrdersCount: linked.count };
  });

  // Bloque 60: verificar el registro ya prueba que es dueño del correo —
  // este navegador queda de confianza de una, sin pedirle un segundo código
  // de login inmediatamente después de haber completado el primero.
  const deviceToken = await issueTrustedDevice(user.id);
  const tokens = await createSession(user, browserId);
  res.status(201).json({ user: publicUser(user), ...tokens, deviceToken, linkedOrdersCount });
}

const loginSchema = z.object({
  email: z.string().email("Ingresá un correo electrónico válido."),
  password: z.string().min(1, "Ingresá tu contraseña."),
  // .nullish() (no solo .optional()) — bug real encontrado en vivo: cuando
  // el navegador nunca guardó nada, localStorage.getItem() devuelve `null`,
  // no `undefined`, y .optional() por sí solo rechaza null ("Expected
  // string, received null"). Como es literalmente el caso de TODO el mundo
  // la primera vez que este navegador ve este cambio, todos los logins
  // devolvían 400 hasta este fix.
  browserId: z.string().nullish(),
  // Bloque 60: token de "dispositivo de confianza" (ver TrustedDevice) — si
  // este navegador ya verificó un código de login para ESTA cuenta en los
  // últimos 30 días, se salta el paso de 2FA.
  deviceToken: z.string().nullish(),
  // Bloque 76 (bug real reportado en vivo): qué formulario de login se usó
  // ("admin"/"vendor", ausente = /cuenta, acepta cualquier rol como
  // siempre) — antes esto solo se validaba en el FRONTEND, y encima recién
  // DESPUÉS de completar el 2FA entero: una cuenta admin podía arrancar el
  // login desde /vendedor/ingresar, recibir un código de verdad por correo,
  // confirmarlo, y recién ahí el frontend deshacía la sesión con
  // "Credenciales inválidas" — mandaba un código innecesario y emitía
  // tokens reales por un instante para una cuenta que nunca debía poder
  // entrar por ahí. Ahora se corta acá, antes de mandar ningún código.
  context: z.enum(["admin", "vendor"]).nullish(),
});

// Mismo mensaje genérico que una contraseña incorrecta — un admin probando
// el formulario de vendedor (o viceversa) nunca debe poder distinguir "no
// existe esta cuenta" de "existe pero no con ese rol".
function assertRoleMatchesContext(user, context) {
  if (context === "admin" && user.role !== "ADMIN") throw new AppError("Correo o contraseña incorrectos.", 401);
  if (context === "vendor" && user.role !== "VENDOR") throw new AppError("Correo o contraseña incorrectos.", 401);
}

// Bloque 47/60: mismo largo/TTL que el reset de contraseña, pero en campos
// propios (twoFactorCodeHash/twoFactorCodeExpiresAt) — un reset en curso y
// un código de login en curso nunca se pisan entre sí.
const TWO_FACTOR_CODE_LENGTH = 6;
const TWO_FACTOR_CODE_TTL_MINUTES = 10;

export async function login(req, res) {
  const data = loginSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  if (!user) throw new AppError("Correo o contraseña incorrectos.", 401);

  const valid = await bcrypt.compare(data.password, user.passwordHash);
  if (!valid) throw new AppError("Correo o contraseña incorrectos.", 401);

  assertRoleMatchesContext(user, data.context);

  // isSuspended ya existía (Bloque 4, "Suspender" en AdminCustomers.jsx) pero
  // nunca se chequeaba acá — el botón no bloqueaba nada de verdad. Bloque 12
  // reusa este mismo flag para el soft-delete (deletedAt + isSuspended
  // juntos), así que este chequeo ahora es la pieza que realmente lo hace.
  if (user.isSuspended) throw new AppError("Esta cuenta no está disponible.", 403);

  // Bloque 60 (pedido explícito): el código de login pasa a ser obligatorio
  // para TODAS las cuentas (antes era opt-in vía user.twoFactorEnabled) —
  // se salta ÚNICAMENTE si este navegador ya quedó marcado de confianza
  // para ESTA cuenta puntual dentro de los últimos 30 días.
  const trustedDevice = data.deviceToken
    ? await prisma.trustedDevice.findFirst({
        where: { userId: user.id, tokenHash: hashToken(data.deviceToken), expiresAt: { gt: new Date() } },
      })
    : null;

  if (!trustedDevice) {
    const code = String(Math.floor(Math.random() * 10 ** TWO_FACTOR_CODE_LENGTH)).padStart(TWO_FACTOR_CODE_LENGTH, "0");
    const twoFactorCodeHash = await bcrypt.hash(code, 10);
    const twoFactorCodeExpiresAt = new Date(Date.now() + TWO_FACTOR_CODE_TTL_MINUTES * 60 * 1000);
    await prisma.user.update({ where: { id: user.id }, data: { twoFactorCodeHash, twoFactorCodeExpiresAt } });
    await sendTwoFactorCodeEmail(user, code);
    return res.json({ requiresTwoFactor: true, email: user.email });
  }

  // Dispositivo de confianza válido — ventana rodante: se le extienden otros
  // 30 días en vez de dejarlo vencer desde el primer uso.
  await prisma.trustedDevice.update({
    where: { id: trustedDevice.id },
    data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + TRUSTED_DEVICE_TTL_MS) },
  });
  // Bloque 62: login exitoso — cliente, vendedor y admin por igual, una
  // sola tabla User. Lo usa el cron de inactividad de vendedor
  // (vendorLifecycle.job.js) para el recordatorio de 7 días y la
  // suspensión automática a los 90.
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  const tokens = await createSession(user, data.browserId);
  res.json({ user: publicUser(user), ...tokens });
}

const verifyTwoFactorSchema = z.object({
  email: z.string().email(),
  code: z.string().length(TWO_FACTOR_CODE_LENGTH),
  browserId: z.string().nullish(),
  // Bloque 76: defensa en profundidad — login() ya corta antes de mandar el
  // código si el contexto no coincide, así que en la práctica esto nunca
  // debería dispararse, pero no cuesta nada repetir el chequeo acá también.
  context: z.enum(["admin", "vendor"]).nullish(),
});

export async function verifyTwoFactorLogin(req, res) {
  const { email, code, browserId, context } = verifyTwoFactorSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });

  const valid =
    user?.twoFactorCodeHash && user?.twoFactorCodeExpiresAt && user.twoFactorCodeExpiresAt.getTime() > Date.now()
      ? await bcrypt.compare(code, user.twoFactorCodeHash)
      : false;
  if (!valid) throw new AppError("Código inválido o vencido.", 400);

  assertRoleMatchesContext(user, context);

  // El código se invalida al usarlo — no se puede reutilizar para un segundo
  // login. Bloque 62: mismo update ya de paso registra el login exitoso.
  await prisma.user.update({
    where: { id: user.id },
    data: { twoFactorCodeHash: null, twoFactorCodeExpiresAt: null, lastLoginAt: new Date() },
  });

  // Bloque 60: este navegador acaba de probar que tiene acceso al correo de
  // la cuenta — queda marcado de confianza por 30 días (no se le va a
  // volver a pedir el código hasta que expire o inicie sesión desde otro
  // navegador/dispositivo).
  const deviceToken = await issueTrustedDevice(user.id);
  const tokens = await createSession(user, browserId);
  res.json({ user: publicUser(user), ...tokens, deviceToken });
}

export async function me(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);
  res.json({ user: publicUser(user) });
}

const refreshSchema = z.object({ refreshToken: z.string() });

// Bloque 60: reescrito contra Session (antes era solo jwt.verify contra un
// refresh token JWT sin estado, nunca chequeaba isSuspended/deletedAt acá).
// Ventana rodante: cada refresh exitoso extiende la Session otros 30 días,
// así que un dispositivo en uso activo nunca la pierde por vencimiento.
export async function refresh(req, res) {
  const { refreshToken } = refreshSchema.parse(req.body);

  const session = await prisma.session.findUnique({ where: { refreshTokenHash: hashToken(refreshToken) } });
  if (!session || session.revokedAt || session.expiresAt.getTime() < Date.now()) {
    throw new AppError("Sesión inválida o expirada.", 401);
  }

  const user = await prisma.user.findUnique({ where: { id: session.userId } });
  if (!user || user.isSuspended || user.deletedAt) throw new AppError("Esta cuenta no está disponible.", 403);

  await prisma.session.update({
    where: { id: session.id },
    data: { lastUsedAt: new Date(), expiresAt: new Date(Date.now() + SESSION_TTL_MS) },
  });

  const accessToken = jwt.sign({ sub: user.id, role: user.role, sid: session.id }, env.jwtSecret, { expiresIn: "1h" });
  res.json({ accessToken });
}

const logoutSchema = z.object({ refreshToken: z.string().optional() });

// Bloque 60 (pedido explícito): "se debe limpiar bien cuando se cierra la
// sesión" — antes cerrar sesión solo borraba el token del lado del
// cliente, el servidor lo seguía aceptando como si nada. Acá se revoca la
// Session de verdad; como el access token lleva `sid` y `authenticate` lo
// valida contra la DB en cada request, el efecto es inmediato. No exige
// `authenticate` (mismo criterio que refresh(): tener el refresh token ES
// la credencial) — así funciona incluso si el access token ya venció.
export async function logout(req, res) {
  const { refreshToken } = logoutSchema.parse(req.body);
  if (refreshToken) {
    await prisma.session.updateMany({
      where: { refreshTokenHash: hashToken(refreshToken), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  res.status(204).send();
}

// Bloque 60 (pedido explícito): "Cerrar sesión en todos los dispositivos" —
// revoca TODAS las sesiones activas del usuario y borra TODOS sus
// dispositivos de confianza, así que cualquier otro navegador/pestaña
// logueado pierde el acceso en su próximo request, y el próximo login en
// cualquier lado vuelve a pedir el código.
export async function logoutAllDevices(req, res) {
  await prisma.session.updateMany({ where: { userId: req.user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.trustedDevice.deleteMany({ where: { userId: req.user.id } });
  res.json({ ok: true });
}

// --- Reset de contraseña por código (cliente, vendedor y admin comparten la
// misma tabla User/flujo — no hay un sistema paralelo por rol) -------------

const RESET_CODE_LENGTH = 6;
const RESET_CODE_TTL_MINUTES = 15;

function generateResetCode() {
  return String(Math.floor(Math.random() * 10 ** RESET_CODE_LENGTH)).padStart(RESET_CODE_LENGTH, "0");
}

async function isResetCodeValid(user, code) {
  if (!user || !user.resetCodeHash || !user.resetCodeExpiresAt) return false;
  if (user.resetCodeExpiresAt.getTime() < Date.now()) return false;
  return bcrypt.compare(code, user.resetCodeHash);
}

const forgotPasswordSchema = z.object({ email: z.string().email() });

// Respuesta siempre genérica — nunca revela si el correo existe (evita
// enumeración de cuentas). El código real solo se genera/envía si sí existe.
export async function forgotPassword(req, res) {
  const { email } = forgotPasswordSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });

  if (user) {
    const code = generateResetCode();
    const resetCodeHash = await bcrypt.hash(code, 10);
    const resetCodeExpiresAt = new Date(Date.now() + RESET_CODE_TTL_MINUTES * 60 * 1000);
    await prisma.user.update({ where: { id: user.id }, data: { resetCodeHash, resetCodeExpiresAt } });
    await sendPasswordResetEmail(user, code);
  }

  res.json({ ok: true, message: "Si ese correo tiene una cuenta, enviamos un código de verificación." });
}

const verifyResetCodeSchema = z.object({ email: z.string().email(), code: z.string().length(RESET_CODE_LENGTH) });

// Chequeo previo (no consume el código) para dar feedback inmediato en el
// paso 2 del flujo antes de mostrarle al usuario los campos de contraseña
// nueva — la validación real y definitiva se repite en resetPassword.
export async function verifyResetCode(req, res) {
  const { email, code } = verifyResetCodeSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { email } });
  const valid = await isResetCodeValid(user, code);
  if (!valid) throw new AppError("Código inválido o vencido.", 400);
  res.json({ valid: true });
}

const resetPasswordSchema = z
  .object({
    email: z.string().email(),
    code: z.string().length(RESET_CODE_LENGTH),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: "Las contraseñas no coinciden.", path: ["confirmPassword"] });

export async function resetPassword(req, res) {
  const data = resetPasswordSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { email: data.email } });
  const valid = await isResetCodeValid(user, data.code);
  if (!valid) throw new AppError("Código inválido o vencido.", 400);

  const passwordHash = await bcrypt.hash(data.newPassword, 10);
  // El código se invalida al usarlo — no se puede reutilizar para un segundo reset.
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash, resetCodeHash: null, resetCodeExpiresAt: null } });

  res.json({ ok: true });
}

// --- Perfil propio (Bloque 47) — genéricos para cualquier rol logueado, no
// duplicados por admin/vendedor/cliente: AdminProfile.jsx y
// VendorProfile.jsx pegan a los mismos dos endpoints. -----------------------

// Bloque 71 (pedido explícito): cambiar de correo deja de ser directo — 2
// pasos, mismo criterio que el reset de contraseña/2FA (código propio,
// nunca reutiliza resetCodeHash/twoFactorCodeHash). El código va SIEMPRE al
// correo VIEJO (el que ya está en la cuenta) — es la prueba de que quien
// pide el cambio de verdad tiene acceso a esa cuenta, no al correo nuevo
// (cualquiera puede escribir un correo ajeno en el formulario). Letras +
// números (no solo dígitos, pedido explícito) — más largo y con más
// alfabeto que el reset/2FA (6 dígitos) porque acá el propio código ES la
// autorización final del cambio, no un segundo factor sobre un login ya en curso.
const EMAIL_CHANGE_CODE_LENGTH = 8;
const EMAIL_CHANGE_CODE_TTL_MINUTES = 15;
const EMAIL_CHANGE_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // sin 0/O/1/I — ambiguos al transcribir a mano

function generateEmailChangeCode() {
  let code = "";
  for (let i = 0; i < EMAIL_CHANGE_CODE_LENGTH; i++) {
    code += EMAIL_CHANGE_CODE_ALPHABET[Math.floor(Math.random() * EMAIL_CHANGE_CODE_ALPHABET.length)];
  }
  return code;
}

const requestEmailChangeSchema = z.object({ newEmail: z.string().email(), currentPassword: z.string().min(1) });

export async function requestMyEmailChange(req, res) {
  const { newEmail, currentPassword } = requestEmailChangeSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new AppError("La contraseña actual no es correcta.", 401);

  // Mismo criterio que admin.controller.js updateCustomer: nunca dejar dos
  // cuentas con el mismo correo.
  const existing = await prisma.user.findUnique({ where: { email: newEmail } });
  if (existing && existing.id !== user.id) throw new AppError("Ese correo ya está en uso por otra cuenta.", 409);

  const code = generateEmailChangeCode();
  const emailChangeCodeHash = await bcrypt.hash(code, 10);
  const emailChangeCodeExpiresAt = new Date(Date.now() + EMAIL_CHANGE_CODE_TTL_MINUTES * 60 * 1000);

  await prisma.user.update({
    where: { id: user.id },
    data: { pendingEmail: newEmail, emailChangeCodeHash, emailChangeCodeExpiresAt },
  });

  await sendEmailChangeCodeEmail(user, code, newEmail);

  res.json({ ok: true });
}

const confirmEmailChangeSchema = z.object({ code: z.string().min(1) });

export async function confirmMyEmailChange(req, res) {
  const { code } = confirmEmailChangeSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);

  const valid =
    user.pendingEmail && user.emailChangeCodeHash && user.emailChangeCodeExpiresAt && user.emailChangeCodeExpiresAt.getTime() > Date.now()
      ? await bcrypt.compare(code.trim().toUpperCase(), user.emailChangeCodeHash)
      : false;
  if (!valid) throw new AppError("Código inválido o vencido.", 400);

  const updated = await prisma.user.update({
    where: { id: user.id },
    data: { email: user.pendingEmail, pendingEmail: null, emailChangeCodeHash: null, emailChangeCodeExpiresAt: null },
  });

  // Bloque 71 (pedido explícito): "el usuario viejo debe dejar de aparecer
  // en el sistema para evitar que siga teniendo acceso" — se revoca TODA
  // sesión activa (incluida la que acaba de confirmar el cambio, mismo
  // criterio que logoutAllDevices) y se borran los dispositivos de
  // confianza; como `authenticate` valida la sesión contra la DB en cada
  // request (ver middleware/auth.js), el efecto es inmediato — el próximo
  // request de cualquier pestaña, incluida esta, recibe 401 y tiene que
  // loguearse de nuevo, ya con el correo nuevo.
  await prisma.session.updateMany({ where: { userId: user.id, revokedAt: null }, data: { revokedAt: new Date() } });
  await prisma.trustedDevice.deleteMany({ where: { userId: user.id } });

  res.json({ user: publicUser(updated) });
}

const updatePasswordSchema = z
  .object({
    currentPassword: z.string().min(1),
    newPassword: z.string().min(8),
    confirmPassword: z.string().min(8),
  })
  .refine((d) => d.newPassword === d.confirmPassword, { message: "Las contraseñas no coinciden.", path: ["confirmPassword"] });

export async function updateMyPassword(req, res) {
  const { currentPassword, newPassword } = updatePasswordSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);

  const valid = await bcrypt.compare(currentPassword, user.passwordHash);
  if (!valid) throw new AppError("La contraseña actual no es correcta.", 401);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: user.id }, data: { passwordHash } });
  res.json({ ok: true });
}
