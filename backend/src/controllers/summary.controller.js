import { prisma } from "../lib/prisma.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { LOW_STOCK_THRESHOLD } from "../constants/inventory.js";
import { computeVendorHealthScore, bestSellingWeekday } from "./vendors.controller.js";
import { algorithmPosition } from "../lib/assistantData.js";

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

// ---------------------------------------------------------------------------
// Texto explicado de la semana (Bloque 290: "debe ser un texto escrito, explicando cómo fue la semana
// según los algoritmos y las estadísticas"). Se arma solo con números reales de la base de datos, con
// frases fijas: nada de IA ni de cifras inventadas, así que no cuesta cuota y no puede equivocarse.
// ---------------------------------------------------------------------------
const LEVEL_LABEL = { green: "bueno", yellow: "regular", red: "bajo" };
const plural = (n, one, many) => `${n.toLocaleString("es-CU")} ${n === 1 ? one : many}`;
const fmtMoney = (n, currency) => `${Number(n).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${currency ?? ""}`.trim();
function trend(cur, prev) {
  if (prev == null) return "";
  if (prev === 0) return cur > 0 ? " (la semana anterior no hubo ninguno)" : "";
  const pct = Math.round(((cur - prev) / prev) * 100);
  if (pct === 0) return " (igual que la semana anterior)";
  return pct > 0 ? ` (un ${pct}% más que la semana anterior)` : ` (un ${Math.abs(pct)}% menos que la semana anterior)`;
}

async function vendorNarrative(vendor, s) {
  const w = windows();
  const [health, weekday, algo] = await Promise.all([
    computeVendorHealthScore(vendor.id, w.week).catch(() => null),
    bestSellingWeekday(vendor.id, w.week).catch(() => null),
    algorithmPosition(vendor.id).catch(() => null),
  ]);
  const by = Object.fromEntries(s.stats.map((x) => [x.key, x]));
  const paragraphs = [];

  // 1. Ventas
  if (by.orders.value === 0) {
    paragraphs.push(`Esta semana ${vendor.companyName} no registró pedidos${by.orders.previous > 0 ? `, y la semana anterior había tenido ${plural(by.orders.previous, "pedido", "pedidos")}` : ""}.`);
  } else {
    let text = `Esta semana ${vendor.companyName} recibió ${plural(by.orders.value, "pedido", "pedidos")}${trend(by.orders.value, by.orders.previous)} y vendió ${fmtMoney(by.sales.value, vendor.currency)}${trend(by.sales.value, by.sales.previous)}.`;
    if (s.topProduct) text += ` El producto más vendido fue ${s.topProduct.name}, con ${plural(s.topProduct.units, "unidad", "unidades")}.`;
    if (weekday) text += ` El día que más se vendió fue el ${weekday.label.toLowerCase()}.`;
    paragraphs.push(text);
  }

  // 2. Clientes: visitas, carrito y lo que llegó a comprar
  if (by.visits.value + by.cartAdds.value > 0) {
    let text = `${plural(by.visits.value, "cliente con cuenta visitó", "clientes con cuenta visitaron")} tu tienda${trend(by.visits.value, by.visits.previous)} y se agregaron ${plural(by.cartAdds.value, "producto", "productos")} al carrito.`;
    if (by.cartAdds.value > 0 && by.orders.value === 0) text += " Hubo interés pero ninguna compra: revisa precios, stock y que el pedido sea fácil de hacer.";
    paragraphs.push(text);
  } else {
    paragraphs.push("Ningún cliente con cuenta visitó la tienda esta semana. Compartir el enlace de la tienda y publicar ofertas ayuda a atraer visitas.");
  }

  // 3. Algoritmo
  if (algo && !algo.error) {
    if (algo.problemasDeVisibilidad?.length) {
      paragraphs.push(`Ahora mismo tus productos no compiten en el algoritmo de la plataforma porque ${algo.problemasDeVisibilidad.join(" y ")}. Es lo primero que conviene resolver.`);
    } else if (algo.susProductosEnElRanking) {
      const r = algo.susProductosEnElRanking;
      let text = `En el algoritmo que ordena el catálogo (se comparan ${plural(algo.productosComparadosEnElCatalogo, "producto", "productos")} de toda la plataforma), ${plural(r.cuantosCompiten, "producto tuyo compite", "productos tuyos compiten")} y ${plural(r.enElTop10, "está", "están")} entre los 10 primeros.`;
      if (r.penalizadosPorElPisoDeCalidad > 0) text += ` ${plural(r.penalizadosPorElPisoDeCalidad, "producto pierde", "productos pierden")} posiciones por tener la ficha incompleta: agrega fotos, descripción y etiquetas.`;
      paragraphs.push(text);
    }
  }

  // 4. Salud y stock
  const extra = [];
  if (health?.score != null) extra.push(`El puntaje de salud de tu negocio es ${health.score} de 100${health.level ? ` (${LEVEL_LABEL[health.level] ?? String(health.level).toLowerCase()})` : ""}`);
  if (by.lowStock.value > 0) extra.push(`${plural(by.lowStock.value, "producto está", "productos están")} con poco stock o agotado${by.lowStock.value === 1 ? "" : "s"}`);
  if (by.reviews.value > 0) extra.push(`recibiste ${plural(by.reviews.value, "reseña nueva", "reseñas nuevas")}`);
  if (extra.length) paragraphs.push(`${extra.join("; ")}.`);

  // 5. Qué hacer primero
  const advice =
    algo?.problemasDeVisibilidad?.length ? "Resuelve primero lo que impide que tu tienda aparezca en el catálogo."
    : by.lowStock.value > 0 ? "Repón el stock de los productos que se agotan antes de que dejen de venderse."
    : by.orders.value === 0 ? "Esta semana prueba una oferta o comparte tu tienda para conseguir los primeros pedidos."
    : by.sales.previous != null && by.sales.value < by.sales.previous ? "Las ventas bajaron: una oferta corta en tu producto más vendido puede recuperar el ritmo."
    : "Vas bien: mantén el stock al día y responde rápido a los pedidos para sostener el ritmo.";
  paragraphs.push(advice);
  return paragraphs;
}

