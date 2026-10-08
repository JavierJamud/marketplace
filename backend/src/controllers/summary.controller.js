import { prisma } from "../lib/prisma.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { LOW_STOCK_THRESHOLD } from "../constants/inventory.js";

// Bloque 290 (pedido explícito — "un mensaje de bienvenida en el dashboard del vendedor, del admin y
// del cliente, con un resumen de cómo va su plataforma, semanal"): resumen de los últimos 7 días,
// comparado con los 7 anteriores, según quién pregunta. Solo lee datos y devuelve una lista de
// indicadores `{ key, label, value, previous, format }` para que la pantalla los dibuje igual en
// los tres paneles. `value` y `previous` son de la semana actual y de la anterior.
const DAY_MS = 24 * 60 * 60 * 1000;

const windows = () => {
  const now = Date.now();
  return { now: new Date(now), week: new Date(now - 7 * DAY_MS), prev: new Date(now - 14 * DAY_MS) };
};
const num = (v) => Math.round(Number(v ?? 0) * 100) / 100;
const stat = (key, label, value, previous = null, format = "number") => ({ key, label, value, previous, format });

async function ordersAndSales(where, { includeTables = false, tableWhere = {} } = {}) {
  const w = windows();
  const range = (from, to) => ({ ...where, createdAt: { gte: from, lt: to }, status: { not: "CANCELLED" } });
  const [cur, prev, tCur, tPrev] = await Promise.all([
    prisma.order.aggregate({ where: range(w.week, w.now), _count: { _all: true }, _sum: { total: true } }),
    prisma.order.aggregate({ where: range(w.prev, w.week), _count: { _all: true }, _sum: { total: true } }),
    includeTables ? prisma.tableOrder.aggregate({ where: { ...tableWhere, createdAt: { gte: w.week, lt: w.now }, cancelledAt: null }, _count: { _all: true }, _sum: { total: true } }) : null,
    includeTables ? prisma.tableOrder.aggregate({ where: { ...tableWhere, createdAt: { gte: w.prev, lt: w.week }, cancelledAt: null }, _count: { _all: true }, _sum: { total: true } }) : null,
  ]);
  return {
    orders: cur._count._all + (tCur?._count._all ?? 0),
    ordersPrev: prev._count._all + (tPrev?._count._all ?? 0),
    sales: num(Number(cur._sum.total ?? 0) + Number(tCur?._sum.total ?? 0)),
    salesPrev: num(Number(prev._sum.total ?? 0) + Number(tPrev?._sum.total ?? 0)),
  };
}

async function adminSummary() {
  const w = windows();
  const [orders, newVendors, newVendorsPrev, newCustomers, newCustomersPrev, pendingVerifications, openReports, errors] = await Promise.all([
    ordersAndSales({}, { includeTables: true }),
    prisma.vendor.count({ where: { deletedAt: null, createdAt: { gte: w.week } } }),
    prisma.vendor.count({ where: { deletedAt: null, createdAt: { gte: w.prev, lt: w.week } } }),
    prisma.user.count({ where: { role: "CUSTOMER", deletedAt: null, createdAt: { gte: w.week } } }),
    prisma.user.count({ where: { role: "CUSTOMER", deletedAt: null, createdAt: { gte: w.prev, lt: w.week } } }),
    prisma.vendor.count({ where: { deletedAt: null, verificationStatus: { in: ["PENDING_DOCS", "IN_REVIEW"] } } }),
    prisma.report.count({ where: { status: { in: ["PENDING", "EVIDENCE_REQUESTED"] } } }),
    prisma.errorLog.count({ where: { resolved: false } }),
  ]);
  return {
    role: "ADMIN",
    stats: [
      stat("orders", "Pedidos en la plataforma", orders.orders, orders.ordersPrev),
      stat("newVendors", "Tiendas nuevas", newVendors, newVendorsPrev),
      stat("newCustomers", "Clientes nuevos", newCustomers, newCustomersPrev),
      stat("pendingVerifications", "Verificaciones por revisar", pendingVerifications),
      stat("openReports", "Reportes de fraude abiertos", openReports),
      stat("errors", "Errores sin resolver", errors),
    ],
  };
}

