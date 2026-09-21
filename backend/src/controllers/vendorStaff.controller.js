import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { logActivity } from "../lib/activityLog.js";
import { sendVendorStaffInviteEmail } from "../lib/email.js";
import { VENDOR_SECTION_KEYS, pruneSectionPermissions, withStaffTypeSections } from "../constants/vendorSections.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const STAFF_PHOTO_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "vendor-staff");

// Bloque 183 (pedido explícito — "quiero que el administrador, vendedor,
// dueño del negocio... pueda crear usuarios con roles dentro de su
// negocio"): panel del DUEÑO para gestionar sus propios usuarios de
// sistema — nunca accesible para un VENDOR_STAFF entre sí (la ruta exige
// requireRole("VENDOR","ADMIN"), nunca requireVendorAccess — evita que un
// usuario con acceso pueda crear una puerta trasera para sí mismo).

function publicStaff(staff) {
  const { user, ...rest } = staff;
  return { ...rest, email: user.email, fullName: user.fullName, isSuspended: user.isSuspended, lastLoginAt: user.lastLoginAt };
}

export async function listMyStaff(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await prisma.vendorStaff.findMany({
    where: { vendorId: vendor.id },
    include: { user: { select: { email: true, fullName: true, isSuspended: true, lastLoginAt: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ staff: staff.map(publicStaff), sections: VENDOR_SECTION_KEYS });
}

// Bloque 185: mismo criterio que allowedSections de abajo — llega como JSON
// stringificado (va junto con la foto en el mismo FormData). Solo se
// guardan los niveles de las secciones que además están en allowedSections
// (filtrado en el controller, no acá — ahí ya tenemos las dos listas
// juntas); una sección sin nivel explícito se trata como "manage" en tiempo
// de chequeo (ver staffSectionLevel, requireVendorAccess.js), nunca hace
// falta rellenarla acá con un default.
const sectionPermissionsSchema = z
  .string()
  .optional()
  .transform((s) => {
    if (!s) return {};
    try {
      return JSON.parse(s);
    } catch {
      return {};
    }
  })
  .pipe(z.record(z.enum(VENDOR_SECTION_KEYS), z.enum(["view", "manage"])));

const createStaffSchema = z.object({
  email: z.string().email("Ingresa un correo electrónico válido."),
  fullName: z.string().trim().min(2, "Ingresa el nombre del usuario."),
  // Bloque 198 (pedido explícito — "ventas manuales"): opcional — solo hace
  // falta si el vendedor le va a dar acceso a esa sección, pero se pide
  // siempre acá para no tener que editarlo después.
  phone: z.string().trim().optional(),
  // Bloque 200 (pedido explícito — "al crear un usuario se debe poder
  // especificar si es un agente de venta o un mesero"): llega como string
  // plano (FormData) — "" o ausente = sin tipo específico.
  staffType: z
    .union([z.enum(["SALES_AGENT", "WAITER"]), z.literal("")])
    .optional()
    .transform((v) => (v ? v : null)),
  // Bloque 205 (pedido explícito — "especificar si el usuario recibe las
  // notificaciones de nuevos pedidos... los meseros la llevarán marcada
  // predeterminadamente, pero los agentes de ventas no"): llega como string
  // ("true"/"false", FormData) — ausente = sin preferencia explícita del
  // formulario, se aplica el default por staffType acá abajo (ver
  // createMyStaff). El formulario de VendorUsers.jsx en la práctica siempre
  // manda un valor explícito; esto es solo la red de seguridad del lado del
  // servidor para cualquier otro caller.
  receivesOrderNotifications: z
    .enum(["true", "false"])
    .optional()
    .transform((v) => (v === undefined ? undefined : v === "true")),
  // Bloque 183: llega como JSON stringificado dentro de un FormData (va
  // junto con la foto, multipart/form-data) — nunca un array real en el
  // body de multer.
  // Bloque 200 (pedido explícito — "no es obligatorio asignarle acceso a
  // ninguna de las sesiones, ya que normalmente sin acceso, cuando acceden
  // podrán ver la sección de mi perfil"): ya NO exige mínimo 1 — un usuario
  // sin ninguna sección es válido, simplemente solo ve "Mi perfil".
  allowedSections: z
    .string()
    .transform((s) => {
      try {
        return JSON.parse(s);
      } catch {
        return [];
      }
    })
    .pipe(z.array(z.enum(VENDOR_SECTION_KEYS))),
  sectionPermissions: sectionPermissionsSchema,
});

// Bloque 187: pruneSectionPermissions ahora vive en
// constants/vendorSections.js (compartida con admin.controller.js, que
// necesita el mismo recorte al editar un usuario ajeno).

// Bloque 183 (pedido explícito — "normalmente, el usuario, para crearlo,
// solo el vendedor deberá ingresar un correo electrónico"): además del
// correo (obligatorio) se pide nombre y a qué secciones tiene acceso — un
// User real se crea de una, pero SIN contraseña utilizable todavía
// (passwordHash con un valor aleatorio que nadie conoce, mustSetPassword
// en true) — la persona la define ella misma la primera vez que intenta
// entrar (ver login()/auth.controller.js), nunca el vendedor la escribe
// por ella.
export async function createMyStaff(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const data = createStaffSchema.parse(req.body);
  const email = data.email.trim().toLowerCase();

  const existing = await prisma.user.findUnique({ where: { email } });
  if (existing) throw new AppError("Ya existe una cuenta con ese correo.", 409);

  // Bloque 183: nunca null (la columna sigue siendo NOT NULL) — un hash de
  // 32 bytes random es, en la práctica, un password que nadie puede
  // adivinar ni usar nunca; mustSetPassword es lo que de verdad decide que
  // hace falta pasar por el flujo de definir una contraseña propia.
  const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);

  // Bloque 200: el tipo elegido precarga su(s) sección(es) — union con lo
  // que el dueño ya haya tildado a mano, nunca un reemplazo.
  const allowedSections = withStaffTypeSections(data.allowedSections, data.staffType);
  // Bloque 205: default por tipo si el formulario no mandó nada explícito —
  // meseros SÍ reciben el aviso en pantalla de pedidos nuevos por default
  // (lo necesitan para su trabajo), agentes de ventas NO (no atienden
  // pedidos de mesa) — el dueño puede prender/apagar esto para cualquiera
  // de los dos desde el checkbox.
  const receivesOrderNotifications = data.receivesOrderNotifications ?? data.staffType === "WAITER";

  const { user, staff } = await prisma.$transaction(async (tx) => {
    const user = await tx.user.create({
      data: {
        email,
        fullName: data.fullName.trim(),
        role: "VENDOR_STAFF",
        passwordHash: unusablePasswordHash,
        mustSetPassword: true,
      },
    });
    const staff = await tx.vendorStaff.create({
      data: {
        userId: user.id,
        vendorId: vendor.id,
        allowedSections,
        sectionPermissions: pruneSectionPermissions(allowedSections, data.sectionPermissions),
        photoUrl: req.file ? `/uploads/vendor-staff/${req.file.filename}` : null,
        phone: data.phone?.trim() || null,
        staffType: data.staffType,
        receivesOrderNotifications,
        createdByUserId: req.user.id,
      },
    });
    return { user, staff };
  });

  await sendVendorStaffInviteEmail(user, vendor.companyName);

  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR",
    vendorId: vendor.id,
    action: "vendor_staff_created",
    description: `Creó el usuario "${user.fullName}" (${user.email}) con acceso a: ${allowedSections.join(", ") || "ninguna sección"}`,
    meta: { staffUserId: user.id, allowedSections, staffType: data.staffType },
  });

  res.status(201).json({ staff: publicStaff({ ...staff, user }) });
}