async function adminNarrative(s) {
  const w = windows();
  const by = Object.fromEntries(s.stats.map((x) => [x.key, x]));
  const [notOperating, expiring, paymentsToConfirm, anomalies, business] = await Promise.all([
    prisma.vendor.count({ where: { deletedAt: null, OR: [{ verificationStatus: "SUSPENDED" }, { status: "SUSPENDED" }, { isBlocked: true }] } }),
    prisma.vendor.count({ where: { deletedAt: null, planType: "BUSINESS", verificationStatus: "VERIFIED", nextPaymentDueDate: { lte: new Date(w.now.getTime() + 7 * DAY_MS) } } }),
    prisma.subscriptionPayment.count({ where: { claimedAt: { not: null }, confirmedAt: null } }),
    prisma.rankingAnomaly.count({ where: { status: "PENDING" } }),
    prisma.vendor.count({ where: { deletedAt: null, planType: "BUSINESS" } }),
  ]);
  const paragraphs = [];
  paragraphs.push(
    by.orders.value === 0
      ? `En los últimos 7 días no se registraron pedidos en la plataforma${by.orders.previous > 0 ? `, mientras que la semana anterior hubo ${plural(by.orders.previous, "pedido", "pedidos")}` : ""}.`
      : `En los últimos 7 días la plataforma registró ${plural(by.orders.value, "pedido", "pedidos")}${trend(by.orders.value, by.orders.previous)}.`
  );
  paragraphs.push(`Se sumaron ${plural(by.newVendors.value, "tienda nueva", "tiendas nuevas")}${trend(by.newVendors.value, by.newVendors.previous)} y ${plural(by.newCustomers.value, "cliente nuevo", "clientes nuevos")}${trend(by.newCustomers.value, by.newCustomers.previous)}.`);
  const todo = [];
  if (by.pendingVerifications.value > 0) todo.push(`${plural(by.pendingVerifications.value, "verificación espera", "verificaciones esperan")} revisión`);
  if (paymentsToConfirm > 0) todo.push(`${plural(paymentsToConfirm, "pago de suscripción espera", "pagos de suscripción esperan")} confirmación`);
  if (by.openReports.value > 0) todo.push(`${plural(by.openReports.value, "reporte de fraude está abierto", "reportes de fraude están abiertos")}`);
  if (anomalies > 0) todo.push(`${plural(anomalies, "anomalía del ranking espera", "anomalías del ranking esperan")} decisión`);
  if (expiring > 0) todo.push(`${plural(expiring, "suscripción Business vence", "suscripciones Business vencen")} en los próximos 7 días`);
  paragraphs.push(todo.length ? `Pendiente de ti: ${todo.join("; ")}.` : "No hay verificaciones, pagos, reportes ni anomalías esperando tu decisión.");
  const health = [];
  if (notOperating > 0) health.push(`${plural(notOperating, "tienda no opera", "tiendas no operan")} con normalidad (suspendidas, bloqueadas o en eliminación)`);
  if (by.errors.value > 0) health.push(`hay ${plural(by.errors.value, "error sin resolver", "errores sin resolver")} en el registro del sistema`);
  health.push(`${plural(business, "tienda tiene", "tiendas tienen")} el plan Business`);
  paragraphs.push(`Estado de la plataforma: ${health.join("; ")}.`);
  return paragraphs;
}

