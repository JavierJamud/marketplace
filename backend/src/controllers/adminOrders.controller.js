import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { paginationQuerySchema, pageArgs, pageMeta } from "../lib/pagination.js";
import { startOfDayInTimezone } from "../lib/timezone.js";
import { describeOrderRequest } from "../lib/orderRequestInfo.js";
import { describeUserAgent } from "../lib/userAgent.js";
import { ID_TYPE_LABEL } from "../lib/orderSummary.js";
import { logActivity } from "../lib/activityLog.js";
import { adminNoticeToVendor } from "../lib/notify.js";
import { updateOrderStatus, confirmOrderSale, reactivateOrder } from "./orders.controller.js";

// Pedidos de una tienda para dar soporte desde el admin (/admin/tiendas/:id, pestaña Pedidos): buscar, filtrar y abrir la
// ficha completa de un pedido, incluida la IP y el dispositivo (OrderRequestInfo), que la tienda nunca ve.

const STATUSES = ["NEW", "PREPARING", "READY", "DELIVERED", "CANCELLED"];
const DAY = /^\d{4}-\d{2}-\d{2}$/;

const listQuery = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  product: z.string().trim().max(100).optional(),
  status: z.enum(["all", ...STATUSES]).default("all"),
  channel: z.string().trim().max(40).optional(),
  from: z.string().regex(DAY).optional(),
  to: z.string().regex(DAY).optional(),
  min: z.coerce.number().min(0).optional(),
  max: z.coerce.number().min(0).optional(),
  ip: z.string().trim().max(60).optional(),
  sort: z.enum(["recent", "oldest", "totalDesc", "totalAsc"]).default("recent"),
});

const ORDER_BY = {
  recent: [{ createdAt: "desc" }],
  oldest: [{ createdAt: "asc" }],
  totalDesc: [{ total: "desc" }, { createdAt: "desc" }],
  totalAsc: [{ total: "asc" }, { createdAt: "desc" }],
};

async function siteTimezone() {
  return (await prisma.siteSettings.findFirst({ select: { timezone: true } }))?.timezone ?? "America/Havana";
}

// Las fechas del filtro son días del calendario del negocio (zona horaria del sitio), no de UTC: "hoy" en Cuba empieza a las
// 00:00 de Cuba. `to` incluye el día entero.
function dayStart(day, tz, plusDays = 0) {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + plusDays);
  return startOfDayInTimezone(d, tz);
}

function buildWhere(vendorId, f, tz) {
  const and = [];
  if (f.q) {
    const digits = f.q.replace(/\D/g, "");
    const or = [
      { code: { contains: f.q, mode: "insensitive" } },
      { customerName: { contains: f.q, mode: "insensitive" } },
      { customerEmail: { contains: f.q, mode: "insensitive" } },
      { recipientName: { contains: f.q, mode: "insensitive" } },
      { shippingAddress: { contains: f.q, mode: "insensitive" } },
    ];
    // Teléfonos guardados como +5355551234: se busca por los dígitos, con o sin el código de país.
    if (digits.length >= 4) or.push({ customerPhone: { contains: digits } }, { recipientPhone: { contains: digits } });
    and.push({ OR: or });
  }
  // Por el nombre guardado en la línea del pedido: así aparecen también los de productos que la tienda ya borró.
  if (f.product) and.push({ items: { some: { name: { contains: f.product, mode: "insensitive" } } } });
  if (f.ip) and.push({ requestInfo: { ip: f.ip } });
  const createdAt = {};
  if (f.from) createdAt.gte = dayStart(f.from, tz);
  if (f.to) createdAt.lt = dayStart(f.to, tz, 1);
  const total = {};
  if (f.min != null) total.gte = f.min;
  if (f.max != null) total.lte = f.max;
  return {
    vendorId,
    ...(f.status !== "all" ? { status: f.status } : {}),
    ...(f.channel ? { channel: f.channel.toUpperCase() } : {}),
    ...(Object.keys(createdAt).length ? { createdAt } : {}),
    ...(Object.keys(total).length ? { total } : {}),
    ...(and.length ? { AND: and } : {}),
  };
}

