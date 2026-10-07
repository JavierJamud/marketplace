import bcrypt from "bcryptjs";
import { prisma } from "./prisma.js";
import { sendAdminDirectEmail } from "./email.js";
import { AppError } from "../utils/AppError.js";

// Bloque 272 (pedido explícito): las acciones sensibles del admin (eliminar una tienda
// o un cliente de forma definitiva, cambiar claves de integraciones o ajustes de
// seguridad) piden un código de un solo uso enviado al correo del propio admin.
// El código es de UNA acción concreta: uno pedido para borrar una tienda no sirve para
// cambiar una clave. Dura 10 minutos, se guarda solo su hash y se bloquea tras 5 intentos.

export const ACTION_LABELS = {
  // Empresas (tiendas)
  VENDOR_DELETE: "eliminar una tienda (pasa a eliminación pendiente)",
  DELETE_VENDOR_PERMANENT: "eliminar una tienda de forma definitiva",
  VENDOR_CHANGE: "modificar una tienda",
  ACCOUNT_ACCESS_CHANGE: "cambiar el acceso de una cuenta (contraseña o correo de inicio de sesión)",
  PLAN_CHANGE: "cambiar el plan de una tienda",
  VERIFICATION_CHANGE: "decidir sobre la verificación de una tienda",
  PAYMENT_CONFIRM: "confirmar un pago de suscripción",
  FRAUD_DECISION: "resolver un reporte de fraude",
  CONTENT_MODERATION: "moderar o eliminar una reseña",
  // Clientes
  CUSTOMER_CHANGE: "modificar un cliente",
  DELETE_CUSTOMER: "eliminar un cliente",
  // Reglas y configuración de la plataforma
  PLAN_CONFIG_CHANGE: "cambiar la configuración de los planes",
  PLATFORM_SETTINGS: "cambiar una regla de la plataforma",
  CATALOG_DELETE: "eliminar un país, provincia, municipio o categoría",
  CHANGE_INTEGRATION_KEY: "cambiar una integración o su clave",
  CHANGE_SECURITY_SETTINGS: "cambiar los ajustes de seguridad",
  DISABLE_ADMIN_2FA: "desactivar la verificación en dos pasos",
  // Cuenta del propio admin y datos de la plataforma
  ADMIN_PASSWORD_CHANGE: "cambiar tu contraseña",
  ADMIN_EMAIL_CHANGE: "cambiar el correo de tu cuenta",
  PLATFORM_BRANDING: "cambiar los datos de la plataforma (nombre, redes, soporte o zona horaria)",
};

const CODE_LENGTH = 6;
const TTL_MS = 10 * 60 * 1000;
const RESEND_COOLDOWN_MS = 30 * 1000;
const MAX_ATTEMPTS = 5;

export async function sendActionCode(user, action) {
  if (!ACTION_LABELS[action]) throw new AppError("Acción no reconocida.", 400);
  const last = await prisma.adminActionCode.findFirst({ where: { userId: user.id, action }, orderBy: { createdAt: "desc" } });
  if (last && Date.now() - last.createdAt.getTime() < RESEND_COOLDOWN_MS) {
    throw new AppError("Espera unos segundos antes de pedir otro código.", 429);
  }
  const code = String(Math.floor(Math.random() * 10 ** CODE_LENGTH)).padStart(CODE_LENGTH, "0");
  await prisma.adminActionCode.create({ data: { userId: user.id, action, codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + TTL_MS) } });
  const result = await sendAdminDirectEmail({
    to: user.email,
    recipientName: user.fullName,
    subject: `Código de confirmación: ${ACTION_LABELS[action]}`,
    message:
      `Tu código para confirmar la acción "${ACTION_LABELS[action]}" es:\n\n${code}\n\n` +
      "Vence en 10 minutos y sirve una sola vez. Si no fuiste tú, ignora este mensaje y cambia tu contraseña.",
  });
  if (!result?.ok) {
    // Mismo criterio que el código de login: si el correo no pudo salir, el código queda
    // en el registro del servidor para que el dueño de la infraestructura pueda leerlo.
    console.warn(`[adminActionCode] No se pudo enviar el correo (${result?.error}) — código para ${user.email} (${action}): ${code}`);
  }
  return { expiresAt: new Date(Date.now() + TTL_MS) };
}

// Comprueba el código SIN gastarlo: devuelve la fila si es válido. Se gasta recién cuando la
// acción termina bien (ver requireActionCode); así una acción que falla por un dato mal puesto
// no obliga a pedir otro código.
async function checkActionCode(userId, action, code) {
  const row = await prisma.adminActionCode.findFirst({ where: { userId, action, usedAt: null, expiresAt: { gt: new Date() } }, orderBy: { createdAt: "desc" } });
  if (!row || row.attempts >= MAX_ATTEMPTS) return null;
  const ok = await bcrypt.compare(String(code ?? "").trim(), row.codeHash);
  if (!ok) {
    await prisma.adminActionCode.update({ where: { id: row.id }, data: { attempts: { increment: 1 } } });
    return null;
  }
  return row;
}

export async function verifyActionCode(userId, action, code) {
  const row = await checkActionCode(userId, action, code);
  if (!row) return false;
  await prisma.adminActionCode.update({ where: { id: row.id }, data: { usedAt: new Date() } });
  return true;
}

// Comprueba el código de la petición. Si es válido devuelve true (y lo gasta cuando la acción
// responde con éxito); si no, ya respondió 403 ACTION_CODE_REQUIRED y devuelve false: el
// controlador debe hacer `return`. Sirve para pedir el código DESPUÉS de validar el formulario
// (p. ej. contraseña actual y nuevas) en vez de antes, como hace el middleware.
export async function confirmActionCode(req, res, action) {
  const code = req.get("x-action-code");
  const row = code ? await checkActionCode(req.user.id, action, code) : null;
  if (row) {
    res.on("finish", () => {
      if (res.statusCode < 400) prisma.adminActionCode.update({ where: { id: row.id }, data: { usedAt: new Date() } }).catch(() => {});
    });
    return true;
  }
  res.status(403).json({
    error: code ? "El código es incorrecto o venció." : `Confirma con el código enviado a tu correo para ${ACTION_LABELS[action]}.`,
    code: "ACTION_CODE_REQUIRED",
    action,
    label: ACTION_LABELS[action],
    wrong: !!code,
  });
  return false;
}

// Middleware: exige el código (cabecera X-Action-Code) para ESTA acción. Sin código o con uno
// malo responde 403 con `code: "ACTION_CODE_REQUIRED"`, que el panel usa para pedirlo.
export function requireActionCode(action) {
  return async (req, res, next) => {
    if (await confirmActionCode(req, res, action)) next();
  };
}
