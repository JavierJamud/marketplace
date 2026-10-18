import { prisma } from "../lib/prisma.js";
import { completenessScore } from "../lib/productRanking.js";
import { algorithmPosition } from "../lib/assistantData.js";
import { LOW_STOCK_THRESHOLD } from "../constants/inventory.js";

// Secciones del panel principal de la tienda que salen de los mismos algoritmos de la plataforma (ranking de productos,
// completitud de la ficha, actividad de clientes) y de su propia caja y programa de fidelidad. Todo dato es real: si no hay
// información suficiente, la sección lo dice en vez de inventar un número.
const DAY = 24 * 60 * 60 * 1000;
const WEEKDAYS = ["domingo", "lunes", "martes", "miércoles", "jueves", "viernes", "sábado"];
const round2 = (n) => Math.round(Number(n ?? 0) * 100) / 100;

// Qué le falta a la ficha de un producto para subir en el ranking (mismos criterios que completenessScore).
function missingFromListing(p) {
  const missing = [];
  const photos = p.images?.length ?? 0;
  if (photos < 3) missing.push(photos === 0 ? "fotos" : `${3 - photos} foto${3 - photos === 1 ? "" : "s"} más`);
  if (!p.description || p.description.trim().length <= 60) missing.push("descripción más larga");
  if (!p.tags?.length) missing.push("etiquetas");
  if (!p.categoryId) missing.push("categoría");
  return missing;
}

// Lista "Qué hacer hoy": solo lo que tiene algo pendiente, con el enlace al lugar donde se resuelve.
async function todoList(vendorId, products) {
  const [newOrders, unansweredReviews, unreadMessages, openPos] = await Promise.all([
    prisma.order.count({ where: { vendorId, status: "NEW" } }),
    prisma.review.count({ where: { vendorId, isHidden: false, vendorReply: null, comment: { not: null }, createdAt: { gte: new Date(Date.now() - 30 * DAY) } } }),
    prisma.vendorMessage.count({ where: { vendorId, senderRole: "ADMIN", readAt: null } }).catch(() => 0),
    prisma.posSale.count({ where: { vendorId, status: { in: ["OPEN", "PENDING_TABLE"] } } }),
  ]);
  const active = products.filter((p) => p.isActive);
  const lowStock = active.filter((p) => !p.unlimitedStock && p.stock > 0 && p.stock <= LOW_STOCK_THRESHOLD).length;
  const outOfStock = active.filter((p) => !p.unlimitedStock && p.stock <= 0).length;
  const weakListings = active.filter((p) => completenessScore(p) < 60).length;
  const overQuota = products.filter((p) => p.overQuota).length;
  const items = [
    { key: "orders", count: newOrders, text: newOrders === 1 ? "pedido nuevo sin atender" : "pedidos nuevos sin atender", to: "/vendedor/pedidos" },
    { key: "pos", count: openPos, text: openPos === 1 ? "venta de caja abierta o esperando mesa" : "ventas de caja abiertas o esperando mesa", to: "/vendedor/caja" },
    { key: "outOfStock", count: outOfStock, text: outOfStock === 1 ? "producto agotado: no sale en el catálogo" : "productos agotados: no salen en el catálogo", to: "/vendedor/productos" },
    { key: "lowStock", count: lowStock, text: lowStock === 1 ? "producto por agotarse" : "productos por agotarse", to: "/vendedor/productos" },
    { key: "reviews", count: unansweredReviews, text: unansweredReviews === 1 ? "reseña sin responder" : "reseñas sin responder", to: "/vendedor/resenas" },
    { key: "messages", count: unreadMessages, text: unreadMessages === 1 ? "mensaje de la plataforma sin leer" : "mensajes de la plataforma sin leer", to: "/vendedor/mensajes" },
    { key: "listings", count: weakListings, text: weakListings === 1 ? "ficha de producto incompleta (pierde visibilidad)" : "fichas de producto incompletas (pierden visibilidad)", to: "/vendedor/productos" },
    { key: "quota", count: overQuota, text: overQuota === 1 ? "producto fuera del cupo de tu plan" : "productos fuera del cupo de tu plan", to: "/vendedor/productos" },
  ];
  return items.filter((i) => i.count > 0);
}

