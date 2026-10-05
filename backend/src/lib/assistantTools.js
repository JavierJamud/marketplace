import { z } from "zod";
import { prisma } from "./prisma.js";
import { rawSalesSeries, fillSeriesGaps, resolveSeriesRange } from "./salesSeries.js";
import { LOW_STOCK_THRESHOLD } from "../constants/inventory.js";
import { computeVendorHealthScore, topSellingProducts, engagementSignals, bestSellingWeekday } from "../controllers/vendors.controller.js";
import { getDashboard as getAdminDashboard } from "../controllers/admin.controller.js";
import { getAllEffectiveModels } from "./aiModels.js";
import { getModelHealthRows } from "./aiProviderHealth.js";

// Bloque 246 (pedido explícito — asistente de negocio con IA que "lee toda la
// base de datos, estadísticas y algoritmos" y solo recomienda): registro de
// HERRAMIENTAS DE SOLO LECTURA. El modelo de IA nunca toca la base: pide una
// herramienta por nombre, el backend valida los argumentos con zod, la ejecuta
// y le devuelve el resultado como DATO. Reglas que este archivo garantiza:
//   - Ninguna herramienta escribe nada (solo findMany/count/aggregate/groupBy
//     y las funciones de estadísticas que ya usa el panel).
//   - En el ámbito VENDOR el vendorId sale de la sesión (ctx.vendorId), nunca
//     de un argumento: ninguna herramienta de vendedor acepta un vendorId.
//   - Solo se devuelven campos de una lista blanca: nunca contraseñas,
//     tokens, credenciales ni documentos de verificación, y casi nada de datos
//     personales (cero correos, teléfonos o direcciones de clientes).
//   - Los textos de terceros (reseñas, nombres de productos) se recortan,
//     porque llegan al modelo como dato y no deben crecer sin límite.

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIOD_DAYS = { hoy: 1, "7dias": 7, "30dias": 30, "90dias": 90 };
const periodSchema = z.enum(["hoy", "7dias", "30dias", "90dias"]).default("30dias");
const limitSchema = (max, def) => z.number().int().min(1).max(max).default(def);

