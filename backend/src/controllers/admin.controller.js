import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyVerificationEvent } from "../services/verificationNotify.service.js";
import { SUBSCRIPTION_PRICE_USD } from "../lib/stripe.js";
import { sendAdminDirectEmail } from "../lib/email.js";

// --- Dashboard --------------------------------------------------------------

const BUSINESS_PLAN_PRICE_CUP = 2500;
const E164_REGEX = /^\+\d{7,15}$/;

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
    prisma.vendor.count({ where: { isBlocked: false, deletedAt: null } }),
    prisma.user.count({ where: { role: "CUSTOMER", deletedAt: null } }),
    prisma.order.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.tableOrder.count({ where: { createdAt: { gte: monthStart } } }),
    prisma.order.aggregate({ _sum: { total: true } }),
    prisma.tableOrder.aggregate({ _sum: { total: true } }),
    prisma.verificationRequest.count({ where: { status: "PENDING_REVIEW" } }),
    prisma.vendor.count({ where: { planType: "BUSINESS" } }),
  ]);

  const gmv = Number(orderSum._sum.total ?? 0) + Number(tableOrderSum._sum.total ?? 0);
  const ordersThisMonthTotal = ordersThisMonth + tableOrdersThisMonth;
  // Estimado: no hay tabla de facturación real todavía, se calcula como
  // tiendas Business × precio de lista del plan.
  const subscriptionRevenueEstimate = businessVendors * BUSINESS_PLAN_PRICE_CUP;

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

export async function listVendors(req, res) {
  const { plan } = req.query;
  const vendors = await prisma.vendor.findMany({
    where: { planType: plan === "business" ? "BUSINESS" : plan === "regular" ? "REGULAR" : undefined, deletedAt: null },
    include: { locations: { include: { province: true }, take: 1 }, category: true },
    orderBy: { createdAt: "desc" },
  });
  res.json({ vendors });
}

const updateVendorSchema = z.object({
  isBlocked: z.boolean().optional(),
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
});

export async function updateVendor(req, res) {
  const { id } = req.params;
  const data = updateVendorSchema.parse(req.body);
  if (data.email === "") data.email = null;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);

  // Bloque 46 (auditoría de conexión — bug real encontrado): "Bloquear" solo
  // ocultaba la tienda del sitio público (isBlocked ya se filtraba en
  // listVendors/getVendorBySlug), pero la cuenta del dueño podía seguir
  // entrando a su panel de vendedor sin ningún problema — login() únicamente
  // chequea User.isSuspended, nunca Vendor.isBlocked. Mismo criterio que ya
  // usa deleteVendor (soft-delete) para el caso permanente: sincronizar
  // isSuspended con isBlocked acá también, para el caso reversible.
  const updated =
    data.isBlocked === undefined
      ? await prisma.vendor.update({ where: { id }, data })
      : (
          await prisma.$transaction([
            prisma.vendor.update({ where: { id }, data }),
            prisma.user.update({ where: { id: vendor.userId }, data: { isSuspended: data.isBlocked } }),
          ])
        )[0];
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

  const now = new Date();
  await prisma.$transaction([
    prisma.vendor.update({ where: { id }, data: { deletedAt: now, isBlocked: true } }),
    prisma.user.update({ where: { id: vendor.userId }, data: { deletedAt: now, isSuspended: true } }),
  ]);
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

// --- Verificaciones KYC + cobro de suscripción (Bloque 16) -----------------

export async function listVerifications(req, res) {
  const { status } = req.query;
  const verifications = await prisma.verificationRequest.findMany({
    where: { status: status ? String(status).toUpperCase() : undefined },
    include: {
      vendor: { select: { id: true, companyName: true, email: true, color: true, locations: { include: { province: true }, take: 1 } } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ verifications });
}

const decideVerificationSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().optional(),
});