function customerNarrative(s) {
  const by = Object.fromEntries(s.stats.map((x) => [x.key, x]));
  const paragraphs = [];
  if (by.orders.value === 0) paragraphs.push(`Esta semana no hiciste pedidos${by.orders.previous > 0 ? `, y la semana anterior hiciste ${plural(by.orders.previous, "pedido", "pedidos")}` : ""}.`);
  else {
    const spent = s.spent.map((x) => fmtMoney(x.total, x.currency)).join(" y ");
    paragraphs.push(`Esta semana hiciste ${plural(by.orders.value, "pedido", "pedidos")}${spent ? ` por ${spent}` : ""}${trend(by.orders.value, by.orders.previous)}.`);
  }
  if (by.active.value > 0) paragraphs.push(`Tienes ${plural(by.active.value, "pedido en curso", "pedidos en curso")}: puedes ver su estado más abajo.`);
  paragraphs.push(by.favorites.value > 0 ? `Guardaste ${plural(by.favorites.value, "favorito", "favoritos")}; cuando quieras comprarlos, los encuentras en la sección Favoritos.` : "Aún no guardas favoritos: toca el corazón en un producto o tienda para tenerlos a mano.");
  return paragraphs;
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
  const result = {
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
  return { ...result, narrative: await adminNarrative(result) };
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
  const result = {
    role: "VENDOR",
    storeName: vendor.companyName,
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
  return { ...result, narrative: await vendorNarrative(vendor, result) };
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
  const result = {
    role: "CUSTOMER",
    spent: Object.entries(byCurrency).map(([currency, total]) => ({ currency, total: num(total) })),
    stats: [stat("orders", "Pedidos que hiciste", cur.length, prev), stat("active", "Pedidos en curso", active), stat("favorites", "Favoritos guardados", favorites)],
  };
  return { ...result, narrative: customerNarrative(result) };
}

export async function getWeeklySummary(req, res) {
  const { id, role } = req.user;
  const summary = role === "ADMIN" ? await adminSummary() : role === "VENDOR" || role === "VENDOR_STAFF" ? await vendorSummary(id) : await customerSummary(id);
  res.json({ ...summary, from: windows().week, to: new Date() });
}
