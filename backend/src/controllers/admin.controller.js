import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyVerificationEvent } from "../services/verificationNotify.service.js";

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

  const updated = await prisma.vendor.update({ where: { id }, data });
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