async function findMyStaffOr404(vendorId, staffId) {
  const staff = await prisma.vendorStaff.findUnique({
    where: { id: staffId },
    include: { user: { select: { id: true, email: true, fullName: true, isSuspended: true, lastLoginAt: true } } },
  });
  if (!staff || staff.vendorId !== vendorId) throw new AppError("Usuario no encontrado.", 404);
  return staff;
}

const updateStaffSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().trim().nullable().optional(),
  // Bloque 200: ya NO exige mínimo 1 — mismo criterio que createStaffSchema.
  allowedSections: z.array(z.enum(VENDOR_SECTION_KEYS)).optional(),
  // Bloque 185: acá SÍ llega como objeto real (esta ruta no es multipart,
  // es un PATCH JSON normal — a diferencia de createMyStaff, que comparte
  // FormData con la foto).
  sectionPermissions: z.record(z.enum(VENDOR_SECTION_KEYS), z.enum(["view", "manage"])).optional(),
  isActive: z.boolean().optional(),
  // Bloque 200: null = "sin tipo específico"; ausente = no tocar el que ya
  // tenía. Elegir/cambiar el tipo acá también precarga su(s) sección(es),
  // igual que al crear (ver más abajo).
  staffType: z.enum(["SALES_AGENT", "WAITER"]).nullable().optional(),
  // Bloque 205: PATCH normal (JSON), a diferencia de createStaffSchema —
  // acá sí llega como boolean real, no string.
  receivesOrderNotifications: z.boolean().optional(),
});