// Fase 1 (documentos): aprobar NO activa la verificación todavía — solo pasa
// la solicitud a PENDIENTE_PAGO. isVerified/Plan Business se activan recién
// en la fase 2 (ver generatePaymentLink/confirmCupPayment más abajo, y
// confirmPaymentLink en verification.controller.js para el camino
// automático de tarjeta). Rechazar sí es definitivo en esta fase.
export async function updateVerification(req, res) {
  const { id } = req.params;
  const { decision, notes } = decideVerificationSchema.parse(req.body);

  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  if (verification.status !== "PENDING_REVIEW") {
    throw new AppError("Esta solicitud ya no está en revisión de documentos.", 409);
  }
  if (decision === "reject" && !notes?.trim()) throw new AppError("Indicá el motivo del rechazo.", 400);

  const status = decision === "approve" ? "PENDING_PAYMENT" : "REJECTED";

  const updatedVerification = await prisma.verificationRequest.update({
    where: { id },
    data: { status, notes: notes ?? null, reviewedById: req.user.id, reviewedAt: new Date() },
  });

  await notifyVerificationEvent(verification.vendor, decision === "approve" ? "VERIFICATION_DOCS_APPROVED" : "VERIFICATION_DOCS_REJECTED", { notes });

  res.json({ verification: updatedVerification });
}

// Fase 2, vía B (transferencia CUP): no hay forma de confirmar sola una
// transferencia bancaria nacional — el admin la confirma a mano después de
// verificar el comprobante que subió el vendedor (o de cualquier otra forma
// que use para chequearlo, el comprobante es solo una ayuda, no un
// prerrequisito técnico de este endpoint).
export async function confirmCupPayment(req, res) {
  const { id } = req.params;
  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  if (verification.status !== "PENDING_PAYMENT" || verification.paymentMethod !== "CUP_TRANSFER") {
    throw new AppError("Esta solicitud no está esperando confirmación de transferencia CUP.", 409);
  }

  const [updatedVerification] = await prisma.$transaction([
    prisma.verificationRequest.update({
      where: { id },
      data: { status: "APPROVED", paymentConfirmedAt: new Date(), paymentConfirmedById: req.user.id },
    }),
    prisma.vendor.update({ where: { id: verification.vendorId }, data: { isVerified: true, planType: "BUSINESS" } }),
  ]);

  await notifyVerificationEvent(verification.vendor, "VERIFICATION_VERIFIED");
  res.json({ verification: updatedVerification });
}