const clip = (text, max) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max)}...` : s;
};
const money = (n) => Math.round(Number(n ?? 0) * 100) / 100;

// Mismo corte de "hoy" que la gráfica de ventas del panel (días UTC, ver
// lib/salesSeries.js): así el número que dice el asistente coincide con el
// que el dueño ve en su Dashboard.
function utcDayStart(date = new Date()) {
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
}
function sinceForPeriod(period) {
  return period === "hoy" ? utcDayStart() : new Date(Date.now() - PERIOD_DAYS[period] * DAY_MS);
}

// Llama a un handler de Express del panel y devuelve el JSON que respondería:
// así el asistente usa EXACTAMENTE el mismo cálculo que el Dashboard del
// admin, sin copiar ~250 líneas ni arriesgar que los números diverjan.
async function captureJson(handler, req = {}) {
  let out;
  const res = { json: (data) => ((out = data), res), status: () => res };
  await handler(req, res);
  return out;
}

async function salesSince(vendorId, since) {
  const [orders, tableOrders] = await Promise.all([
    prisma.order.aggregate({ where: { vendorId, createdAt: { gte: since }, status: { not: "CANCELLED" } }, _sum: { total: true }, _count: { _all: true } }),
    prisma.tableOrder.aggregate({ where: { table: { vendorId }, createdAt: { gte: since }, cancelledAt: null }, _sum: { total: true }, _count: { _all: true } }),
  ]);
  return {
    ventas: money(Number(orders._sum.total ?? 0) + Number(tableOrders._sum.total ?? 0)),
    pedidos: orders._count._all + tableOrders._count._all,
  };
}

// ---------------------------------------------------------------------------
// Herramientas del VENDEDOR (alcance: solo su propia tienda)
// ---------------------------------------------------------------------------

const seriesArgs = z.object({
  agrupar: z.enum(["day", "week", "month"]).default("day"),
  desde: z.string().trim().max(10).optional(),
  hasta: z.string().trim().max(10).optional(),
});

async function runSeries(vendorId, { agrupar, desde, hasta }) {
  const range = resolveSeriesRange(agrupar, desde, hasta);
  if (!range) return { error: "Rango de fechas inválido: usa el formato AAAA-MM-DD y que 'desde' sea anterior a 'hasta'." };
  const rows = await rawSalesSeries(vendorId, agrupar, range.fromDate, range.toDate);
  const series = fillSeriesGaps(agrupar, range.fromDate, range.toDate, rows);
  return {
    agrupadoPor: agrupar,
    nota: "Los días se cuentan en UTC, igual que la gráfica del panel.",
    total: money(series.reduce((s, r) => s + r.total, 0)),
    pedidos: series.reduce((s, r) => s + r.orders, 0),
    serie: series.slice(-45).map((r) => ({ periodo: r.key, ventas: money(r.total), pedidos: r.orders })),
  };
}

const VENDOR_TOOLS = {
  resumen_negocio: {
    description: "Resumen general de TU negocio: ventas y pedidos de hoy, últimos 7 y 30 días, pedidos por atender, productos activos, valoración y puntaje de salud.",
    args: "{}",
    schema: z.object({}).strict(),
    async run(_args, { vendorId }) {
      const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { companyName: true, currency: true, planType: true, verificationStatus: true, rating: true } });
      const [hoy, d7, d30, newOrders, newTableOrders, activeProducts, reviews, health] = await Promise.all([
        salesSince(vendorId, utcDayStart()),
        salesSince(vendorId, new Date(Date.now() - 7 * DAY_MS)),
        salesSince(vendorId, new Date(Date.now() - 30 * DAY_MS)),
        prisma.order.count({ where: { vendorId, status: "NEW" } }),
        prisma.tableOrder.count({ where: { table: { vendorId }, kitchenStatus: "RECEIVED" } }),
        prisma.product.count({ where: { vendorId, isActive: true } }),
        prisma.review.aggregate({ where: { vendorId, rating: { not: null }, isHidden: false }, _count: { rating: true } }),
        computeVendorHealthScore(vendorId, new Date(Date.now() - 30 * DAY_MS)),
      ]);
      return {
        tienda: vendor.companyName,
        moneda: vendor.currency,
        plan: vendor.planType,
        verificada: vendor.verificationStatus === "VERIFIED",
        hoy,
        ultimos7dias: d7,
        ultimos30dias: d30,
        pedidosPorAtender: newOrders + newTableOrders,
        productosActivos: activeProducts,
        valoracion: { promedio: Number(vendor.rating), resenas: reviews._count.rating },
        salud: health,
      };
    },
  },
  ventas_por_periodo: {
    description: "Serie de ventas y pedidos de TU tienda agrupada por día, semana o mes (por defecto últimos 30 días). Úsala para comparar periodos o ver tendencias.",
    args: '{ "agrupar": "day"|"week"|"month", "desde": "AAAA-MM-DD" (opcional), "hasta": "AAAA-MM-DD" (opcional) }',
    schema: seriesArgs,
    run: (args, { vendorId }) => runSeries(vendorId, args),
  },
  productos_mas_vendidos: {
    description: "Los productos más vendidos de TU tienda en un periodo (pedidos normales y de mesa, sin cancelados).",
    args: '{ "periodo": "hoy"|"7dias"|"30dias"|"90dias", "limite": 1-10 }',
    schema: z.object({ periodo: periodSchema, limite: limitSchema(10, 5) }),
    async run({ periodo, limite }, { vendorId }) {
      const rows = await topSellingProducts(vendorId, sinceForPeriod(periodo), limite);
      return { periodo, productos: rows.map((p) => ({ nombre: clip(p.name, 80), unidadesVendidas: p.soldCount })) };
    },
  },
  productos_sin_ventas: {
    description: "Productos activos de TU tienda con más de 30 días publicados que NO aparecen entre los que se vendieron en los últimos 60 días. Candidatos para promoción o rebaja.",
    args: "{}",
    schema: z.object({}).strict(),
    async run(_args, { vendorId }) {
      const [sold, candidates] = await Promise.all([
        topSellingProducts(vendorId, new Date(Date.now() - 60 * DAY_MS), 200),
        prisma.product.findMany({
          where: { vendorId, isActive: true, createdAt: { lt: new Date(Date.now() - 30 * DAY_MS) } },
          select: { id: true, name: true, stock: true, unlimitedStock: true, viewCount: true, clickCount: true },
          orderBy: { createdAt: "asc" },
          take: 60,
        }),
      ]);
      const soldIds = new Set(sold.map((p) => p.id));
      return {
        productos: candidates
          .filter((p) => !soldIds.has(p.id))
          .slice(0, 10)
          .map((p) => ({ nombre: clip(p.name, 80), stock: p.unlimitedStock ? "siempre disponible" : p.stock, vistas: p.viewCount, clics: p.clickCount })),
      };
    },
  },
  inventario_critico: {
    description: "Productos de TU tienda agotados o con poco stock (3 unidades o menos).",
    args: "{}",
    schema: z.object({}).strict(),
    async run(_args, { vendorId }) {
      const base = { vendorId, isActive: true, unlimitedStock: false };
      const [low, out] = await Promise.all([
        prisma.product.findMany({ where: { ...base, stock: { gt: 0, lte: LOW_STOCK_THRESHOLD } }, orderBy: { stock: "asc" }, select: { name: true, stock: true }, take: 15 }),
        prisma.product.findMany({ where: { ...base, stock: { lte: 0 } }, orderBy: { createdAt: "desc" }, select: { name: true }, take: 15 }),
      ]);
      return {
        umbralPocoStock: LOW_STOCK_THRESHOLD,
        pocoStock: low.map((p) => ({ nombre: clip(p.name, 80), stock: p.stock })),
        agotados: out.map((p) => ({ nombre: clip(p.name, 80) })),
      };
    },
  },
  pedidos_recientes: {
    description: "Los últimos pedidos de TU tienda (código, canal, total, estado, fecha, nombre del cliente).",
    args: '{ "limite": 1-10, "estado": "NEW"|"PREPARING"|"READY"|"DELIVERED"|"CANCELLED" (opcional) }',
    schema: z.object({ limite: limitSchema(10, 5), estado: z.enum(["NEW", "PREPARING", "READY", "DELIVERED", "CANCELLED"]).optional() }),
    async run({ limite, estado }, { vendorId }) {
      const orders = await prisma.order.findMany({
        where: { vendorId, ...(estado ? { status: estado } : {}) },
        orderBy: { createdAt: "desc" },
        take: limite,
        select: { code: true, channel: true, total: true, status: true, createdAt: true, customerName: true },
      });
      return { pedidos: orders.map((o) => ({ codigo: o.code, canal: o.channel, total: money(o.total), estado: o.status, fecha: o.createdAt.toISOString(), cliente: clip(o.customerName ?? "Cliente", 40) })) };
    },
  },
  resenas: {
    description: "Valoración de TU tienda y sus últimas reseñas visibles.",
    args: '{ "limite": 1-8 }',
    schema: z.object({ limite: limitSchema(8, 5) }),
    async run({ limite }, { vendorId }) {
      const where = { vendorId, rating: { not: null }, isHidden: false };
      const [agg, latest] = await Promise.all([
        prisma.review.aggregate({ where, _avg: { rating: true }, _count: { rating: true } }),
        prisma.review.findMany({ where, orderBy: { createdAt: "desc" }, take: limite, select: { rating: true, comment: true, createdAt: true, vendorReply: true } }),
      ]);
      return {
        promedio: agg._avg.rating ? Math.round(agg._avg.rating * 100) / 100 : null,
        total: agg._count.rating,
        ultimas: latest.map((r) => ({ estrellas: r.rating, comentario: clip(r.comment, 200), respondida: !!r.vendorReply, fecha: r.createdAt.toISOString().slice(0, 10) })),
      };
    },
  },
  interes_de_clientes: {
    description: "Dónde hacen más clic y cuánto tiempo permanecen los clientes en TU tienda (productos con más clics y mayor tiempo en la ficha).",
    args: "{}",
    schema: z.object({}).strict(),
    async run(_args, { vendorId }) {
      const { topClicks, topDwell } = await engagementSignals(vendorId);
      return {
        masClics: topClicks.map((p) => ({ nombre: clip(p.name, 80), clics: p.clickCount, clicsDesdeBusqueda: p.searchClickCount })),
        masTiempoEnFicha: topDwell.map((p) => ({ nombre: clip(p.name, 80), segundosPromedio: p.avgDwellSeconds, visitas: p.viewCount })),
      };
    },
  },
  mejor_dia_semana: {
    description: "El día de la semana en que TU tienda vendió más en los últimos 90 días.",
    args: "{}",
    schema: z.object({}).strict(),
    async run(_args, { vendorId }) {
      const best = await bestSellingWeekday(vendorId, new Date(Date.now() - 90 * DAY_MS));
      return best ? { dia: best.label, ventas: money(best.total) } : { dia: null, nota: "Todavía no hay ventas suficientes para saberlo." };
    },
  },
  salud_del_negocio: {
    description: "Puntaje de salud de TU tienda (0 a 100) con sus tres componentes: completitud de las fichas, cancelaciones y stock.",
    args: "{}",
    schema: z.object({}).strict(),
    run: (_args, { vendorId }) => computeVendorHealthScore(vendorId, new Date(Date.now() - 30 * DAY_MS)),
  },
};

// ---------------------------------------------------------------------------
// Herramientas del ADMIN (alcance: toda la plataforma, solo lectura)
// ---------------------------------------------------------------------------

async function platformTop(period, limit, by) {
  const since = sinceForPeriod(period);
  const [orderRows, tableOrders] = await Promise.all([
    prisma.order.groupBy({ by: ["vendorId"], where: { createdAt: { gte: since }, status: { not: "CANCELLED" } }, _sum: { total: true }, _count: { _all: true } }),
    prisma.tableOrder.findMany({ where: { createdAt: { gte: since }, cancelledAt: null }, select: { total: true, table: { select: { vendorId: true } } } }),
  ]);
  const byVendor = new Map();
  for (const r of orderRows) byVendor.set(r.vendorId, { ventas: Number(r._sum.total ?? 0), pedidos: r._count._all });
  for (const t of tableOrders) {
    const cur = byVendor.get(t.table.vendorId) ?? { ventas: 0, pedidos: 0 };
    cur.ventas += Number(t.total);
    cur.pedidos += 1;
    byVendor.set(t.table.vendorId, cur);
  }
  const ranked = [...byVendor.entries()].sort((a, b) => (by === "pedidos" ? b[1].pedidos - a[1].pedidos : b[1].ventas - a[1].ventas)).slice(0, limit);
  const vendors = await prisma.vendor.findMany({ where: { id: { in: ranked.map(([id]) => id) } }, select: { id: true, companyName: true, currency: true, planType: true } });
  const byId = Object.fromEntries(vendors.map((v) => [v.id, v]));
  return ranked.map(([id, v]) => ({ tienda: clip(byId[id]?.companyName, 60), moneda: byId[id]?.currency, plan: byId[id]?.planType, ventas: money(v.ventas), pedidos: v.pedidos }));
}

const ADMIN_TOOLS = {
  resumen_plataforma: {
    description: "Resumen de TODA la plataforma: tiendas activas, clientes, pedidos del mes, ventas totales, ticket promedio, ingresos por suscripción, embudo de verificación, actividad de tiendas, tiendas de alto potencial y tiendas por provincia. Es el mismo cálculo del Dashboard del admin.",
    args: "{}",
    schema: z.object({}).strict(),
    async run() {
      const d = await captureJson(getAdminDashboard);
      return {
        // Nombres explícitos a propósito: en el Dashboard `gmv` es el total de
        // TODA la historia y `ordersThisMonth` el mes calendario; con esos
        // nombres sueltos la IA los mezcló (probado en vivo).
        metricas: {
          tiendasActivas: d.metrics.activeVendors,
          clientesRegistrados: d.metrics.totalCustomers,
          pedidosDelMesCalendario: d.metrics.ordersThisMonth,
          ventasTotalesDeTodaLaHistoria: money(d.metrics.gmv),
          ticketPromedioSegunElPanel: money(d.metrics.aov),
          tiendasConPlanDePago: d.metrics.businessVendors,
          suscripcionesActivas: d.metrics.activeSubscriptions,
          ingresosPorSuscripcionEsteMes: d.metrics.subscriptionRevenueByCurrency,
          ingresoMensualRecurrenteUsd: d.metrics.mrrUsd,
        },
        verificacionesPendientes: d.pendingVerifications,
        actividadDeTiendas: d.vendorActivity,
        pedidosUltimas24h7dias30dias: { dia: d.ordersByPeriod.day, semana: d.ordersByPeriod.week, mes: d.ordersByPeriod.month },
        tiendasNuevasUltimas24h7dias30dias: { dia: d.newVendorsByPeriod.day, semana: d.newVendorsByPeriod.week, mes: d.newVendorsByPeriod.month },
        embudoDeVerificacion: d.verificationFunnel,
        tiendasDeAltoPotencial: (d.topPotentialVendors ?? []).map((v) => ({ tienda: clip(v.companyName, 60), puntajeSalud: v.score, ventas30dias: money(v.recentRevenue), pedidos30dias: v.recentOrders })),
        tiendasPorProvincia: d.byProvince,
      };
    },
  },
  ventas_plataforma: {
    description: "Serie de ventas y pedidos de TODA la plataforma agrupada por día, semana o mes.",
    args: '{ "agrupar": "day"|"week"|"month", "desde": "AAAA-MM-DD" (opcional), "hasta": "AAAA-MM-DD" (opcional) }',
    schema: seriesArgs,
    run: (args) => runSeries(null, args),
  },
  tiendas_top: {
    description: "Las tiendas que más venden en un periodo, ordenadas por ventas o por cantidad de pedidos.",
    args: '{ "periodo": "hoy"|"7dias"|"30dias"|"90dias", "limite": 1-10, "orden": "ventas"|"pedidos" }',
    schema: z.object({ periodo: periodSchema, limite: limitSchema(10, 5), orden: z.enum(["ventas", "pedidos"]).default("ventas") }),
    async run({ periodo, limite, orden }) {
      return { periodo, orden, nota: "Las ventas de tiendas con monedas distintas no son comparables entre sí: mira la moneda de cada una.", tiendas: await platformTop(periodo, limite, orden) };
    },
  },
  productos_top_plataforma: {
    description: "Los productos más vendidos de toda la plataforma en un periodo, con la tienda a la que pertenecen.",
    args: '{ "periodo": "hoy"|"7dias"|"30dias"|"90dias", "limite": 1-10 }',
    schema: z.object({ periodo: periodSchema, limite: limitSchema(10, 5) }),
    async run({ periodo, limite }) {
      const rows = await prisma.orderItem.groupBy({
        by: ["productId"],
        where: { productId: { not: null }, order: { createdAt: { gte: sinceForPeriod(periodo) }, status: { not: "CANCELLED" } } },
        _sum: { quantity: true },
        orderBy: { _sum: { quantity: "desc" } },
        take: limite,
      });
      const products = await prisma.product.findMany({ where: { id: { in: rows.map((r) => r.productId) } }, select: { id: true, name: true, vendor: { select: { companyName: true } } } });
      const byId = Object.fromEntries(products.map((p) => [p.id, p]));
      return { periodo, productos: rows.map((r) => ({ nombre: clip(byId[r.productId]?.name, 80), tienda: clip(byId[r.productId]?.vendor?.companyName, 60), unidadesVendidas: r._sum.quantity ?? 0 })) };
    },
  },
  detalle_tienda: {
    description: "Datos de una tienda concreta buscada por nombre: plan, estado de verificación, productos, ventas y pedidos de 30 días, valoración, salud y último acceso del dueño.",
    args: '{ "busqueda": "parte del nombre de la tienda" }',
    schema: z.object({ busqueda: z.string().trim().min(2).max(60) }),
    async run({ busqueda }) {
      const vendors = await prisma.vendor.findMany({
        where: { deletedAt: null, OR: [{ companyName: { contains: busqueda, mode: "insensitive" } }, { slug: { contains: busqueda, mode: "insensitive" } }] },
        select: { id: true, companyName: true, slug: true, planType: true, verificationStatus: true, status: true, isBlocked: true, currency: true, rating: true, createdAt: true, user: { select: { lastLoginAt: true } }, _count: { select: { products: { where: { isActive: true } } } } },
        take: 3,
      });
      const since = new Date(Date.now() - 30 * DAY_MS);
      return {
        coincidencias: await Promise.all(
          vendors.map(async (v) => ({
            tienda: v.companyName,
            plan: v.planType,
            verificacion: v.verificationStatus,
            estado: v.isBlocked ? "BLOQUEADA" : v.status,
            moneda: v.currency,
            productosActivos: v._count.products,
            ultimos30dias: await salesSince(v.id, since),
            valoracion: Number(v.rating),
            salud: await computeVendorHealthScore(v.id, since),
            ultimoAccesoDelDueno: v.user?.lastLoginAt?.toISOString().slice(0, 10) ?? null,
            registradaEl: v.createdAt.toISOString().slice(0, 10),
          }))
        ),
      };
    },
  },
  resumen_clientes: {
    description: "Resumen de clientes registrados: total, nuevos y activos en 30 días, suspendidos y los que ya hicieron pedidos. Sin datos personales.",
    args: "{}",
    schema: z.object({}).strict(),
    async run() {
      const since = new Date(Date.now() - 30 * DAY_MS);
      const base = { role: "CUSTOMER", deletedAt: null };
      const [total, nuevos, activos, suspendidos, conPedidos] = await Promise.all([
        prisma.user.count({ where: base }),
        prisma.user.count({ where: { ...base, createdAt: { gte: since } } }),
        prisma.user.count({ where: { ...base, lastLoginAt: { gte: since } } }),
        prisma.user.count({ where: { ...base, isSuspended: true } }),
        prisma.order.groupBy({ by: ["customerId"], where: { customerId: { not: null } } }).then((r) => r.length),
      ]);
      return { total, nuevosUltimos30dias: nuevos, activosUltimos30dias: activos, suspendidos, conAlMenosUnPedido: conPedidos };
    },
  },
  pendientes_admin: {
    description: "Todo lo que espera una decisión del admin: verificaciones, reportes de fraude, anomalías del ranking, solicitudes de ubicación nuevas y errores sin resolver (con conteos y los más recientes).",
    args: "{}",
    schema: z.object({}).strict(),
    async run() {
      const [verifs, reports, anomalies, locations, errors, anomalyRows, locationRows] = await Promise.all([
        prisma.vendor.count({ where: { verificationStatus: { in: ["PENDING_DOCS", "IN_REVIEW"] } } }),
        prisma.report.count({ where: { status: { in: ["PENDING", "EVIDENCE_REQUESTED"] } } }),
        prisma.rankingAnomaly.count({ where: { status: "PENDING" } }),
        prisma.locationSuggestion.count({ where: { status: "PENDING" } }),
        prisma.errorLog.count({ where: { resolved: false } }),
        prisma.rankingAnomaly.findMany({ where: { status: "PENDING" }, orderBy: { detectedAt: "desc" }, take: 3, select: { kind: true, details: true } }),
        prisma.locationSuggestion.findMany({ where: { status: "PENDING" }, orderBy: { mentionCount: "desc" }, take: 5, select: { kind: true, name: true, mentionCount: true } }),
      ]);
      return {
        verificacionesPorRevisar: verifs,
        reportesDeFraudePendientes: reports,
        anomaliasDelRankingPendientes: anomalies,
        solicitudesDeUbicacionPendientes: locations,
        erroresSinResolver: errors,
        ultimasAnomalias: anomalyRows.map((a) => ({ tipo: a.kind, detalle: clip(a.details, 200) })),
        ubicacionesSolicitadas: locationRows.map((l) => ({ tipo: l.kind, nombre: clip(l.name, 60), personas: l.mentionCount })),
      };
    },
  },
  estado_ia: {
    description: "Estado de las integraciones de IA: modelos configurados por proveedor y su salud actual.",
    args: "{}",
    schema: z.object({}).strict(),
    async run() {
      const [byProvider, health] = await Promise.all([getAllEffectiveModels(), getModelHealthRows()]);
      return {
        proveedores: Object.entries(byProvider).map(([provider, models]) => ({
          proveedor: provider,
          modelos: models.map((m) => {
            const h = health.find((x) => x.provider === provider && x.model === m.model);
            return { modelo: m.model, activo: m.isActive, origen: m.source, estado: h?.status ?? "sin medir", ultimoError: h?.lastError ? clip(h.lastError, 120) : null };
          }),
        })),
      };
    },
  },
};

export const TOOLS_BY_SCOPE = { VENDOR: VENDOR_TOOLS, ADMIN: ADMIN_TOOLS };

// Rutas REALES del panel a las que el asistente puede enviar a la persona
// ("dónde hacer el cambio"). El modelo solo puede elegir de esta lista: una
// ruta inventada se descarta. Mismos paths que App.jsx.
export const LINKS_BY_SCOPE = {
  ADMIN: {
    "/admin": "Dashboard",
    "/admin/tiendas": "Tiendas",
    "/admin/tiendas-suspendidas": "Tiendas suspendidas",
    "/admin/productos": "Productos",
    "/admin/clientes": "Clientes",
    "/admin/verificaciones": "Verificaciones",
    "/admin/suscripciones": "Suscripciones y planes",
    "/admin/reportes-fraude": "Reportes de fraude",
    "/admin/anomalias-ranking": "Anomalías del ranking",
    "/admin/ofertas": "Ofertas",
    "/admin/codigos-descuento": "Códigos de descuento",
    "/admin/campanas": "Campañas",
    "/admin/mensajes": "Mensajes",
    "/admin/comentarios": "Comentarios",
    "/admin/integraciones": "Integraciones",
    "/admin/ubicaciones": "Países y provincias",
    "/admin/categorias": "Categorías",
    "/admin/errores": "Errores",
    "/admin/actividad": "Actividad",
    "/admin/marca": "Marca de la plataforma",
  },
  VENDOR: {
    "/vendedor": "Dashboard",
    "/vendedor/productos": "Productos",
    "/vendedor/ofertas": "Ofertas",
    "/vendedor/ofertas-tienda": "Ofertas y códigos",
    "/vendedor/pedidos": "Pedidos",
    "/vendedor/mesas": "Mesas / QR",
    "/vendedor/mensajes": "Mensajes",
    "/vendedor/resenas": "Reseñas",
    "/vendedor/verificacion": "Verificación y plan",
    "/vendedor/configuracion": "Configuración",
  },
};
