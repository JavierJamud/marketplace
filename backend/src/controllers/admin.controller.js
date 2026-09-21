import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { transitionVendorVerification, syncVerificationArchive } from "../services/vendorVerification.service.js";
import { notifyVerificationEvent } from "../services/verificationNotify.service.js";
import { cancelStripeSubscription } from "../lib/stripe.js";
import { sendAdminDirectEmail, sendVendorReactivatedEmail } from "../lib/email.js";
import { getSubscriptionPricing } from "./settings.controller.js";
import { logActivity } from "../lib/activityLog.js";
import { finalizeUserDeletion } from "../lib/accountDeletion.js";
import { VENDOR_SECTION_KEYS, pruneSectionPermissions, withStaffTypeSections } from "../constants/vendorSections.js";

// --- Dashboard --------------------------------------------------------------

const E164_REGEX = /^\+\d{7,15}$/;
// Bloque 64: mismo ciclo que verification.controller.js — cuánto dura un
// pago CUP confirmado antes de pedir el siguiente.
const PAYMENT_CYCLE_DAYS = 30;

export async function getDashboard(_req, res) {
  const monthStart = new Date();
  monthStart.setDate(1);
  monthStart.setHours(0, 0, 0, 0);

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    activeVendors,
    totalCustomers,
    ordersThisMonth,
    tableOrdersThisMonth,
    orderSum,
    tableOrderSum,
    pendingVerifications,
    businessVendors,
  ] = await Promise.all([
    prisma.vendor.count({ where: { isBlocked: false, status: "ACTIVE", deletedAt: null } }),
    prisma.user.count({ where: { role: "CUSTOMER", deletedAt: null } }),
    prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.tableOrder.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.order.aggregate({ _sum: { total: true } }),
    prisma.tableOrder.aggregate({ _sum: { total: true } }),
    prisma.vendor.count({ where: { verificationStatus: { in: ["PENDING_DOCS", "IN_REVIEW"] } } }),
    prisma.vendor.count({ where: { planType: "BUSINESS" } }),
  ]);

  const gmv = Number(orderSum._sum.total ?? 0) + Number(tableOrderSum._sum.total ?? 0);
  const ordersThisMonthTotal = ordersThisMonth + tableOrdersThisMonth;
  // Estimado: no hay tabla de facturación real todavía, se calcula como
  // tiendas Business × precio de lista del plan (Bloque 64: editable desde
  // el admin, ya no una constante hardcodeada).
  const { cupSubscriptionPriceCup } = (await prisma.siteSettings.findFirst()) ?? { cupSubscriptionPriceCup: 2500 };
  const subscriptionRevenueEstimate = businessVendors * cupSubscriptionPriceCup;

  // --- Uso de la plataforma (Bloque 12) -------------------------------------
  // "Activo" = la tienda tiene al menos un pedido real (Order o TableOrder)
  // alguna vez — no solo "no bloqueada". Distingue tiendas que ya venden de
  // las que se registraron pero nunca recibieron un pedido.
  const [vendorsWithOrders, vendorsWithTableOrders, totalNonDeletedVendors] = await Promise.all([
    prisma.order.groupBy({ by: ["vendorId"] }),
    prisma.tableOrder.findMany({ select: { table: { select: { vendorId: true } } } }),
    prisma.vendor.count({ where: { deletedAt: null } }),
  ]);
  const activeVendorIds = new Set([
    ...vendorsWithOrders.map((v) => v.vendorId),
    ...vendorsWithTableOrders.map((t) => t.table.vendorId),
  ]);
  const vendorActivity = {
    active: activeVendorIds.size,
    inactive: Math.max(0, totalNonDeletedVendors - activeVendorIds.size),
  };

  const [ordersDay, ordersWeek, ordersMonth, tableOrdersDay, tableOrdersWeek, tableOrdersMonth, vendorsDay, vendorsWeek, vendorsMonth] =
    await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.order.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.order.count({ where: { createdAt: { gte: monthAgo } } }),
      prisma.tableOrder.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.tableOrder.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.tableOrder.count({ where: { createdAt: { gte: monthAgo } } }),
      prisma.vendor.count({ where: { createdAt: { gte: dayAgo }, deletedAt: null } }),
      prisma.vendor.count({ where: { createdAt: { gte: weekAgo }, deletedAt: null } }),
      prisma.vendor.count({ where: { createdAt: { gte: monthAgo }, deletedAt: null } }),
    ]);
  const ordersByPeriod = { day: ordersDay + tableOrdersDay, week: ordersWeek + tableOrdersWeek, month: ordersMonth + tableOrdersMonth };
  const newVendorsByPeriod = { day: vendorsDay, week: vendorsWeek, month: vendorsMonth };

  // Actividad reciente real: últimas tiendas, verificaciones y pedidos.
  const [recentVendors, recentVerifications, recentOrders] = await Promise.all([
    prisma.vendor.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { locations: { include: { province: true }, take: 1 } } }),
    prisma.verificationRequest.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { vendor: { select: { companyName: true } } } }),
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { vendor: { select: { companyName: true } } } }),
  ]);

  const activity = [
    ...recentVendors.map((v) => ({
      emoji: "🏪",
      bg: "#e4f0f0",
      text: `Nueva tienda: "${v.companyName}" (${v.locations[0]?.province?.name ?? "Cuba"})`,
      time: v.createdAt,
    })),
    ...recentVerifications.map((v) => ({
      emoji: "🛡️",
      bg: "#fbeee0",
      text: `Solicitud de verificación de "${v.vendor.companyName}"`,
      time: v.createdAt,
    })),
    ...recentOrders.map((o) => ({
      emoji: "💳",
      bg: "#e0ecfb",
      text: `Pedido ${o.code} en "${o.vendor.companyName}"`,
      time: o.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 6);

  const vendorsByProvinceRaw = await prisma.vendorLocation.groupBy({ by: ["provinceId"], _count: { vendorId: true } });
  const provinces = await prisma.province.findMany({ where: { id: { in: vendorsByProvinceRaw.map((v) => v.provinceId) } } });
  const provinceName = Object.fromEntries(provinces.map((p) => [p.id, p.name]));
  const maxCount = Math.max(1, ...vendorsByProvinceRaw.map((v) => v._count.vendorId));
  const byProvince = vendorsByProvinceRaw
    .map((v) => ({ name: provinceName[v.provinceId] ?? "—", n: v._count.vendorId, pct: `${Math.round((v._count.vendorId / maxCount) * 100)}%` }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  res.json({
    metrics: {
      activeVendors,
      totalCustomers,
      ordersThisMonth: ordersThisMonthTotal,
      gmv,
      businessVendors,
      subscriptionRevenueEstimate,
    },
    pendingVerifications,
    activity,
    byProvince,
    vendorActivity,
    ordersByPeriod,
    newVendorsByPeriod,
  });
}

// --- Tiendas -----------------------------------------------------------

// Bloque 76 (pedido explícito): una tienda bloqueada o suspendida
// desaparece de esta lista por completo — vive en "Tiendas suspendidas"
// (listSuspendedVendors) hasta que un admin la desbloquee/reactive, y recién
// ahí vuelve a aparecer acá.
export async function listVendors(req, res) {
  const { plan } = req.query;
  const vendors = await prisma.vendor.findMany({
    where: {
      planType: plan === "business" ? "BUSINESS" : plan === "regular" ? "REGULAR" : undefined,
      deletedAt: null,
      isBlocked: false,
      status: { not: "SUSPENDED" },
    },
    include: { locations: { include: { province: true }, take: 1 }, category: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ vendors });
}

const updateVendorSchema = z.object({
  isBlocked: z.boolean().optional(),
  // Bloque 75 (pedido explícito): motivo obligatorio al bloquear — el
  // vendedor lo ve en su panel (VendorLayout.jsx) y lo usa para escribirle a
  // soporte con contexto real, en vez de quedar sin ninguna explicación.
  blockReason: z.string().trim().min(5, "Escribe un motivo de al menos 5 caracteres.").optional(),
  planType: z.enum(["REGULAR", "BUSINESS"]).optional(),
  // Edición básica desde el admin (Bloque 12) — mismas reglas de forma que
  // el registro del vendedor.
  companyName: z.string().min(2).optional(),
  whatsapp: z.string().regex(E164_REGEX, "El WhatsApp debe incluir código de país (ej. +5355512345).").optional(),
  // "" además de un email válido — el form de edición del admin precarga el
  // campo vacío cuando la tienda no tiene correo cargado (vendor.email es
  // nullable); sin este union, reenviar el form sin tocar el campo falla
  // la validación de .email() con un string vacío.
  email: z.union([z.string().email(), z.literal("")]).optional(),
  // Bloque 165 (pedido explícito — "poder editar datos en tiendas y
  // corregir errores... como cambiar... nombre o descripción o lo que sea
  // que se pueda modificar"): el admin edita estos 4 SIN pasar por el
  // candado de identidad de updateMyVendor (vendors.controller.js) — ese
  // candado es justo para bloquear al VENDEDOR, el admin es la autoridad
  // que ese mismo candado remite a usar ("solicita un cambio desde tu
  // perfil" termina, del lado admin, aprobándose acá o en
  // decideVendorChangeRequest). Nullable — un admin corrigiendo un dato
  // vacío de una tienda vieja (ver Bloque 165 en verification.controller.js)
  // necesita poder mandar el valor real sin que null rompa nada.
  ownerName: z.string().trim().min(2).optional().nullable(),
  ownerIdNumber: z.string().trim().min(1).optional().nullable(),
  companyAddress: z.string().trim().min(1).optional().nullable(),
  description: z.string().trim().optional().nullable(),
  // Bloque 222 (pedido explícito — "elimina que los vendedores puedan
  // cambiar el color de su tienda... solo el admin puede cambiar el color"):
  // el sistema lo asigna solo al crear la tienda (ver pickVendorColor,
  // vendors.controller.js); de ahí en más, solo este endpoint lo puede
  // tocar — ya no existe en updateVendorSchema del propio vendedor.
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "El color debe ser un código hex válido (ej. #232F3E).").optional(),
});

export async function updateVendor(req, res) {
  const { id } = req.params;
  const data = updateVendorSchema.parse(req.body);
  if (data.email === "") data.email = null;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);

  // Bloque 75 (pedido explícito, bug real reportado en vivo): "Bloquear"
  // dejaba al dueño sin ninguna forma de saber que su tienda estaba
  // bloqueada — el panel de vendedor no chequeaba isBlocked para nada, solo
  // status:"SUSPENDED" (inactividad). En vez de seguir bloqueando el LOGIN
  // en sí (lo que antes hacía esto vía User.isSuspended, y por eso una
  // sesión ya abierta se colaba sin aviso — exactamente el bug reportado),
  // ahora se unifica con el mismo mecanismo que ya usa la suspensión
  // automática: el vendedor puede entrar, pero VendorLayout.jsx lo detiene
  // con una pantalla real explicando el motivo + botón de contacto. Motivo
  // obligatorio al bloquear, se limpia solo al desbloquear.
  if (data.isBlocked === true && !data.blockReason && !vendor.blockReason) {
    throw new AppError("Escribe el motivo del bloqueo.", 400);
  }
  const vendorData = { ...data };
  delete vendorData.blockReason;
  if (data.isBlocked === true) {
    vendorData.blockReason = data.blockReason ?? vendor.blockReason;
    vendorData.blockedAt = vendor.blockedAt ?? new Date();
  }
  if (data.isBlocked === false) {
    vendorData.blockReason = null;
    vendorData.blockedAt = null;
  }

  const updated = await prisma.vendor.update({ where: { id }, data: vendorData });
  res.json({ vendor: updated });
}

// Bloque 165 (pedido explícito — "poder editar datos en tiendas... como
// cambiar la contraseña y correo... desde el panel de admin"): a diferencia
// del reset propio (auth.controller.js, resetPassword — pide un código
// enviado por correo), acá el admin YA está autenticado y autorizado, así
// que fija la contraseña nueva directo, sin ningún código de por medio —
// mismo hash (bcrypt, 10 rounds) que el resto del sistema.
const resetVendorPasswordSchema = z.object({
  newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
});

export async function resetVendorPassword(req, res) {
  const { id } = req.params;
  const { newPassword } = resetVendorPasswordSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: vendor.userId }, data: { passwordHash } });

  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: vendor.id,
    action: "admin_reset_vendor_password",
    description: `Un admin restableció la contraseña de "${vendor.companyName}"`,
    meta: { vendorId: vendor.id },
  });
  res.json({ ok: true });
}