// Ventas de esta semana contra la anterior (pedidos no cancelados, en la moneda de la tienda).
async function weekCompare(vendorId) {
  const now = Date.now();
  const sum = (from, to) =>
    prisma.order.aggregate({ where: { vendorId, status: { not: "CANCELLED" }, createdAt: { gte: new Date(from), lt: new Date(to) } }, _sum: { total: true }, _count: { _all: true } });
  const [cur, prev] = await Promise.all([sum(now - 7 * DAY, now), sum(now - 14 * DAY, now - 7 * DAY)]);
  const current = round2(cur._sum.total);
  const previous = round2(prev._sum.total);
  return {
    current,
    previous,
    orders: cur._count._all,
    previousOrders: prev._count._all,
    changePercent: previous > 0 ? Math.round(((current - previous) / previous) * 100) : null,
  };
}

// Mejor día de la semana y franja horaria de los últimos 90 días, en la zona horaria del negocio.
async function bestTimes(vendorId, timezone) {
  const tz = timezone || "America/Havana";
  const rows = await prisma.$queryRaw`
    SELECT EXTRACT(DOW FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int AS dow,
           EXTRACT(HOUR FROM ("createdAt" AT TIME ZONE 'UTC' AT TIME ZONE ${tz}))::int AS hour,
           COUNT(*)::int AS orders
    FROM "Order"
    WHERE "vendorId" = ${vendorId} AND status <> 'CANCELLED' AND "createdAt" >= ${new Date(Date.now() - 90 * DAY)}
    GROUP BY 1, 2`;
  const total = rows.reduce((s, r) => s + r.orders, 0);
  if (total < 5) return { enough: false, orders: total };
  const byDay = new Array(7).fill(0);
  const byHour = new Array(24).fill(0);
  for (const r of rows) {
    byDay[r.dow] += r.orders;
    byHour[r.hour] += r.orders;
  }
  // Franja de 3 horas con más pedidos (más útil que una hora suelta).
  let bestStart = 0;
  let bestSum = -1;
  for (let h = 0; h < 24; h++) {
    const s = byHour[h] + byHour[(h + 1) % 24] + byHour[(h + 2) % 24];
    if (s > bestSum) {
      bestSum = s;
      bestStart = h;
    }
  }
  const bestDay = byDay.indexOf(Math.max(...byDay));
  return {
    enough: true,
    orders: total,
    bestDay: WEEKDAYS[bestDay],
    bestDayShare: Math.round((byDay[bestDay] / total) * 100),
    bestHours: `${String(bestStart).padStart(2, "0")}:00 a ${String((bestStart + 3) % 24).padStart(2, "0")}:00`,
    bestHoursShare: Math.round((bestSum / total) * 100),
    byDay: byDay.map((orders, i) => ({ day: WEEKDAYS[i], orders })),
  };
}

// Clientes que compraron 2 veces o más y llevan entre 45 y 180 días sin volver (por cuenta o por teléfono).
async function lapsedCustomers(vendorId) {
  const rows = await prisma.$queryRaw`
    SELECT COALESCE("customerId", "customerPhone") AS key,
           MAX("customerName") AS name,
           MAX("customerPhone") AS phone,
           COUNT(*)::int AS orders,
           SUM(total)::float AS spent,
           MAX("createdAt") AS "lastOrderAt"
    FROM "Order"
    WHERE "vendorId" = ${vendorId} AND status <> 'CANCELLED' AND COALESCE("customerId", "customerPhone") IS NOT NULL
    GROUP BY 1
    HAVING COUNT(*) >= 2 AND MAX("createdAt") < ${new Date(Date.now() - 45 * DAY)} AND MAX("createdAt") >= ${new Date(Date.now() - 180 * DAY)}
    ORDER BY SUM(total) DESC
    LIMIT 6`;
  return rows.map((r) => ({
    name: r.name || "Cliente",
    phone: r.phone ?? null,
    orders: r.orders,
    spent: round2(r.spent),
    daysAway: Math.floor((Date.now() - new Date(r.lastOrderAt).getTime()) / DAY),
  }));
}

