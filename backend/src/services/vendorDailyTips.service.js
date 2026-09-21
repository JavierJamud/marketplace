import { prisma } from "../lib/prisma.js";
import { generateDescription } from "../lib/ai.js";
import { topSellingProducts, engagementSignals, bestSellingWeekday } from "../controllers/vendors.controller.js";
import { LOW_STOCK_THRESHOLD } from "../constants/inventory.js";

// Bloque 194 (pedido explícito — "agregar una sección dentro del dashboard
// para que, basado en cómo funciona el negocio, la IA vaya reconociendo el
// modo de uso... y le recomiende consejos a los vendedores para mejorar su
// negocio... consejos diarios para que los vendedores sean más
// productivos"): se genera UNA vez por día calendario por tienda
// (VendorDailyTip.generatedForDate, único por vendedor+día) — nunca en
// cada carga del Dashboard, sería gastar IA de más sin necesidad real (el
// negocio no cambia tanto entre una carga y la siguiente en el mismo día).

function todayDateOnly() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// Bloque 194: hasta 2 productos activos, creados hace más de 30 días (un
// producto recién cargado sin ventas todavía no es "no sale", es "recién
// llegó" — mismo criterio de arranque en frío que productRanking.js), que
// NO están entre los más vendidos de los últimos 60 días — candidatos
// reales para "mover inventario".
async function findSlowMovingProducts(vendorId) {
  const sixtyDaysAgo = new Date(Date.now() - 60 * 24 * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [recentSellers, candidates] = await Promise.all([
    topSellingProducts(vendorId, sixtyDaysAgo, 50),
    prisma.product.findMany({
      where: { vendorId, isActive: true, createdAt: { lt: thirtyDaysAgo } },
      select: { id: true, name: true },
      orderBy: { createdAt: "asc" },
      take: 30,
    }),
  ]);
  const soldIds = new Set(recentSellers.map((p) => p.id));
  return candidates.filter((p) => !soldIds.has(p.id)).slice(0, 2);
}

// Bloque 194: texto legible que se le pasa a la IA como "los datos reales"
// — nunca al revés (nunca se le pide a la IA que invente estos números,
// solo que los interprete y aconseje sobre ellos).
function buildSignalsText({ bestSellers, slowMovers, lowStockCount, topEngagement, salesThisMonth, salesPrevMonth, bestWeekday }) {
  const lines = [];
  lines.push(
    bestSellers.length > 0
      ? `Productos más vendidos este mes: ${bestSellers.map((p) => `"${p.name}" (${p.soldCount} unidades)`).join(", ")}.`
      : "Todavía no hay ventas registradas este mes."
  );
  lines.push(
    slowMovers.length > 0
      ? `Productos activos hace más de 30 días SIN ventas recientes: ${slowMovers.map((p) => `"${p.name}"`).join(", ")}.`
      : "No hay productos claramente estancados sin ventas."
  );
  lines.push(lowStockCount > 0 ? `${lowStockCount} producto(s) con poco stock, por agotarse pronto.` : "El inventario con seguimiento está en niveles saludables.");
  lines.push(
    topEngagement.topClicks.length > 0
      ? `Producto con más clics de clientes: "${topEngagement.topClicks[0].name}" (${topEngagement.topClicks[0].clickCount} clics).`
      : "Todavía no hay suficientes clics registrados en los productos."
  );
  const trend =
    salesPrevMonth > 0
      ? `Ventas este mes: ${Math.round(salesThisMonth)} CUP, mes anterior: ${Math.round(salesPrevMonth)} CUP (${salesThisMonth >= salesPrevMonth ? "subieron" : "bajaron"} ${Math.abs(Math.round(((salesThisMonth - salesPrevMonth) / salesPrevMonth) * 100))}%).`
      : `Ventas este mes: ${Math.round(salesThisMonth)} CUP (sin datos del mes anterior para comparar).`;
  lines.push(trend);
  // Bloque 225 (pedido explícito — "esa misma gráfica servirá para el
  // algoritmo de los consejos"): mismo dato que ahora alimenta la gráfica
  // única del dashboard (día/semana/mes/año), acá resumido a "qué día de la
  // semana vende más" — útil para aconsejar sobre promociones/personal en
  // el día correcto, algo que el resto de las señales (mes vs. mes anterior,
  // clics) no cubre.
  lines.push(
    bestWeekday
      ? `El día de la semana con más ventas (últimas 8 semanas) es el ${bestWeekday.label}.`
      : "Todavía no hay suficientes ventas para saber qué día de la semana vende más."
  );
  return lines.map((l) => `- ${l}`).join("\n");
}

// Bloque 194: formato esperado "Título: descripción" — una línea por
// consejo (ver el prompt "vendor-tips", aiPrompts.js). Nunca confiar en
// que el modelo respeta el formato al 100% (mismo criterio anti-
// alucinación de siempre en este proyecto): una línea sin ":" se descarta
// en vez de romper el parseo entero.
function parseTipsText(raw) {
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const idx = line.indexOf(":");
      if (idx === -1) return null;
      const title = line.slice(0, idx).trim().replace(/^[-•\d.)]+\s*/, "");
      const description = line.slice(idx + 1).trim();
      return title && description ? { title, description } : null;
    })
    .filter(Boolean)
    .slice(0, 4);
}