// Bloque 165: correo de LOGIN (User.email, único en toda la plataforma) —
// distinto de Vendor.email (contacto público de la tienda, ya editable
// desde updateVendor de arriba). Nunca se puede repetir un correo ya en uso
// por otra cuenta.
const updateVendorLoginEmailSchema = z.object({
  email: z.string().email("Ingresa un correo válido."),
});

export async function updateVendorLoginEmail(req, res) {
  const { id } = req.params;
  const { email } = updateVendorLoginEmailSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);

  const taken = await prisma.user.findFirst({ where: { email, id: { not: vendor.userId } } });
  if (taken) throw new AppError("Ese correo ya está en uso por otra cuenta.", 409);

  await prisma.user.update({ where: { id: vendor.userId }, data: { email } });

  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: vendor.id,
    action: "admin_changed_vendor_login_email",
    description: `Un admin cambió el correo de acceso de "${vendor.companyName}"`,
    meta: { vendorId: vendor.id, newEmail: email },
  });
  res.json({ ok: true });
}

// Bloque 62/76: pantalla propia (AdminSuspendedVendors.jsx) — junta las 2
// formas en que una tienda queda inhabilitada (bloqueo manual del admin O
// suspensión automática por inactividad), porque para el vendedor el
// resultado es el mismo (tienda oculta, panel bloqueado) y el admin necesita
// verlas juntas para saber qué tiendas requieren su atención. Cada fila trae
// su propio motivo/fecha — la UI (AdminSuspendedVendors.jsx) decide qué
// mostrar y qué acción ofrecer (Desbloquear vs Reactivar) según cuál de los
// 2 campos esté seteado.
export async function listSuspendedVendors(_req, res) {
  const vendors = await prisma.vendor.findMany({
    where: { OR: [{ status: "SUSPENDED" }, { isBlocked: true }] },
    include: { locations: { include: { province: true }, take: 1 }, category: true, user: { select: { lastLoginAt: true } } },
    orderBy: [{ blockedAt: "desc" }, { suspendedAt: "desc" }],
  });
  res.json({ vendors });
}

const reactivateVendorSchema = z.object({
  reason: z.string().trim().min(5, "Escribe un motivo de al menos 5 caracteres."),
});

// Bloque 62: única forma de sacar a una tienda de SUSPENDED — a diferencia
// de isBlocked (reversible con un clic desde AdminVendors.jsx), acá el
// motivo es obligatorio y queda un VendorStatusLog con byAdminId, porque
// llegar a SUSPENDED nunca fue una decisión de un admin (lo puso el cron
// de inactividad solo) y reactivarla sí lo es.
export async function reactivateVendor(req, res) {
  const { id } = req.params;
  const { reason } = reactivateVendorSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id }, include: { user: true } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  if (vendor.status !== "SUSPENDED") throw new AppError("Esta tienda no está suspendida.", 400);

  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.vendor.update({
      where: { id },
      data: { status: "ACTIVE", reactivatedAt: now, reactivationReason: reason },
    }),
    prisma.vendorStatusLog.create({
      data: { vendorId: id, fromStatus: "SUSPENDED", toStatus: "ACTIVE", reason, byAdminId: req.user.id },
    }),
  ]);

  await sendVendorReactivatedEmail({ ...updated, user: vendor.user }, reason);
  res.json({ vendor: updated });
}