// --- Suscripciones Business (Bloque 46) -------------------------------------
// ⚠ Sobre datos YA existentes (Vendor.planType + VerificationRequest), no un
// modelo de cobro recurrente nuevo — ver la nota de "Opción A" del bloque:
// no hay stripe subscriptions.create ni webhook de renovación mensual, así
// que no hay vencimiento automático. "active"/"pending_payment"/"rejected"
// es un estado CALCULADO en cada request, nunca guardado aparte (nada que
// pueda desincronizarse de Tiendas/Verificaciones).
export async function listSubscriptions(_req, res) {
  const vendors = await prisma.vendor.findMany({
    where: { planType: "BUSINESS", deletedAt: null },
    include: {
      verification: true,
      locations: { include: { province: true }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  const subscriptions = vendors.map((v) => {
    const ver = v.verification;
    // isVerified es la fuente real de "está activa" (mismo campo que
    // gatea el badge/IA/destacado en el resto del sitio, ver Store.jsx) —
    // nunca un estado aparte que se pueda desincronizar de eso. Cualquier
    // Business no verificado (ej. plan forzado a mano desde Tiendas sin
    // pasar por el ciclo de verificación) cae en "pendiente" salvo que su
    // solicitud haya sido rechazada explícitamente.
    const status = v.isVerified ? "active" : ver?.status === "REJECTED" ? "rejected" : "pending_payment";
    return {
      vendorId: v.id,
      companyName: v.companyName,
      slug: v.slug,
      color: v.color,
      province: v.locations?.[0]?.province?.name ?? null,
      status,
      paymentMethod: ver?.paymentMethod ?? null,
      paymentConfirmedAt: ver?.paymentConfirmedAt ?? null,
      stripeCheckoutUrl: ver?.stripeCheckoutUrl ?? null,
      stripeCheckoutExpired: ver?.stripeCheckoutExpiresAt ? ver.stripeCheckoutExpiresAt < new Date() : false,
    };
  });

  const active = subscriptions.filter((s) => s.status === "active").length;
  const pendingPayment = subscriptions.filter((s) => s.status === "pending_payment").length;
  const rejected = subscriptions.filter((s) => s.status === "rejected").length;

  res.json({
    subscriptions,
    metrics: { active, pendingPayment, rejected, mrrUsd: active * SUBSCRIPTION_PRICE_USD },
  });
}

// Manual, no un vencimiento automático (ver nota de "Opción A" arriba) — el
// admin decide revocar (impago, incumplimiento, pedido del vendedor, etc.).
// Baja isVerified junto con planType a propósito, aunque no sea 100% literal
// del pedido original: el badge/IA/destacado del resto del sitio SIEMPRE
// leen isVerified (ver Store.jsx), así que dejarlo en true acá haría que la
// tienda "revocada" siguiera mostrándose verificada — contradiría la propia
// verificación esperada del bloque ("pierde el badge verificado").
export async function revokeBusinessPlan(req, res) {
  const { id } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  if (vendor.planType !== "BUSINESS") throw new AppError("Esta tienda no tiene el Plan Business activo.", 409);

  const updated = await prisma.vendor.update({
    where: { id },
    data: { planType: "REGULAR", isVerified: false },
  });

  await notifyVerificationEvent(updated, "VERIFICATION_BUSINESS_REVOKED");
  res.json({ vendor: updated });
}

// --- Clientes ------------------------------------------------------------

export async function listCustomers(req, res) {
  const customers = await prisma.user.findMany({
    where: { role: "CUSTOMER", deletedAt: null },
    include: { province: true, _count: { select: { orders: true } } },
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

  await prisma.user.update({ where: { id }, data: { deletedAt: new Date(), isSuspended: true } });
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
      isVerified: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { messages: { where: { senderRole: "VENDOR", readAt: null } } } },
    },
  });

  const conversations = vendors
    .map((v) => ({
      vendorId: v.id,
      companyName: v.companyName,
      isVerified: v.isVerified,
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
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, companyName: true, isVerified: true } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const messages = await prisma.vendorMessage.findMany({ where: { vendorId }, orderBy: { createdAt: "asc" } });
  res.json({ vendor, messages });
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
  if (!result.ok) throw new AppError("No se pudo enviar el correo. Revisá la integración de Resend.", 502, { detail: result.error });

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
export async function listAdminNotifications(_req, res) {
  const [pendingVerifications, newSuggestions, unresolvedErrors, vendorsWithUnread] = await Promise.all([
    prisma.verificationRequest.findMany({
      where: { status: "PENDING_REVIEW" },
      include: { vendor: { select: { companyName: true } } },
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
  ]);

  const items = [
    ...pendingVerifications.map((v) => ({
      id: `verification-${v.id}`,
      text: `Verificación pendiente: ${v.vendor.companyName}`,
      to: "/admin/verificaciones",
      createdAt: v.createdAt,
    })),
    ...vendorsWithUnread.map((v) => ({
      id: `message-${v.id}`,
      text: `${v._count.messages} mensaje(s) sin leer de ${v.companyName}`,
      to: `/admin/mensajes/${v.id}`,
      createdAt: null,
    })),
  ].sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

  if (newSuggestions > 0) {
    items.push({ id: "suggestions", text: `${newSuggestions} sugerencia(s) nueva(s)`, to: "/admin/sugerencias", createdAt: null });
  }
  if (unresolvedErrors > 0) {
    items.push({ id: "errors", text: `${unresolvedErrors} error(es) sin resolver`, to: "/admin/errores", createdAt: null });
  }

  const total = pendingVerifications.length + newSuggestions + unresolvedErrors + vendorsWithUnread.reduce((sum, v) => sum + v._count.messages, 0);

  res.json({ items: items.slice(0, 12), total });
}