// Bloque 183 (pedido explícito — "en el panel de los vendedores... también
// se podrá cambiar la información de esos usuarios"): a diferencia del
// propio usuario (que solo puede cambiar su contraseña, nunca su nombre ni
// correo — ver updateMyPassword, auth.controller.js, sin cambios), el
// DUEÑO sí puede editar todo desde acá.
export async function updateMyStaff(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await findMyStaffOr404(vendor.id, req.params.id);
  const data = updateStaffSchema.parse(req.body);

  if (data.email) {
    const email = data.email.trim().toLowerCase();
    const existing = await prisma.user.findUnique({ where: { email } });
    if (existing && existing.id !== staff.userId) throw new AppError("Ese correo ya está en uso por otra cuenta.", 409);
  }

  // Bloque 200: si esta llamada cambia (o por primera vez fija) el tipo,
  // sus secciones default se agregan — union con lo que ya tenía/lo que
  // esta misma llamada haya mandado en allowedSections, nunca un reemplazo.
  const sectionsBeforeTypeMerge = data.allowedSections ?? staff.allowedSections;
  const nextSections =
    data.staffType !== undefined ? withStaffTypeSections(sectionsBeforeTypeMerge, data.staffType) : sectionsBeforeTypeMerge;
  // Bloque 185: si esta llamada cambia allowedSections, sectionPermissions
  // se recalcula contra la lista NUEVA (nunca la vieja) — así sacarle una
  // sección a alguien no deja un nivel "manage" huérfano guardado, listo
  // para reaparecer si se la vuelven a dar sin querer especificar nivel.
  const nextPermissions = data.sectionPermissions
    ? { ...(staff.sectionPermissions ?? {}), ...data.sectionPermissions }
    : staff.sectionPermissions;

  const [updatedUser, updatedStaff] = await prisma.$transaction([
    prisma.user.update({
      where: { id: staff.userId },
      data: {
        ...(data.fullName ? { fullName: data.fullName.trim() } : {}),
        ...(data.email ? { email: data.email.trim().toLowerCase() } : {}),
      },
    }),
    prisma.vendorStaff.update({
      where: { id: staff.id },
      data: {
        ...(data.allowedSections || data.staffType !== undefined ? { allowedSections: nextSections } : {}),
        ...(data.isActive != null ? { isActive: data.isActive } : {}),
        ...(data.phone !== undefined ? { phone: data.phone?.trim() || null } : {}),
        ...(data.staffType !== undefined ? { staffType: data.staffType } : {}),
        ...(data.receivesOrderNotifications !== undefined ? { receivesOrderNotifications: data.receivesOrderNotifications } : {}),
        sectionPermissions: pruneSectionPermissions(nextSections, nextPermissions),
      },
    }),
  ]);

  // Bloque 183: si se lo desactiva, se le corta el acceso YA — no alcanza
  // con que el próximo login falle (authenticate() valida la Session
  // contra la DB en cada request, mismo criterio que isSuspended en User).
  if (data.isActive === false) {
    await prisma.session.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR",
    vendorId: vendor.id,
    action: "vendor_staff_updated",
    description: `Actualizó al usuario "${updatedUser.fullName}" (${updatedUser.email})`,
    meta: { staffUserId: staff.userId, changes: data },
  });

  res.json({ staff: publicStaff({ ...updatedStaff, user: updatedUser }) });
}

export async function uploadMyStaffPhoto(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await findMyStaffOr404(vendor.id, req.params.id);
  if (!req.file) throw new AppError("No se recibió ninguna foto.", 400);

  const updated = await prisma.vendorStaff.update({
    where: { id: staff.id },
    data: { photoUrl: `/uploads/vendor-staff/${req.file.filename}` },
    include: { user: { select: { email: true, fullName: true, isSuspended: true, lastLoginAt: true } } },
  });
  res.json({ staff: publicStaff(updated) });
}