// Soft-delete: nunca se borra la fila (pedidos/reseñas históricos necesitan
// vendorId intacto). Se fuerza isBlocked:true para que los ~8 puntos del
// código que ya filtran "vendor.isBlocked:false" la oculten automáticamente
// (público, búsqueda, reseñas, pedidos nuevos) sin tocar cada uno de nuevo.
// El dueño de la tienda también queda suspendido: no puede volver a entrar
// ni a su panel de vendedor ni a ninguna otra parte del sitio con esa cuenta.
export async function deleteVendor(req, res) {
  const { id } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  await finalizeUserDeletion(vendor.userId);
  res.status(204).end();
}

// Estadísticas reales de una tienda, todo calculado server-side. "Ventas"
// cuenta pedidos normales DELIVERED + todos los TableOrder (las mesas no
// tienen un estado "cancelado" en el schema, así que cada uno representa una
// venta real cerrada). "Producto más vendido" solo mira OrderItem (pedidos
// normales) — los ítems de TableOrder viven en un campo JSON sin relación,
// no hay forma limpia de agregarlos server-side sin escanear todo a mano.
export async function getVendorStats(req, res) {
  const { id } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const [orderAgg, tableOrderAgg, topItems] = await Promise.all([
    prisma.order.aggregate({ where: { vendorId: id, status: "DELIVERED" }, _sum: { total: true }, _count: true }),
    prisma.tableOrder.aggregate({ where: { table: { vendorId: id } }, _sum: { total: true }, _count: true }),
    prisma.orderItem.groupBy({
      by: ["name"],
      where: { order: { vendorId: id, status: "DELIVERED" } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 1,
    }),
  ]);

  const salesTotal = Number(orderAgg._sum.total ?? 0) + Number(tableOrderAgg._sum.total ?? 0);
  const orderCount = orderAgg._count + tableOrderAgg._count;

  res.json({
    stats: {
      salesTotal,
      orderCount,
      avgTicket: orderCount > 0 ? salesTotal / orderCount : 0,
      topProduct: topItems[0]?.name ?? null,
      rating: Number(vendor.rating),
    },
  });
}

// Auditoría de seguridad: antes el admin solo veía si una tienda "tuvo o no"
// actividad de mesas (booleano agregado en getVendorStats/dashboard), sin
// ninguna forma de ver el CONTENIDO real de un pedido de mesa — para
// investigar un reclamo puntual necesitaba entrar a Prisma Studio. Acá se
// expone el detalle real (ítems, mesa, estado), de solo lectura.
export async function getVendorTableOrders(req, res) {
  const { id } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const tableOrders = await prisma.tableOrder.findMany({
    where: { table: { vendorId: id } },
    include: { table: { select: { tableNumber: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ tableOrders });
}

// --- Usuarios de sistema de un vendedor (Bloque 183, pedido explícito —
// "el administrador general del sistema también puede controlar y
// verificar lo mismo que pueda hacer el vendedor... poder verificar cuáles
// son los usuarios que ha creado ese vendedor, si están activos, podrá
// modificarlos y ver todo el seguimiento de cada uno"): mismas
// capacidades que vendorStaff.controller.js le da al propio dueño, pero
// tomando el vendorId/staffId de la URL en vez de resolverlo desde
// req.user — un admin puede tocar los usuarios de CUALQUIER tienda. -------

function publicStaffAdmin(staff) {
  const { user, vendor, ...rest } = staff;
  return {
    ...rest,
    email: user.email,
    fullName: user.fullName,
    isSuspended: user.isSuspended,
    lastLoginAt: user.lastLoginAt,
    vendorId: vendor.id,
    vendorName: vendor.companyName,
  };
}

export async function listVendorStaff(req, res) {
  const { id: vendorId } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const staff = await prisma.vendorStaff.findMany({
    where: { vendorId },
    include: {
      user: { select: { email: true, fullName: true, isSuspended: true, lastLoginAt: true } },
      vendor: { select: { id: true, companyName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ staff: staff.map(publicStaffAdmin) });
}

async function findVendorStaffOr404(staffId) {
  const staff = await prisma.vendorStaff.findUnique({
    where: { id: staffId },
    include: {
      user: { select: { id: true, email: true, fullName: true, isSuspended: true, lastLoginAt: true } },
      vendor: { select: { id: true, companyName: true } },
    },
  });
  if (!staff) throw new AppError("Usuario no encontrado.", 404);
  return staff;
}

// Bloque 187 (bug real reportado en vivo — el admin no tenía forma de
// guardar el nivel view/manage que sí existe del lado del vendedor desde
// Bloque 185: `allowedSections` acá seguía siendo `z.array(z.string())`
// suelto en vez del enum, y `sectionPermissions` no existía ni en el
// schema ni en el `data` del update — cualquier intento de mandarlo se
// descartaba en silencio): mismo criterio de paridad que el resto de este
// archivo ("el admin puede controlar y verificar lo mismo que el
// vendedor").
const updateVendorStaffByAdminSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  email: z.string().email().optional(),
  // Bloque 200: ya NO exige mínimo 1 — mismo criterio que
  // vendorStaff.controller.js (un usuario sin ninguna sección es válido,
  // solo ve "Mi perfil").
  allowedSections: z.array(z.enum(VENDOR_SECTION_KEYS)).optional(),
  sectionPermissions: z.record(z.enum(VENDOR_SECTION_KEYS), z.enum(["view", "manage"])).optional(),
  isActive: z.boolean().optional(),
  staffType: z.enum(["SALES_AGENT", "WAITER"]).nullable().optional(),
});

export async function updateVendorStaffByAdmin(req, res) {
  const staff = await findVendorStaffOr404(req.params.id);
  const data = updateVendorStaffByAdminSchema.parse(req.body);

  if (data.email) {
    const existing = await prisma.user.findUnique({ where: { email: data.email.trim().toLowerCase() } });
    if (existing && existing.id !== staff.userId) throw new AppError("Ese correo ya está en uso por otra cuenta.", 409);
  }

  // Bloque 187/200: mismo criterio que updateMyStaff (vendorStaff.controller.js)
  // — si esta llamada cambia allowedSections, sectionPermissions se
  // recalcula contra la lista NUEVA, nunca la vieja; cambiar el tipo agrega
  // sus secciones default (union, nunca reemplazo).
  const sectionsBeforeTypeMerge = data.allowedSections ?? staff.allowedSections;
  const nextSections =
    data.staffType !== undefined ? withStaffTypeSections(sectionsBeforeTypeMerge, data.staffType) : sectionsBeforeTypeMerge;
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
        ...(data.staffType !== undefined ? { staffType: data.staffType } : {}),
        sectionPermissions: pruneSectionPermissions(nextSections, nextPermissions),
      },
    }),
  ]);

  if (data.isActive === false) {
    await prisma.session.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: staff.vendorId,
    action: "admin_updated_vendor_staff",
    description: `Un admin actualizó al usuario "${updatedUser.fullName}" (${updatedUser.email}) de "${staff.vendor.companyName}"`,
    meta: { staffUserId: staff.userId, changes: data },
  });

  res.json({ staff: publicStaffAdmin({ ...updatedStaff, user: updatedUser, vendor: staff.vendor }) });
}

// Bloque 183: mismo criterio que resetMyStaffPassword (vendorStaff.controller.js)
// — nunca una contraseña que el admin escribe por la persona, siempre
// mustSetPassword para que la elija ella misma por el flujo de código.
export async function resetVendorStaffPasswordByAdmin(req, res) {
  const staff = await findVendorStaffOr404(req.params.id);

  const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  await prisma.user.update({ where: { id: staff.userId }, data: { passwordHash: unusablePasswordHash, mustSetPassword: true } });
  await prisma.session.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } });

  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: staff.vendorId,
    action: "admin_reset_vendor_staff_password",
    description: `Un admin restableció la contraseña de "${staff.user.fullName}" (${staff.user.email}) de "${staff.vendor.companyName}"`,
    meta: { staffUserId: staff.userId },
  });

  res.json({ ok: true });
}