// Caja de hoy (desde la medianoche en la zona del negocio).
async function cashToday(vendorId, timezone) {
  const tz = timezone || "America/Havana";
  const [{ start }] = await prisma.$queryRaw`SELECT (date_trunc('day', now() AT TIME ZONE ${tz}) AT TIME ZONE ${tz}) AS start`;
  const [sales, entries] = await Promise.all([
    prisma.posSale.aggregate({ where: { vendorId, status: "PAID", paidAt: { gte: start } }, _sum: { total: true }, _count: { _all: true } }),
    prisma.cashEntry.groupBy({ by: ["type"], where: { vendorId, createdAt: { gte: start } }, _sum: { amount: true } }),
  ]);
  const byType = Object.fromEntries(entries.map((e) => [e.type, Number(e._sum.amount ?? 0)]));
  return {
    sales: sales._count._all,
    total: round2(sales._sum.total),
    // Dinero que debería haber en la caja por lo de hoy: cobros y entradas, menos vueltos y retiros.
    cashBalance: round2((byType.SALE ?? 0) + (byType.DEPOSIT ?? 0) - (byType.CHANGE ?? 0) - (byType.WITHDRAWAL ?? 0)),
  };
}

async function loyaltySummary(vendorId) {
  const program = await prisma.loyaltyProgram.findUnique({ where: { vendorId } });
  if (!program?.enabled) return { enabled: false };
  const [withPoints, canRedeem, outstanding] = await Promise.all([
    prisma.loyaltyAccount.count({ where: { vendorId, balance: { gt: 0 } } }),
    prisma.loyaltyAccount.count({ where: { vendorId, balance: { gte: program.minRedeemPoints } } }),
    prisma.loyaltyAccount.aggregate({ where: { vendorId }, _sum: { balance: true } }),
  ]);
  return { enabled: true, withPoints, canRedeem, outstanding: outstanding._sum.balance ?? 0 };
}

export async function getVendorInsights(vendor) {
  const products = await prisma.product.findMany({
    where: { vendorId: vendor.id },
    select: {
      id: true, name: true, images: true, description: true, tags: true, categoryId: true, badge: true, isActive: true, overQuota: true,
      stock: true, unlimitedStock: true, viewCount: true, clickCount: true, salesCount: true, priceTiers: { select: { id: true } },
    },
  });

  const [todo, week, times, lapsed, cash, loyalty, position] = await Promise.all([
    todoList(vendor.id, products),
    weekCompare(vendor.id),
    bestTimes(vendor.id, vendor.timezone),
    lapsedCustomers(vendor.id),
    cashToday(vendor.id, vendor.timezone),
    loyaltySummary(vendor.id),
    algorithmPosition(vendor.id),
  ]);

  const active = products.filter((p) => p.isActive);
  const improveListings = active
    .map((p) => ({ id: p.id, name: p.name, image: p.images?.[0] ?? null, score: completenessScore(p), missing: missingFromListing(p) }))
    .filter((p) => p.missing.length > 0)
    .sort((a, b) => a.score - b.score)
    .slice(0, 5);

  // Productos que la gente abre pero no compra: muchas visitas y ninguna venta. Suele ser precio, fotos o descripción.
  const viewedNotBought = active
    .filter((p) => p.viewCount >= 10 && p.salesCount === 0)
    .sort((a, b) => b.viewCount - a.viewCount)
    .slice(0, 5)
    .map((p) => ({ id: p.id, name: p.name, image: p.images?.[0] ?? null, views: p.viewCount, clicks: p.clickCount }));

  const ranking = position?.susProductosEnElRanking
    ? {
        visible: position.aparecenEnElCatalogoPublico,
        competing: position.susProductosEnElRanking.cuantosCompiten,
        top10: position.susProductosEnElRanking.enElTop10,
        top30: position.susProductosEnElRanking.enElTop30,
        penalized: position.susProductosEnElRanking.penalizadosPorElPisoDeCalidad,
        catalogSize: position.productosComparadosEnElCatalogo,
        best: (position.mejoresPosiciones ?? []).slice(0, 3).map((p) => ({ id: p.id, name: p.nombre, position: p.posicion, reasons: p.motivosDePenalizacion })),
      }
    : { visible: position?.aparecenEnElCatalogoPublico ?? false, problems: position?.problemasDeVisibilidad ?? [] };

  return { todo, week, bestTimes: times, lapsedCustomers: lapsed, cashToday: cash, loyalty, ranking, improveListings, viewedNotBought, currency: vendor.currency ?? "CUP" };
}