// Bloque 183 (pedido explícito — "su contraseña también se podrá
// restablecer"): en vez de que el dueño escriba una contraseña nueva por
// la persona (como sí hace resetVendorPassword en admin.controller.js
// para el DUEÑO de una tienda), acá se reusa el mismo mecanismo del alta
// — mustSetPassword en true — así el usuario siempre termina eligiendo su
// propia contraseña de nuevo por el flujo seguro de código al correo,
// nunca una que el vendedor conozca. Corta también toda sesión activa de
// esa cuenta (por si el problema era justamente que alguien más la estaba
// usando).
export async function resetMyStaffPassword(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await findMyStaffOr404(vendor.id, req.params.id);

  const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  await prisma.user.update({
    where: { id: staff.userId },
    data: { passwordHash: unusablePasswordHash, mustSetPassword: true },
  });
  await prisma.session.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } });

  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR",
    vendorId: vendor.id,
    action: "vendor_staff_password_reset",
    description: `Restableció la contraseña de "${staff.user.fullName}" (${staff.user.email}) — deberá crear una nueva al entrar.`,
    meta: { staffUserId: staff.userId },
  });

  res.json({ ok: true });
}

// Bloque 183 (pedido explícito — "poder ver qué es lo que está haciendo en
// la cuenta, dónde se movió dentro de la cuenta"): historial real de
// ActivityLog para ESTE usuario puntual — actorId siempre fue el id real
// del usuario logueado (nunca el del dueño), así que esto ya viene
// funcionando desde el momento en que el propio usuario empieza a actuar.
export async function getMyStaffActivity(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await findMyStaffOr404(vendor.id, req.params.id);

  const activity = await prisma.activityLog.findMany({
    where: { actorId: staff.userId, vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ activity });
}

// Bloque 183 (pedido explícito — "a qué hora accedió a la cuenta, a qué
// hora se cerró la sesión y volvió a iniciar sesión"): Session ya guarda
// exactamente esto (createdAt = inicio, lastUsedAt = última actividad,
// revokedAt = cierre) — nunca hizo falta una tabla nueva.
export async function getMyStaffSessions(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const staff = await findMyStaffOr404(vendor.id, req.params.id);

  const sessions = await prisma.session.findMany({
    where: { userId: staff.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true },
  });
  res.json({ sessions });
}

// --- Perfil propio del usuario de sistema (Bloque 183 — "esa foto saldrá
// en el perfil del usuario... podrá ver su foto con su nombre, su correo,
// el nombre del negocio... y la sección a la que tiene acceso") ----------

export async function getMyStaffProfile(req, res) {
  const staff = await prisma.vendorStaff.findUnique({
    where: { userId: req.user.id },
    include: { vendor: { select: { companyName: true, logoUrl: true } }, user: { select: { email: true, fullName: true } } },
  });
  if (!staff) throw new AppError("No se encontró tu perfil de usuario.", 404);

  // Bloque 202 (pedido explícito — "no será una sección visible en el panel
  // del... dueño, será una sección que se habilita sola cuando un usuario
  // de venta tiene productos asignados"): VendorLayout.jsx usa esto para
  // mostrar/ocultar "Productos Asignados" en el NAV de un usuario de
  // sistema. "Tiene productos asignados" = existe al menos una fila propia
  // en VendorStaffAllocation — nunca se saca sola si vende todo hasta
  // llegar a remainingQty 0, la fila sigue existiendo (si no, perdería el
  // acceso a su propio historial de ventas/cuadre de caja apenas se
  // quedara sin stock).
  const allocationsCount = await prisma.vendorStaffAllocation.count({ where: { vendorStaffId: staff.id } });

  res.json({
    fullName: staff.user.fullName,
    email: staff.user.email,
    photoUrl: staff.photoUrl,
    allowedSections: staff.allowedSections,
    // Bloque 185: el propio panel (VendorLayout.jsx) necesita esto para
    // decidir qué botones de escritura mostrar/ocultar dentro de las
    // secciones a las que sí tiene acceso — no solo cuáles ve.
    sectionPermissions: staff.sectionPermissions,
    staffType: staff.staffType,
    hasAssignedProducts: allocationsCount > 0,
    // Bloque 205: gate de NewOrderPopup/StaleOrderAlert para este usuario
    // puntual — ver VendorLayout.jsx.
    receivesOrderNotifications: staff.receivesOrderNotifications,
    vendorName: staff.vendor.companyName,
    vendorLogoUrl: staff.vendor.logoUrl,
  });
}