export async function getVendorStaffActivityByAdmin(req, res) {
  const staff = await findVendorStaffOr404(req.params.id);
  const activity = await prisma.activityLog.findMany({
    where: { actorId: staff.userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ activity });
}

export async function getVendorStaffSessionsByAdmin(req, res) {
  const staff = await findVendorStaffOr404(req.params.id);
  const sessions = await prisma.session.findMany({
    where: { userId: staff.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true },
  });
  res.json({ sessions });
}

// --- Verificaciones KYC + cobro de suscripción (Bloque 16) -----------------

// Bloque 64: la lista es una fila por TIENDA (no por VerificationRequest —
// el estado vive en Vendor.verificationStatus ahora), con los datos de
// documentos/pago anidados. Sin `status` en el query, excluye NOT_STARTED
// (tiendas que nunca iniciaron el trámite no tienen nada que revisar acá).
export async function listVerifications(req, res) {
  const { status } = req.query;
  // Bloque 64: acepta uno o varios valores separados por coma (AdminVerifications.jsx
  // agrupa PENDING_DOCS+IN_REVIEW en una sola pestaña, PAYMENT_FAILED+SUSPENDED en otra).
  const statuses = status ? String(status).toUpperCase().split(",") : null;
  const vendors = await prisma.vendor.findMany({
    where: { verificationStatus: statuses ? { in: statuses } : { not: "NOT_STARTED" } },
    include: {
      verification: true,
      locations: { include: { province: true }, take: 1 },
      // Bloque 66: datos legales privados de verificación — solo se exponen
      // acá (panel de admin), nunca en un endpoint público.
      registrationCountry: true,
      legalProvince: true,
      legalMunicipality: true,
      // Bloque 145 (pedido explícito — "24 horas luego de ser aprobada"): el
      // admin también ve cuánto le queda a cada solicitud en Pago pendiente,
      // mismo cálculo real que usa el cron (expireStalePendingPaymentApprovals).
      verificationStatusLogs: { where: { toStatus: "PENDING_PAYMENT" }, orderBy: { at: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  // Bloque 153 (pedido explícito — "debe salir... desde cuándo se
  // verificó"): la transición MÁS RECIENTE a VERIFIED por tienda — consulta
  // aparte porque Prisma no permite 2 filtros distintos sobre la MISMA
  // relación (verificationStatusLogs) dentro de un solo `include`.
  // `distinct` + `orderBy` de más reciente a más viejo da, por vendorId,
  // solo la entrada vigente (si perdió y recuperó la verificación varias
  // veces, esta es la del ciclo actual, no la primera vez de todas).
  const verifiedSinceLogs = await prisma.verificationStatusLog.findMany({
    where: { vendorId: { in: vendors.map((v) => v.id) }, toStatus: "VERIFIED" },
    orderBy: { at: "desc" },
    distinct: ["vendorId"],
  });
  const verifiedSinceByVendor = new Map(verifiedSinceLogs.map((l) => [l.vendorId, l.at]));

  const verifications = vendors.map((v) => ({
    id: v.verification?.id ?? v.id,
    vendorId: v.id,
    verificationStatus: v.verificationStatus,
    nextPaymentDueDate: v.nextPaymentDueDate,
    // Bloque 153: "desde cuándo se registró" (Vendor.createdAt, siempre
    // real, nunca se pisa) y "desde cuándo está verificada" (la transición
    // vigente a VERIFIED, null si nunca lo estuvo o la perdió) — separado
    // del `createdAt` de más abajo, que es el de la SOLICITUD actual.
    vendorCreatedAt: v.createdAt,
    verifiedSince: verifiedSinceByVendor.get(v.id) ?? null,
    // Bloque 145: solo tiene sentido mientras sigue en PENDING_PAYMENT — una
    // vez que pasa a VERIFIED/REJECTED/etc. el plazo ya no aplica.
    paymentDeadlineAt:
      v.verificationStatus === "PENDING_PAYMENT" && v.verificationStatusLogs[0]
        ? new Date(v.verificationStatusLogs[0].at.getTime() + 24 * 60 * 60 * 1000)
        : null,
    vendor: {
      id: v.id,
      companyName: v.companyName,
      email: v.email,
      // Bloque 145 (pedido explícito — "recopilar más información"): el
      // admin no tenía forma de contactar a la tienda desde esta pantalla
      // sin ir a buscarla a otro lado.
      whatsapp: v.whatsapp,
      color: v.color,
      locations: v.locations,
      description: v.description,
      ownerIdNumber: v.ownerIdNumber,
      companyTaxId: v.companyTaxId,
      registrationCountry: v.registrationCountry?.name ?? null,
      legalProvince: v.legalProvince?.name ?? null,
      legalMunicipality: v.legalMunicipality?.name ?? null,
      companyAddress: v.companyAddress,
    },
    fullName: v.verification?.fullName ?? null,
    idNumber: v.verification?.idNumber ?? null,
    idDocumentType: v.verification?.idDocumentType ?? null,
    selfieUrl: v.verification?.selfieUrl ?? null,
    idPhotoFrontUrl: v.verification?.idPhotoFrontUrl ?? null,
    selfieVideoUrl: v.verification?.selfieVideoUrl ?? null,
    notes: v.verification?.notes ?? null,
    paymentMethod: v.verification?.paymentMethod ?? null,
    // Bloque 150: cuántos meses eligió pagar y lo que declaró al reclamar el
    // pago — quién pagó, con qué cuenta/teléfono (CUP) o los datos de
    // respaldo si no pudo subir captura (CARD), y el monto que dice haber
    // pagado (lo que el admin compara contra lo esperado antes de confirmar).
    paymentMonths: v.verification?.paymentMonths ?? null,
    paymentCurrency: v.verification?.paymentCurrency ?? null,
    paymentAmount: v.verification?.paymentAmount ?? null,
    payerName: v.verification?.payerName ?? null,
    payerAccountNumber: v.verification?.payerAccountNumber ?? null,
    payerPhone: v.verification?.payerPhone ?? null,
    payerAddress: v.verification?.payerAddress ?? null,
    payerCountry: v.verification?.payerCountry ?? null,
    payerCardLast4: v.verification?.payerCardLast4 ?? null,
    paymentProofUrl: v.verification?.paymentProofUrl ?? null,
    paymentProofUnavailable: v.verification?.paymentProofUnavailable ?? false,
    paymentClaimedAt: v.verification?.paymentClaimedAt ?? null,
    stripePaidAt: v.verification?.stripePaidAt ?? null,
    paymentConfirmedAt: v.verification?.paymentConfirmedAt ?? null,
    paymentConfirmedById: v.verification?.paymentConfirmedById ?? null,
    stripeCheckoutUrl: v.verification?.stripeCheckoutUrl ?? null,
    stripeCheckoutExpiresAt: v.verification?.stripeCheckoutExpiresAt ?? null,
    createdAt: v.verification?.createdAt ?? v.createdAt,
  }));
  res.json({ verifications });
}

// Bloque 64: acción ligera para que un admin "tome" una solicitud —
// PENDING_DOCS -> IN_REVIEW, sin notificar al vendedor (no es una decisión
// todavía, solo evita que dos admins revisen la misma solicitud a ciegas).
// Mismo :id que updateVerification/confirmCupPayment (VerificationRequest.id).
export async function startVerificationReview(req, res) {
  const { id } = req.params;
  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  if (verification.vendor.verificationStatus !== "PENDING_DOCS") {
    throw new AppError("Esta solicitud no está esperando que se abra para revisión.", 409);
  }
  const updated = await transitionVendorVerification(verification.vendorId, "IN_REVIEW", { actorId: req.user.id, source: "ADMIN_ACTION" });
  res.json({ vendor: updated });
}

const decideVerificationSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().optional(),
});

// Fase 1 (documentos): aprobar NO activa la verificación todavía — solo pasa
// la solicitud a PENDING_PAYMENT. El badge/Plan Business se activan recién
// en la fase 2 (ver confirmSubscriptionPayment más abajo — desde el Bloque
// 150 esa fase es SIEMPRE una confirmación manual del admin, tarjeta o CUP
// por igual). Rechazar sí es definitivo en esta fase. Nunca se puede
// aprobar sin las 2 fotos — submitVerification ya las exige juntas.
export async function updateVerification(req, res) {
  const { id } = req.params;
  const { decision, notes } = decideVerificationSchema.parse(req.body);

  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  if (!["PENDING_DOCS", "IN_REVIEW"].includes(verification.vendor.verificationStatus)) {
    throw new AppError("Esta solicitud ya no está en revisión de documentos.", 409);
  }
  if (decision === "reject" && !notes?.trim()) throw new AppError("Indica el motivo del rechazo.", 400);
  if (decision === "approve" && !(verification.selfieUrl && verification.idPhotoFrontUrl)) {
    throw new AppError("Faltan documentos — no se puede aprobar una solicitud incompleta.", 409);
  }

  await prisma.verificationRequest.update({
    where: { id },
    data: { notes: notes ?? null, reviewedById: req.user.id, reviewedAt: new Date() },
  });
  // Bloque 150: refleja la revisión en la rama de archivo vigente — el
  // rejectedAt (si aplica) ya lo cierra transitionVendorVerification abajo.
  await syncVerificationArchive(verification.vendorId, { reviewedAt: new Date(), reviewedById: req.user.id, notes: notes ?? null });

  const toStatus = decision === "approve" ? "PENDING_PAYMENT" : "REJECTED";
  const updated = await transitionVendorVerification(verification.vendorId, toStatus, {
    reason: notes ?? null,
    actorId: req.user.id,
    source: "ADMIN_ACTION",
    notify: { type: decision === "approve" ? "VERIFICATION_DOCS_APPROVED" : "VERIFICATION_DOCS_REJECTED" },
  });

  res.json({ verification: updated });
}

// Fase 2 (Bloque 150, reescribe confirmCupPayment de antes): ahora cubre
// CARD Y CUP_TRANSFER por igual — "el administrador reciba correctamente el
// documento... y de allí pueda concluir y finalizar la aprobación". Ninguno
// de los 2 métodos se confirma solo: Stripe deja `stripePaidAt` por webhook
// (checkout.session.completed, ver verification.controller.js) pero el
// admin igual revisa el comprobante/datos declarados por el vendedor antes
// de activar — mismo criterio que ya regía para CUP desde el Bloque 16.
// También cubre la RENOVACIÓN (Bloque 64): una tienda en PAYMENT_FAILED/
// SUSPENDED por vencimiento puede volver a VERIFIED acá mismo, sin rehacer
// documentos.
export async function confirmSubscriptionPayment(req, res) {
  const { id } = req.params;
  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  const canConfirm = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"].includes(verification.vendor.verificationStatus);
  if (!canConfirm || !verification.paymentMethod) {
    throw new AppError("Esta solicitud no está esperando confirmación de pago.", 409);
  }
  if (!verification.paymentClaimedAt) {
    throw new AppError("El vendedor todavía no reclamó el pago (\"Ya pagué\") desde su panel.", 409);
  }

  await prisma.verificationRequest.update({
    where: { id },
    data: { paymentConfirmedAt: new Date(), paymentConfirmedById: req.user.id },
  });
  await syncVerificationArchive(verification.vendorId, { paymentConfirmedAt: new Date(), paymentConfirmedById: req.user.id });

  // Bloque 150: el ciclo dura tantos días como meses eligió el vendedor
  // (1..24), ya no un mes fijo siempre — mismo criterio para CARD y CUP.
  const months = verification.paymentMonths ?? 1;
  const nextPaymentDueDate = new Date(Date.now() + months * PAYMENT_CYCLE_DAYS * 24 * 60 * 60 * 1000);
  const updated = await transitionVendorVerification(verification.vendorId, "VERIFIED", {
    actorId: req.user.id,
    source: "ADMIN_ACTION",
    extraData: { planType: "BUSINESS", nextPaymentDueDate },
    notify: { type: "VERIFICATION_VERIFIED" },
  });

  res.json({ verification: updated });
}

// Bloque 151 (pedido explícito — "también se podrá cambiar desde el panel
// de administrador... ver la solicitud de la tienda y cambiarle el método
// de pago o restablecerlo para que él pueda seleccionar otro diferente"):
// limpia el método elegido (y cualquier rastro de pago/reclamo/checkout de
// ESE método) sin tocar el estado de verificación — la tienda sigue en
// PENDING_PAYMENT/PAYMENT_FAILED/SUSPENDED como antes, pero
// `chooseMyPaymentMethod` vuelve a mostrarse en el panel del vendedor
// porque `paymentMethod` queda en null. No rechaza si ya se había
// reclamado o incluso confirmado un pago viejo (eso ya se cerró en
// `paymentConfirmedAt`/`verifiedAt` de la rama de archivo, este reset no
// los toca) — solo limpia lo que hace falta para que el vendedor pueda
// elegir un método distinto desde cero.
export async function resetVerificationPaymentMethod(req, res) {
  const { id } = req.params;
  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  const canReset = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"].includes(verification.vendor.verificationStatus);
  if (!canReset || !verification.paymentMethod) {
    throw new AppError("Esta solicitud no tiene ningún método de pago elegido para restablecer.", 409);
  }

  const reset = {
    paymentMethod: null,
    paymentMonths: null,
    paymentCurrency: null,
    paymentClaimedAt: null,
    paymentConfirmedAt: null,
    paymentConfirmedById: null,
    paymentProofUrl: null,
    paymentProofUnavailable: false,
    // stripeCheckoutSessionId/Url/ExpiresAt/stripePaymentIntentId: solo
    // existen en VerificationRequest (estado operativo efímero del link de
    // checkout — VerificationArchive nunca los tuvo, solo guarda
    // `stripePaidAt` como hecho archivable), así que se limpian acá pero se
    // excluyen del `archivePatch` de abajo para no romper el sync contra
    // columnas que no existen en ese modelo.
    stripeCheckoutSessionId: null,
    stripeCheckoutUrl: null,
    stripeCheckoutExpiresAt: null,
    stripePaidAt: null,
    stripePaymentIntentId: null,
    payerName: null,
    payerAccountNumber: null,
    payerPhone: null,
    payerAddress: null,
    payerCountry: null,
    payerCardLast4: null,
  };
  const { stripeCheckoutSessionId, stripeCheckoutUrl, stripeCheckoutExpiresAt, stripePaymentIntentId, ...archivePatch } = reset;
  await prisma.verificationRequest.update({ where: { id }, data: reset });
  await syncVerificationArchive(verification.vendorId, archivePatch);
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: verification.vendorId,
    action: "verification_payment_method_reset",
    description: `Restableció el método de pago (antes: ${verification.paymentMethod})`,
  });
  await notifyVerificationEvent(verification.vendor, "VERIFICATION_PAYMENT_METHOD_RESET").catch(() => {});

  res.json({ ok: true });
}

// --- Renovaciones de suscripción (Bloque 153, pedido explícito) ------------
// "Una vez el cliente esté verificado... podrá activar un nuevo mes o
// varios... el admin debe aprobar los demás meses pagos... todo eso irá
// quedando archivado en el historial de esa tienda" — cada renovación es
// una fila propia de SubscriptionPayment (ver verification.controller.js),
// nunca se pisa la anterior; acá solo vive la confirmación del admin.
export async function listPendingSubscriptionPayments(_req, res) {
  const payments = await prisma.subscriptionPayment.findMany({
    where: { confirmedAt: null, claimedAt: { not: null } },
    include: { vendor: { select: { id: true, companyName: true, color: true, email: true, whatsapp: true } } },
    orderBy: { claimedAt: "asc" },
  });
  res.json({ payments });
}

// Bloque 153 (pedido explícito — "quiero que esas cuentas sean bien
// estrictas"): el nuevo vencimiento se calcula desde el vencimiento REAL
// vigente (si todavía no pasó) — nunca desde "ahora", que le regalaría
// días de más a quien ya tenía tiempo pagado por delante, ni desde una
// fecha vencida, que le robaría días a quien renovó tarde. Extiende
// `Vendor.nextPaymentDueDate` (la misma fuente que ya usan el cron de
// vencimiento y el resto del ciclo) — nunca un campo aparte.
export async function confirmSubscriptionRenewal(req, res) {
  const { id } = req.params;
  const payment = await prisma.subscriptionPayment.findUnique({ where: { id }, include: { vendor: true } });
  if (!payment) throw new AppError("Pago no encontrado.", 404);
  if (payment.confirmedAt) throw new AppError("Este pago ya fue confirmado.", 409);
  if (!payment.claimedAt) throw new AppError('El vendedor todavía no reclamó este pago ("Ya pagué").', 409);

  const now = new Date();
  const periodStart = payment.vendor.nextPaymentDueDate && payment.vendor.nextPaymentDueDate > now ? payment.vendor.nextPaymentDueDate : now;
  const periodEnd = new Date(periodStart.getTime() + payment.months * PAYMENT_CYCLE_DAYS * 24 * 60 * 60 * 1000);

  const updated = await prisma.subscriptionPayment.update({
    where: { id },
    data: { confirmedAt: now, confirmedById: req.user.id, periodStart, periodEnd },
  });
  await prisma.vendor.update({ where: { id: payment.vendorId }, data: { nextPaymentDueDate: periodEnd } });
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: payment.vendorId,
    action: "subscription_renewal_confirmed",
    description: `Confirmó la renovación (${payment.months} ${payment.months === 1 ? "mes" : "meses"}, hasta ${periodEnd.toLocaleDateString("es-CU")})`,
  });
  await notifyVerificationEvent(payment.vendor, "SUBSCRIPTION_RENEWAL_CONFIRMED", {
    notes: `hasta el ${periodEnd.toLocaleDateString("es-CU")}`,
  }).catch(() => {});

  res.json({ payment: updated });
}