async function vendorSummary(userId) {
  const vendor = await resolveMyVendor(userId);
  const w = windows();
  const [sales, visits, visitsPrev, cartAdds, reviews, lowStock, top] = await Promise.all([
    ordersAndSales({ vendorId: vendor.id }, { includeTables: true, tableWhere: { table: { vendorId: vendor.id } } }),
    prisma.vendorEngagement.count({ where: { vendorId: vendor.id, type: "VISIT", createdAt: { gte: w.week } } }),
    prisma.vendorEngagement.count({ where: { vendorId: vendor.id, type: "VISIT", createdAt: { gte: w.prev, lt: w.week } } }),
    prisma.vendorEngagement.count({ where: { vendorId: vendor.id, type: "CART_ADD", createdAt: { gte: w.week } } }),
    prisma.review.count({ where: { OR: [{ vendorId: vendor.id }, { product: { vendorId: vendor.id } }], createdAt: { gte: w.week }, isHidden: false } }),
    prisma.product.count({ where: { vendorId: vendor.id, isActive: true, unlimitedStock: false, stock: { lte: LOW_STOCK_THRESHOLD } } }),
    prisma.orderItem.groupBy({ by: ["name"], where: { order: { vendorId: vendor.id, createdAt: { gte: w.week }, status: { not: "CANCELLED" } } }, _sum: { quantity: true }, orderBy: { _sum: { quantity: "desc" } }, take: 1 }),
  ]);
  return {
    role: "VENDOR",
    currency: vendor.currency,
    topProduct: top[0] ? { name: top[0].name, units: top[0]._sum.quantity ?? 0 } : null,
    stats: [
      stat("sales", "Ventas", sales.sales, sales.salesPrev, "money"),
      stat("orders", "Pedidos", sales.orders, sales.ordersPrev),
      stat("visits", "Visitas de clientes con cuenta", visits, visitsPrev),
      stat("cartAdds", "Productos agregados al carrito", cartAdds),
      stat("reviews", "Reseñas nuevas", reviews),
      stat("lowStock", "Productos con poco stock", lowStock),
    ],
  };
}

async function customerSummary(userId) {
  const w = windows();
  const where = { customerId: userId };
  const [cur, prev, active, favorites] = await Promise.all([
    prisma.order.findMany({ where: { ...where, createdAt: { gte: w.week }, status: { not: "CANCELLED" } }, select: { total: true, vendor: { select: { currency: true } } } }),
    prisma.order.count({ where: { ...where, createdAt: { gte: w.prev, lt: w.week }, status: { not: "CANCELLED" } } }),
    prisma.order.count({ where: { ...where, status: { in: ["NEW", "PREPARING", "READY"] } } }),
    prisma.favorite.count({ where: { userId } }),
  ]);
  const byCurrency = {};
  for (const o of cur) byCurrency[o.vendor?.currency ?? "CUP"] = (byCurrency[o.vendor?.currency ?? "CUP"] ?? 0) + Number(o.total);
  return {
    role: "CUSTOMER",
    spent: Object.entries(byCurrency).map(([currency, total]) => ({ currency, total: num(total) })),
    stats: [stat("orders", "Pedidos que hiciste", cur.length, prev), stat("active", "Pedidos en curso", active), stat("favorites", "Favoritos guardados", favorites)],
  };
}

export async function getWeeklySummary(req, res) {
  const { id, role } = req.user;
  const summary = role === "ADMIN" ? await adminSummary() : role === "VENDOR" || role === "VENDOR_STAFF" ? await vendorSummary(id) : await customerSummary(id);
  res.json({ ...summary, from: windows().week, to: new Date() });
}