// GET /admin/vendors/:id/orders
export async function listVendorOrders(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id }, select: { id: true, currency: true } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);
  const f = listQuery.parse(req.query);
  const tz = await siteTimezone();
  const where = buildWhere(vendor.id, f, tz);
  const { status: _status, ...whereAnyStatus } = where;

  const [orders, total, byStatus, channels, posLinks] = await Promise.all([
    prisma.order.findMany({
      where,
      orderBy: ORDER_BY[f.sort],
      ...pageArgs(f),
      select: {
        id: true,
        code: true,
        status: true,
        channel: true,
        createdAt: true,
        total: true,
        shippingFees: true,
        customerId: true,
        customerName: true,
        customerPhone: true,
        customerEmail: true,
        recipientName: true,
        cancelReason: true,
        autoCancelledAt: true,
        partner: { select: { name: true } },
        items: { select: { name: true, quantity: true, currency: true, size: true } },
        requestInfo: { select: { source: true, userAgent: true, ip: true } },
      },
    }),
    prisma.order.count({ where }),
    prisma.order.groupBy({ by: ["status"], where: whereAnyStatus, _count: { _all: true } }),
    prisma.order.groupBy({ by: ["channel"], where: { vendorId: vendor.id }, _count: { _all: true } }),
    prisma.posSale.findMany({ where: { vendorId: vendor.id, orderId: { not: null } }, select: { orderId: true } }),
  ]);
  const posOrderIds = new Set(posLinks.map((p) => p.orderId));

  res.json({
    orders: orders.map(({ requestInfo, partner, ...o }) => ({
      ...o,
      total: Number(o.total),
      partnerName: partner?.name ?? null,
      fromPos: posOrderIds.has(o.id),
      device: requestInfo ? { source: requestInfo.source, ip: requestInfo.ip, ...(requestInfo.userAgent ? describeUserAgent(requestInfo.userAgent) : {}) } : null,
    })),
    ...pageMeta(f, total),
    statusCounts: Object.fromEntries(byStatus.map((s) => [s.status, s._count._all])),
    channels: channels.map((c) => ({ channel: c.channel, count: c._count._all })).sort((a, b) => b.count - a.count),
    currency: vendor.currency,
  });
}

// Nombres de productos que tiene o tuvo la tienda en sus pedidos, para sugerirlos en el filtro "Producto".
export async function vendorOrderProducts(req, res) {
  const rows = await prisma.orderItem.groupBy({
    by: ["name"],
    where: { order: { vendorId: req.params.id } },
    _count: { _all: true },
    orderBy: { _count: { name: "desc" } },
    take: 200,
  });
  res.json({ products: rows.map((r) => ({ name: r.name, count: r._count._all })) });
}

// GET /admin/orders/:id: todo lo que se sabe de un pedido. Se registra quién lo abrió, porque muestra la IP y datos personales.
export async function getOrderDetail(req, res) {
  const order = await prisma.order.findUnique({
    where: { id: req.params.id },
    include: {
      items: { include: { product: { select: { id: true, slug: true, images: true, isActive: true } } } },
      events: { orderBy: { createdAt: "asc" } },
      emailLogs: { orderBy: { createdAt: "asc" }, select: { id: true, type: true, to: true, subject: true, status: true, error: true, createdAt: true } },
      discountCode: { select: { code: true, type: true, value: true } },
      partner: { select: { id: true, name: true } },
      requestInfo: true,
      vendor: { select: { id: true, companyName: true, slug: true, currency: true, whatsapp: true } },
      customer: { select: { id: true, fullName: true, email: true, phone: true, createdAt: true, lastLoginAt: true, isSuspended: true } },
    },
  });
  if (!order) throw new AppError("Pedido no encontrado.", 404);

  const [province, municipality, pos, customerOrders, sameIpOrders] = await Promise.all([
    order.shippingProvinceId ? prisma.province.findUnique({ where: { id: order.shippingProvinceId }, select: { name: true, country: { select: { name: true } } } }) : null,
    order.shippingMunicipalityId ? prisma.municipality.findUnique({ where: { id: order.shippingMunicipalityId }, select: { name: true } }) : null,
    prisma.posSale.findFirst({ where: { orderId: order.id }, select: { code: true, paymentMethod: true, cashReceived: true, changeGiven: true, paidAt: true, createdById: true } }),
    // Historial del cliente: por su cuenta si la tiene; si compró sin cuenta, por su correo o su teléfono.
    prisma.order.groupBy({
      by: ["vendorId"],
      where: order.customerId ? { customerId: order.customerId } : { OR: [{ customerEmail: order.customerEmail ?? "-" }, { customerPhone: order.customerPhone ?? "-" }] },
      _count: { _all: true },
    }),
    order.requestInfo?.ip ? prisma.orderRequestInfo.count({ where: { ip: order.requestInfo.ip, orderId: { not: order.id } } }) : 0,
  ]);
  const cashier = pos ? await prisma.user.findUnique({ where: { id: pos.createdById }, select: { fullName: true } }) : null;
  const totalOrders = customerOrders.reduce((n, g) => n + g._count._all, 0);
  const atThisStore = customerOrders.find((g) => g.vendorId === order.vendorId)?._count._all ?? 0;

  // Sin vendorId a propósito: lo que se registra con la tienda aparece en su historial, en su asistente y en su uso del panel.
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    action: "admin_order_viewed",
    description: `Abrió el pedido ${order.code} de "${order.vendor.companyName}"`,
    meta: { orderId: order.id, code: order.code, vendorId: order.vendorId },
  });

  const { requestInfo, ...rest } = order;
  res.json({
    order: {
      ...rest,
      total: Number(order.total),
      discountAmount: order.discountAmount != null ? Number(order.discountAmount) : null,
      loyaltyDiscount: order.loyaltyDiscount != null ? Number(order.loyaltyDiscount) : null,
      recipientIdLabel: order.recipientIdType ? ID_TYPE_LABEL[order.recipientIdType] ?? order.recipientIdType : null,
      provinceName: province?.name ?? null,
      countryName: province?.country?.name ?? null,
      municipalityName: municipality?.name ?? null,
      pos: pos ? { ...pos, cashReceived: pos.cashReceived != null ? Number(pos.cashReceived) : null, changeGiven: pos.changeGiven != null ? Number(pos.changeGiven) : null, cashier: cashier?.fullName ?? null, createdById: undefined } : null,
    },
    request: describeOrderRequest(requestInfo),
    customerHistory: { totalOrders, atThisStore, otherStores: customerOrders.filter((g) => g.vendorId !== order.vendorId).length },
    sameIpOrders,
  });
}