// --- Solicitudes de cambio de identidad (Bloque 153, pedido explícito) ----
// "todos los datos de la tienda no se pueden modificar después de estar
// verificadas sin aprobación del admin... si se desea cambiar el nombre o
// el responsable se debe enviar la solicitud al admin para prevenir
// fraudes."
export async function listVendorChangeRequests(req, res) {
  const { status } = req.query;
  const requests = await prisma.vendorChangeRequest.findMany({
    where: { status: status ? String(status).toUpperCase() : "PENDING" },
    include: { vendor: { select: { id: true, companyName: true, color: true, email: true, whatsapp: true, verificationStatus: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ requests });
}

const decideChangeRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().optional(),
});

// Aprobar APLICA los cambios de verdad a Vendor (solo los campos que la
// solicitud trae, nunca pisa los demás) — rechazar solo cierra la
// solicitud con un motivo, la tienda queda tal cual estaba.
export async function decideVendorChangeRequest(req, res) {
  const { id } = req.params;
  const { decision, notes } = decideChangeRequestSchema.parse(req.body);

  const request = await prisma.vendorChangeRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!request) throw new AppError("Solicitud no encontrada.", 404);
  if (request.status !== "PENDING") throw new AppError("Esta solicitud ya fue resuelta.", 409);
  if (decision === "reject" && !notes?.trim()) throw new AppError("Indica el motivo del rechazo.", 400);

  if (decision === "approve") {
    await prisma.vendor.update({
      where: { id: request.vendorId },
      data: {
        ...(request.companyName ? { companyName: request.companyName } : {}),
        ...(request.ownerName ? { ownerName: request.ownerName } : {}),
        ...(request.ownerIdNumber ? { ownerIdNumber: request.ownerIdNumber } : {}),
        ...(request.companyAddress ? { companyAddress: request.companyAddress } : {}),
      },
    });
  }

  const updated = await prisma.vendorChangeRequest.update({
    where: { id },
    data: { status: decision === "approve" ? "APPROVED" : "REJECTED", adminNotes: notes ?? null, reviewedById: req.user.id, reviewedAt: new Date() },
  });
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: request.vendorId,
    action: decision === "approve" ? "vendor_change_approved" : "vendor_change_rejected",
    description: decision === "approve" ? "Aprobó una solicitud de cambio de datos" : `Rechazó una solicitud de cambio de datos: ${notes}`,
  });
  await notifyVerificationEvent(request.vendor, decision === "approve" ? "VENDOR_CHANGE_REQUEST_APPROVED" : "VENDOR_CHANGE_REQUEST_REJECTED", {
    notes,
  }).catch(() => {});

  res.json({ changeRequest: updated });
}