// Bloque 194: sin proveedor de IA activo (o si falla), NUNCA se deja al
// vendedor sin nada — consejos basados en reglas simples sobre las mismas
// señales reales, siempre disponibles. Mismo espíritu que el resto del
// proyecto: la IA mejora la experiencia, nunca es un punto único de fallo.
function buildRuleBasedFallbackTips({ bestSellers, slowMovers, lowStockCount, topEngagement }) {
  const tips = [];
  if (bestSellers.length > 0) {
    tips.push({
      title: "Aprovecha tu producto estrella",
      description: `"${bestSellers[0].name}" es tu más vendido este mes — considera crear una oferta destacada con él o asegurarte de tener stock de sobra.`,
    });
  }
  if (slowMovers.length > 0) {
    tips.push({
      title: "Mueve inventario quieto",
      description: `"${slowMovers[0].name}" lleva más de 30 días sin venderse — prueba bajarle el precio, mejorar sus fotos/descripción, o armarle una oferta puntual.`,
    });
  }
  if (lowStockCount > 0) {
    tips.push({
      title: "Repón antes de que se agote",
      description: `Tienes ${lowStockCount} producto(s) con poco stock — repón pronto para no perder ventas por falta de inventario.`,
    });
  }
  if (topEngagement.topClicks.length > 0) {
    tips.push({
      title: "Convierte el interés en ventas",
      description: `"${topEngagement.topClicks[0].name}" recibe muchos clics — revisa que su precio y descripción inviten a comprar, no solo a mirar.`,
    });
  }
  if (tips.length === 0) {
    tips.push({
      title: "Recién estás empezando",
      description: "Todavía no hay suficiente actividad para darte consejos personalizados — carga más productos y vuelve a revisar en unos días.",
    });
  }
  return tips.slice(0, 3);
}

export async function getOrGenerateVendorDailyTips(vendorId) {
  const generatedForDate = todayDateOnly();

  const existing = await prisma.vendorDailyTip.findUnique({
    where: { vendorId_generatedForDate: { vendorId, generatedForDate } },
  });
  if (existing) return { tips: existing.tips, generatedAt: existing.createdAt };

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1);
  const prevMonthStart = new Date(new Date().getFullYear(), new Date().getMonth() - 1, 1);
  const eightWeeksAgo = new Date(Date.now() - 56 * 24 * 60 * 60 * 1000);

  const [bestSellers, slowMovers, lowStockCount, topEngagement, salesThisMonthAgg, salesPrevMonthAgg, tableSalesThisMonthAgg, tableSalesPrevMonthAgg, bestWeekday] = await Promise.all([
    topSellingProducts(vendorId, monthStart, 3),
    findSlowMovingProducts(vendorId),
    prisma.product.count({ where: { vendorId, isActive: true, unlimitedStock: false, stock: { gt: 0, lte: LOW_STOCK_THRESHOLD } } }),
    engagementSignals(vendorId),
    // Bloque 197: mismo criterio que salesAgg/salesByWeekday en
    // vendors.controller.js — un pedido anulado no debe inflar la
    // tendencia de ventas que la IA usa para aconsejar.
    prisma.order.aggregate({ where: { vendorId, createdAt: { gte: monthStart }, status: { not: "CANCELLED" } }, _sum: { total: true } }),
    prisma.order.aggregate({ where: { vendorId, createdAt: { gte: prevMonthStart, lt: monthStart }, status: { not: "CANCELLED" } }, _sum: { total: true } }),
    prisma.tableOrder.aggregate({ where: { table: { vendorId }, createdAt: { gte: monthStart }, cancelledAt: null }, _sum: { total: true } }),
    prisma.tableOrder.aggregate({ where: { table: { vendorId }, createdAt: { gte: prevMonthStart, lt: monthStart }, cancelledAt: null }, _sum: { total: true } }),
    bestSellingWeekday(vendorId, eightWeeksAgo),
  ]);

  const signalsData = {
    bestSellers,
    slowMovers,
    lowStockCount,
    topEngagement,
    salesThisMonth: Number(salesThisMonthAgg._sum.total ?? 0) + Number(tableSalesThisMonthAgg._sum.total ?? 0),
    salesPrevMonth: Number(salesPrevMonthAgg._sum.total ?? 0) + Number(tableSalesPrevMonthAgg._sum.total ?? 0),
    bestWeekday,
  };
  const signals = buildSignalsText(signalsData);

  let tips;
  try {
    const raw = await generateDescription("vendor-tips", { vendorName: vendor.companyName, signals });
    const parsed = parseTipsText(raw);
    tips = parsed.length > 0 ? parsed : buildRuleBasedFallbackTips(signalsData);
  } catch {
    // Bloque 194: sin proveedor de IA activo, o los 3 fallaron en cadena —
    // nunca rompe el Dashboard por esto.
    tips = buildRuleBasedFallbackTips(signalsData);
  }

  const saved = await prisma.vendorDailyTip.create({ data: { vendorId, tips, generatedForDate } });
  return { tips: saved.tips, generatedAt: saved.createdAt };
}