// GET /admin/orders/lookup?code=Z-...: lleva directo a la tienda y al pedido desde cualquier lugar del admin.
export async function lookupOrder(req, res) {
  const code = z.string().trim().min(3).max(40).parse(req.query.code).toUpperCase();
  const exact = await prisma.order.findUnique({ where: { code }, select: { id: true, code: true, vendorId: true, vendor: { select: { companyName: true } } } });
  if (exact) return res.json({ matches: [exact] });
  const matches = await prisma.order.findMany({
    where: { code: { contains: code, mode: "insensitive" } },
    select: { id: true, code: true, vendorId: true, vendor: { select: { companyName: true } } },
    orderBy: { createdAt: "desc" },
    take: 8,
  });
  res.json({ matches });
}

// --- Gestionar el pedido desde el admin ----------------------------------------------------------------------------------
// Mismas funciones que usa la tienda (orders.controller.js), sobre la tienda del pedido: el stock, las ventas, los puntos, la
// caja y el correo al cliente se comportan igual. La tienda recibe el aviso solo si el admin marcó "Avisar a la tienda".

const STATUS_ES = { NEW: "Pendiente", PREPARING: "Vendido", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Rechazado" };

async function actOnOrder(req) {
  const order = await prisma.order.findUnique({ where: { id: req.params.id }, select: { id: true, code: true, vendorId: true } });
  if (!order) throw new AppError("Pedido no encontrado.", 404);
  req.adminOrderVendorId = order.vendorId;
  return order;
}

const notice = (order, body) => adminNoticeToVendor(order.vendorId, `Pedido ${order.code} actualizado por el equipo`, body);

// POST /admin/orders/:id/confirm: confirmar la venta (descuenta el stock y suma ventas).
export async function adminConfirmOrder(req, res) {
  const order = await actOnOrder(req);
  await confirmOrderSale(req, res);
  await notice(order, `Confirmamos la venta del pedido ${order.code}. Ya aparece como "Vendido" en tu panel.`);
}

// PATCH /admin/orders/:id/status: { status, reason }
export async function adminUpdateOrderStatus(req, res) {
  const order = await actOnOrder(req);
  await updateOrderStatus(req, res);
  const status = String(req.body?.status ?? "");
  const reason = status === "CANCELLED" && req.body?.reason ? ` Motivo: ${String(req.body.reason).trim()}` : "";
  await notice(order, `Pasamos el pedido ${order.code} a "${STATUS_ES[status] ?? status}".${reason}`);
}

// POST /admin/orders/:id/reactivate: retomar un pedido que el sistema cerró por falta de respuesta.
export async function adminReactivateOrder(req, res) {
  const order = await actOnOrder(req);
  await reactivateOrder(req, res);
  await notice(order, `Reactivamos el pedido ${order.code}: vuelve a estar pendiente en tu panel.`);
}