// --- Suscripciones Business (Bloque 46, recurrente desde Bloque 64) --------
export async function listSubscriptions(_req, res) {
  const vendors = await prisma.vendor.findMany({
    where: { planType: "BUSINESS", deletedAt: null },
    include: {
      verification: true,
      locations: { include: { province: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  // Bloque 64: verificationStatus ES el estado — ya no hace falta derivarlo
  // de isVerified/status por separado (esa desincronía era justo el bug que
  // motivó este bloque).
  const STATUS_LABEL = {
    VERIFIED: "active",
    PAYMENT_FAILED: "payment_failed",
    SUSPENDED: "suspended",
    REJECTED: "rejected",
  };
  const subscriptions = vendors.map((v) => {
    const ver = v.verification;
    return {
      vendorId: v.id,
      companyName: v.companyName,
      slug: v.slug,
      color: v.color,
      province: v.locations?.[0]?.province?.name ?? null,
      status: STATUS_LABEL[v.verificationStatus] ?? "pending_payment",
      nextPaymentDueDate: v.nextPaymentDueDate,
      hasStripeSubscription: !!v.stripeSubscriptionId,
      paymentMethod: ver?.paymentMethod ?? null,
      paymentConfirmedAt: ver?.paymentConfirmedAt ?? null,
      stripeCheckoutUrl: ver?.stripeCheckoutUrl ?? null,
      stripeCheckoutExpired: ver?.stripeCheckoutExpiresAt ? ver.stripeCheckoutExpiresAt < new Date() : false,
    };
  });

  const active = subscriptions.filter((s) => s.status === "active").length;
  const pendingPayment = subscriptions.filter((s) => s.status === "pending_payment").length;
  const rejected = subscriptions.filter((s) => s.status === "rejected").length;
  const paymentFailed = subscriptions.filter((s) => s.status === "payment_failed").length;
  const suspended = subscriptions.filter((s) => s.status === "suspended").length;

  // Bloque 150: precio dinámico (antes SUBSCRIPTION_PRICE_USD, constante
  // fija) — mismo criterio que cupSubscriptionPriceCup, editable sin
  // redeploy desde AdminSubscriptions.jsx.
  const { cardPricePerMonthUsd } = await getSubscriptionPricing();
  res.json({
    subscriptions,
    metrics: { active, pendingPayment, rejected, paymentFailed, suspended, mrrUsd: active * cardPricePerMonthUsd },
  });
}

// Manual — el admin decide revocar (impago, incumplimiento, pedido del
// vendedor, etc.), a diferencia de PAYMENT_FAILED/SUSPENDED que solo los
// disparan Stripe o el cron de vencimiento. Si la tienda pagaba por Stripe,
// cancela la suscripción DE VERDAD ahí también — sin esto Stripe seguiría
// cobrándole al vendedor cada mes por un plan que ya no tiene acá.
export async function revokeBusinessPlan(req, res) {
  const { id } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  if (vendor.planType !== "BUSINESS") throw new AppError("Esta tienda no tiene el Plan Business activo.", 409);

  if (vendor.stripeSubscriptionId) await cancelStripeSubscription(vendor.stripeSubscriptionId);

  const updated = await transitionVendorVerification(id, "SUSPENDED", {
    actorId: req.user.id,
    source: "ADMIN_ACTION",
    extraData: { planType: "REGULAR", stripeSubscriptionId: null },
    notify: { type: "VERIFICATION_BUSINESS_REVOKED" },
  });
  res.json({ vendor: updated });
}

// --- Clientes ------------------------------------------------------------

export async function listCustomers(req, res) {
  const customers = await prisma.user.findMany({
    where: { role: "CUSTOMER", deletedAt: null },
    // Feature B (pedido explícito): "cliente de alto riesgo" es DERIVADO —
    // cuántos reportes de fraude hizo (reportsMade), sin campo booleano
    // nuevo que pueda desincronizarse. No filtra por status del reporte
    // (un reporte descartado también cuenta para el patrón de uso, es
    // información para el admin, no una acusación).
    include: { province: true, _count: { select: { orders: true, reportsMade: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({
    customers: customers.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      phone: c.phone,
      province: c.province?.name ?? null,
      orderCount: c._count.orders,
      reportsMadeCount: c._count.reportsMade,
      isSuspended: c.isSuspended,
    })),
  });
}

const updateCustomerSchema = z.object({
  isSuspended: z.boolean().optional(),
  fullName: z.string().min(2).optional(),
  email: z.string().email().optional(),
  phone: z.string().min(8).optional(),
});

export async function updateCustomer(req, res) {
  const { id } = req.params;
  const data = updateCustomerSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "CUSTOMER" || user.deletedAt) throw new AppError("Cliente no encontrado.", 404);

  if (data.email) {
    const existing = await prisma.user.findUnique({ where: { email: data.email } });
    if (existing && existing.id !== id) throw new AppError("Ese correo ya está en uso por otra cuenta.", 409);
  }

  const updated = await prisma.user.update({ where: { id }, data });
  res.json({ customer: { id: updated.id, fullName: updated.fullName, email: updated.email, phone: updated.phone, isSuspended: updated.isSuspended } });
}

// Soft-delete: la fila de User se conserva (pedidos históricos guardan
// customerId real) pero isSuspended:true bloquea el login (ver
// auth.controller.js) y deletedAt la saca de listCustomers.
export async function deleteCustomer(req, res) {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "CUSTOMER") throw new AppError("Cliente no encontrado.", 404);

  await finalizeUserDeletion(id);
  res.status(204).end();
}

// --- Chat vendedor <-> admin (Bloque 15) ------------------------------------
// Un solo hilo por tienda: no hay entidad "Conversation" separada, ver nota
// en schema.prisma. Esta lista sirve tanto para responder hilos iniciados
// por el vendedor como para que el admin le escriba primero a cualquiera —
// mismo camino de UI para ambos casos, sin duplicar un sistema aparte.
export async function listConversations(_req, res) {
  const vendors = await prisma.vendor.findMany({
    where: { deletedAt: null },
    select: {
      id: true,
      companyName: true,
      verificationStatus: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { messages: { where: { senderRole: "VENDOR", readAt: null } } } },
    },
  });

  const conversations = vendors
    .map((v) => ({
      vendorId: v.id,
      companyName: v.companyName,
      isVerified: v.verificationStatus === "VERIFIED",
      lastMessage: v.messages[0] ?? null,
      unreadCount: v._count.messages,
    }))
    // Tiendas con conversación primero (más reciente arriba), después el
    // resto sin ordenar por actividad (nunca escribieron ni les escribieron).
    .sort((a, b) => {
      if (!a.lastMessage && !b.lastMessage) return a.companyName.localeCompare(b.companyName);
      if (!a.lastMessage) return 1;
      if (!b.lastMessage) return -1;
      return new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt);
    });

  res.json({ conversations });
}

export async function getConversation(req, res) {
  const { vendorId } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, companyName: true, verificationStatus: true } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const messages = await prisma.vendorMessage.findMany({ where: { vendorId }, orderBy: { createdAt: "asc" } });
  res.json({ vendor: { ...vendor, isVerified: vendor.verificationStatus === "VERIFIED" }, messages });
}

const adminSendMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export async function sendConversationMessage(req, res) {
  const { vendorId } = req.params;
  const { body } = adminSendMessageSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const message = await prisma.vendorMessage.create({
    data: { vendorId, senderRole: "ADMIN", senderId: req.user.id, body },
  });
  res.status(201).json({ message });
}

// Se llama cuando el admin efectivamente abre el hilo de esa tienda (no al
// recibir en el backend) — marca como leídos los mensajes que mandó el
// vendedor.
export async function markConversationRead(req, res) {
  const { vendorId } = req.params;
  await prisma.vendorMessage.updateMany({
    where: { vendorId, senderRole: "VENDOR", readAt: null },
    data: { readAt: new Date() },
  });
  res.status(204).end();
}

// --- Correo directo (Bloque 47) --------------------------------------------
// Distinto de AdminCampaigns.jsx (envío masivo segmentado, no se toca): esto
// es un correo puntual a UN destinatario elegido a mano.

const sendEmailSchema = z.object({
  recipientType: z.enum(["customer", "vendor"]),
  recipientId: z.string().min(1),
  subject: z.string().trim().min(2),
  message: z.string().trim().min(2),
});

export async function sendAdminEmail(req, res) {
  const { recipientType, recipientId, subject, message } = sendEmailSchema.parse(req.body);

  let to, recipientName, vendorId;
  if (recipientType === "customer") {
    const user = await prisma.user.findUnique({ where: { id: recipientId } });
    if (!user || user.role !== "CUSTOMER") throw new AppError("Cliente no encontrado.", 404);
    if (!user.email) throw new AppError("Este cliente no tiene un correo cargado.", 400);
    to = user.email;
    recipientName = user.fullName ?? null;
  } else {
    const vendor = await prisma.vendor.findUnique({ where: { id: recipientId } });
    if (!vendor) throw new AppError("Tienda no encontrada.", 404);
    if (!vendor.email) throw new AppError("Esta tienda no tiene un correo cargado.", 400);
    to = vendor.email;
    recipientName = vendor.companyName;
    vendorId = vendor.id;
  }

  const result = await sendAdminDirectEmail({ to, subject, message, recipientName, vendorId });
  if (!result.ok) throw new AppError("No se pudo enviar el correo. Revisa la integración de Resend.", 502, { detail: result.error });

  res.json({ ok: true });
}

// --- Búsqueda + notificaciones (Bloque 47) ----------------------------------

export async function adminSearch(req, res) {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ vendors: [], customers: [], orders: [] });

  const [vendors, customers, orders] = await Promise.all([
    prisma.vendor.findMany({
      where: { deletedAt: null, companyName: { contains: q, mode: "insensitive" } },
      select: { id: true, companyName: true },
      take: 8,
    }),
    prisma.user.findMany({
      where: {
        role: "CUSTOMER",
        deletedAt: null,
        OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }],
      },
      select: { id: true, fullName: true, email: true },
      take: 8,
    }),
    prisma.order.findMany({
      where: { code: { startsWith: q.toUpperCase() } },
      select: { id: true, code: true, vendor: { select: { companyName: true } } },
      take: 8,
    }),
  ]);

  res.json({
    vendors: vendors.map((v) => ({ id: v.id, label: v.companyName, to: "/admin/tiendas" })),
    customers: customers.map((c) => ({ id: c.id, label: c.fullName ?? c.email, to: "/admin/clientes" })),
    // No hay una pantalla de detalle de pedido en el admin todavía — el link
    // más útil que existe hoy es la ficha de la tienda dueña del pedido.
    orders: orders.map((o) => ({ id: o.id, label: `${o.code} · ${o.vendor.companyName}`, to: "/admin/tiendas" })),
  });
}

// Agregación en vivo (ver decisión D del bloque) — sin tabla de
// notificaciones propia ni estado de "leído" persistente: reusa las mismas
// queries que ya alimentan cada sección (Verificaciones/Sugerencias/Errores/
// Mensajes), solo junta el conteo y los últimos items acá.
// Bloque 231 (pedido explícito — "cuando un cliente envía un pedido se
// debe notificar en tiempo real en el panel de admin"): mismas 2 horas de
// ventana que basta para que la campanita se sienta "en vivo" sin acumular
// pedidos viejos ya vistos hace rato — un pedido no es algo que el admin
// tenga que "resolver" como el resto de esta lista, pero igual entra acá
// (mismo criterio que sugerencias/errores de abajo, que tampoco son
// estrictamente "acción pendiente").
const RECENT_ORDERS_WINDOW_MS = 2 * 60 * 60 * 1000;

export async function listAdminNotifications(_req, res) {
  const [pendingVerifications, newSuggestions, unresolvedErrors, vendorsWithUnread, paymentClaims, reportedReviews, pendingFraudReports, recentOrders] = await Promise.all([
    prisma.vendor.findMany({
      where: { verificationStatus: { in: ["PENDING_DOCS", "IN_REVIEW"] } },
      select: { id: true, companyName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.suggestion.count({ where: { status: "NEW" } }),
    prisma.errorLog.count({ where: { resolved: false } }),
    prisma.vendor.findMany({
      where: { messages: { some: { senderRole: "VENDOR", readAt: null } } },
      select: { id: true, companyName: true, _count: { select: { messages: { where: { senderRole: "VENDOR", readAt: null } } } } },
      take: 5,
    }),
    // Bloque 70 (pedido explícito): pago CUP reclamado ("Ya pagué") sin
    // confirmar todavía por un admin — antes invisible en la campanita.
    prisma.vendor.findMany({
      where: { verification: { paymentClaimedAt: { not: null }, paymentConfirmedById: null } },
      select: { id: true, companyName: true, verification: { select: { paymentClaimedAt: true } } },
      take: 5,
    }),
    // Bloque 70 (pedido explícito): comentario reportado esperando que el
    // admin decida mantener/suspender — antes invisible en la campanita.
    prisma.review.findMany({
      where: { reportStatus: "REPORTED" },
      select: { id: true, reportedAt: true, vendor: { select: { companyName: true } } },
      take: 5,
    }),
    // Feature B (pedido explícito): "el admin debe poder ver, desde su
    // panel, una alerta con el producto/tienda reportado" — mismo criterio
    // que reportedReviews de arriba (sin tabla de notificaciones propia,
    // agregación en vivo).
    prisma.report.findMany({
      where: { status: "PENDING" },
      select: {
        id: true,
        createdAt: true,
        product: { select: { name: true } },
        vendor: { select: { companyName: true } },
        customerListing: { select: { name: true } },
      },
      take: 5,
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: new Date(Date.now() - RECENT_ORDERS_WINDOW_MS) } },
      select: { id: true, code: true, total: true, customerName: true, createdAt: true, vendor: { select: { companyName: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const items = [
    ...pendingVerifications.map((v) => ({
      id: `verification-${v.id}`,
      text: `Verificación pendiente: ${v.companyName}`,
      to: "/admin/verificaciones",
      createdAt: v.createdAt,
    })),
    ...vendorsWithUnread.map((v) => ({
      id: `message-${v.id}`,
      text: `${v._count.messages} mensaje(s) sin leer de ${v.companyName}`,
      to: `/admin/mensajes/${v.id}`,
      createdAt: null,
    })),
    ...paymentClaims.map((v) => ({
      id: `payment-${v.id}`,
      text: `Pago reclamado sin confirmar: ${v.companyName}`,
      to: "/admin/verificaciones",
      createdAt: v.verification?.paymentClaimedAt ?? null,
    })),
    ...reportedReviews.map((r) => ({
      id: `report-${r.id}`,
      text: `Comentario reportado${r.vendor ? ` — ${r.vendor.companyName}` : ""}`,
      to: "/admin/comentarios",
      createdAt: r.reportedAt,
    })),
    ...pendingFraudReports.map((r) => ({
      id: `fraud-${r.id}`,
      text: `Reporte de fraude: ${r.product?.name ?? r.vendor?.companyName ?? r.customerListing?.name ?? "objetivo eliminado"}`,
      to: "/admin/reportes-fraude",
      createdAt: r.createdAt,
    })),
    // Bloque 231 (pedido explícito): visibilidad en tiempo real de pedidos
    // nuevos — no hay una vista de detalle de pedido del lado admin, así
    // que el destino es la tienda que lo recibió (mismo criterio que
    // paymentClaims/pendingVerifications de arriba, que tampoco enlazan a
    // un registro puntual).
    ...recentOrders.map((o) => ({
      id: `order-${o.id}`,
      text: `Pedido nuevo ${o.code} — ${o.vendor.companyName} (${Number(o.total).toLocaleString("es-CU")} CUP)`,
      to: "/admin/vendedores",
      createdAt: o.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

  if (newSuggestions > 0) {
    items.push({ id: "suggestions", text: `${newSuggestions} sugerencia(s) nueva(s)`, to: "/admin/sugerencias", createdAt: null });
  }
  if (unresolvedErrors > 0) {
    items.push({ id: "errors", text: `${unresolvedErrors} error(es) sin resolver`, to: "/admin/errores", createdAt: null });
  }

  const total =
    pendingVerifications.length +
    newSuggestions +
    unresolvedErrors +
    vendorsWithUnread.reduce((sum, v) => sum + v._count.messages, 0) +
    paymentClaims.length +
    reportedReviews.length +
    pendingFraudReports.length +
    recentOrders.length;

  res.json({ items: items.slice(0, 12), total });
}

// --- Historial de actividad (Bloque 70, pedido explícito) -------------------
// "una sección dedicada a todas las acciones de vendedores y de clientes...
// para tener un récord de todo lo que hacen en sus paneles" — lista cruda
// (listActivityLog) + agregación de uso por vendedor/cliente para el gráfico
// de "quién más usa la plataforma" (getActivityStats). Alimentado por
// logActivity() (lib/activityLog.js), llamado best-effort desde cada acción
// relevante ya instrumentada en los controllers de vendedor/cliente.

export async function listActivityLog(req, res) {
  const { role, vendorId, action } = req.query;
  const logs = await prisma.activityLog.findMany({
    where: {
      actorRole: role === "VENDOR" || role === "CUSTOMER" ? role : undefined,
      vendorId: vendorId ? String(vendorId) : undefined,
      action: action ? String(action) : undefined,
    },
    include: {
      actor: { select: { fullName: true, email: true } },
      vendor: { select: { companyName: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 150,
  });
  res.json({ logs });
}

const ACTIVITY_PERIODS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

// Mismo criterio que "Tiendas por provincia" en getDashboard: `pct` viene ya
// calculado server-side (contra el máximo del propio grupo) para que el
// frontend solo dibuje una barra con ese ancho, sin lógica propia.
export async function getActivityStats(req, res) {
  const period = ACTIVITY_PERIODS[req.query.period] ? req.query.period : "day";
  const since = new Date(Date.now() - ACTIVITY_PERIODS[period]);

  const [topVendorGroups, topCustomerGroups, totalActions] = await Promise.all([
    prisma.activityLog.groupBy({
      by: ["vendorId"],
      // Bloque 183: incluye acciones de usuarios de sistema (VENDOR_STAFF)
      // del negocio, no solo del dueño — "cuánto se mueve este vendedor"
      // tiene que contar toda la actividad de su panel, sin importar quién
      // de su equipo la hizo.
      where: { actorRole: { in: ["VENDOR", "VENDOR_STAFF"] }, vendorId: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { vendorId: "desc" } },
      take: 10,
    }),
    prisma.activityLog.groupBy({
      by: ["actorId"],
      where: { actorRole: "CUSTOMER", createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { actorId: "desc" } },
      take: 10,
    }),
    prisma.activityLog.count({ where: { createdAt: { gte: since } } }),
  ]);

  const [vendors, customers] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: topVendorGroups.map((g) => g.vendorId) } },
      select: { id: true, companyName: true, slug: true },
    }),
    prisma.user.findMany({
      where: { id: { in: topCustomerGroups.map((g) => g.actorId) } },
      select: { id: true, fullName: true, email: true },
    }),
  ]);
  const vendorById = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const customerById = Object.fromEntries(customers.map((c) => [c.id, c]));

  const maxVendorCount = Math.max(1, ...topVendorGroups.map((g) => g._count._all));
  const maxCustomerCount = Math.max(1, ...topCustomerGroups.map((g) => g._count._all));

  res.json({
    period,
    totalActions,
    topVendors: topVendorGroups.map((g) => ({
      vendorId: g.vendorId,
      companyName: vendorById[g.vendorId]?.companyName ?? "Tienda eliminada",
      slug: vendorById[g.vendorId]?.slug ?? null,
      count: g._count._all,
      pct: `${Math.round((g._count._all / maxVendorCount) * 100)}%`,
    })),
    topCustomers: topCustomerGroups.map((g) => ({
      customerId: g.actorId,
      name: customerById[g.actorId]?.fullName ?? customerById[g.actorId]?.email ?? "Cliente eliminado",
      count: g._count._all,
      pct: `${Math.round((g._count._all / maxCustomerCount) * 100)}%`,
    })),
  });
}
