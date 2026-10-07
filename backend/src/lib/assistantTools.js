import { z } from "zod";
import { prisma } from "./prisma.js";
import { rawSalesSeries, fillSeriesGaps, resolveSeriesRange } from "./salesSeries.js";
import { LOW_STOCK_THRESHOLD } from "../constants/inventory.js";
import { computeVendorHealthScore, topSellingProducts, engagementSignals, bestSellingWeekday } from "../controllers/vendors.controller.js";
import { getDashboard as getAdminDashboard } from "../controllers/admin.controller.js";
import { getAllEffectiveModels } from "./aiModels.js";
import { getModelHealthRows } from "./aiProviderHealth.js";
import { getProviderCooldowns } from "./aiProviderCooldown.js";
import {
  DAY_MS, clip, money, planAndSubscription, accountActivity, algorithmRules, algorithmPosition, productsList, productDetail,
  inbox, offersAndCodes, teamAndTables, alerts, customersAndChat, storeProfile, ordersBreakdown, customersRanking, orderDetail, storesActivity,
} from "./assistantData.js";
import { makeQueryTool } from "./assistantQuery.js";
import { storesByState, findPerson, salesAgents, quickSales, customerDetail, representativeSummary } from "./assistantPeople.js";

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

const PERIOD_DAYS = { hoy: 1, "7dias": 7, "30dias": 30, "90dias": 90 };
const periodSchema = z.enum(["hoy", "7dias", "30dias", "90dias"]).default("30dias");
const limitSchema = (max, def) => z.number().int().min(1).max(max).default(def);


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
        prisma.tableOrder.count({ where: { table: { vendorId }, kitchenStatus: "RECEIVED", cancelledAt: null } }),
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
        pedidosNuevosSinAtender: newOrders + newTableOrders,
        notaPedidosNuevos: "Cuenta los pedidos en estado NUEVO (y los de mesa recibidos sin cancelar). Si es 0 no hay ninguno pendiente: no afirmes lo contrario.",
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
      return { periodo, productos: rows.map((p) => ({ id: p.id, nombre: clip(p.name, 80), unidadesVendidas: p.soldCount })) };
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
          .map((p) => ({ id: p.id, nombre: clip(p.name, 80), stock: p.unlimitedStock ? "siempre disponible" : p.stock, vistas: p.viewCount, clics: p.clickCount })),
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
        prisma.product.findMany({ where: { ...base, stock: { gt: 0, lte: LOW_STOCK_THRESHOLD } }, orderBy: { stock: "asc" }, select: { id: true, name: true, stock: true }, take: 15 }),
        prisma.product.findMany({ where: { ...base, stock: { lte: 0 } }, orderBy: { createdAt: "desc" }, select: { id: true, name: true }, take: 15 }),
      ]);
      return {
        umbralPocoStock: LOW_STOCK_THRESHOLD,
        pocoStock: low.map((p) => ({ id: p.id, nombre: clip(p.name, 80), stock: p.stock })),
        agotados: out.map((p) => ({ id: p.id, nombre: clip(p.name, 80) })),
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

  // Bloque 260 (pedido explícito — "acceso completo a todo lo del negocio, incluso
  // lo que el vendedor no ve, como el algoritmo de su tienda pública"): el resto
  // de herramientas de la tienda. Todas leen, ninguna escribe.
  plan_y_suscripcion: {
    description: "Plan de TU tienda, si el plan de pago está activo, fecha de vencimiento y días que faltan, forma de cobro, si se cancela al final del periodo, prueba gratuita, uso de los límites del plan (productos, mesas, usuarios...), últimos pagos de renovación e historial de verificación.",
    args: "{}",
    schema: z.object({}).strict(),
    run: (_args, { vendorId }) => planAndSubscription(vendorId),
  },
  actividad_de_la_cuenta: {
    description: "Inicios de sesión de TU cuenta (último inicio, sesiones por día, dispositivos, sesiones abiertas), conexiones del personal de sistema y TODA la actividad registrada en tu tienda (últimos movimientos y cuántos de cada tipo en 30 días). Para más detalle o filtros usa consultar_datos con actividad_registrada o sesiones_del_dueno.",
    args: '{ "limite": 1-30 }',
    schema: z.object({ limite: limitSchema(30, 15) }),
    run: ({ limite }, { vendorId }) => accountActivity(vendorId, limite),
  },
  algoritmo_de_mi_tienda: {
    description: "Cómo está posicionada TU tienda pública en el algoritmo: si aparece en el catálogo y por qué no, la posición real de tus productos entre todos los del sitio, cuántos están en el top 10 y 30, cuáles el algoritmo penaliza y por qué (ficha incompleta, mala calificación, sin actividad reciente).",
    args: "{}",
    schema: z.object({}).strict(),
    run: (_args, { vendorId }) => algorithmPosition(vendorId),
  },
  como_funciona_el_algoritmo: {
    description: "Las reglas reales del algoritmo de posicionamiento del sitio (pesos de cada señal, piso de calidad, empujón a productos nuevos, caducidad de la actividad, reglas de visibilidad de las tiendas). Úsala cuando pregunten qué es el algoritmo o por qué un producto sube o baja.",
    args: "{}",
    schema: z.object({}).strict(),
    async run() {
      return algorithmRules();
    },
  },
  mis_productos: {
    description: "Lista de TUS productos con precio, stock, estado, ventas, vistas, clics, tiempo en la ficha, calificación, fotos y completitud de la ficha. Puedes buscar por nombre y ordenar.",
    args: '{ "busqueda": "parte del nombre" (opcional), "orden": "ventas"|"vistas"|"clics"|"calificacion"|"stock"|"recientes", "limite": 1-12 }',
    schema: z.object({ busqueda: z.string().trim().max(60).optional(), orden: z.enum(["ventas", "vistas", "clics", "calificacion", "stock", "recientes"]).default("ventas"), limite: limitSchema(12, 8) }),
    run: (args, { vendorId }) => productsList(vendorId, args),
  },
  detalle_de_producto: {
    description: "Todo sobre UN producto de tu tienda buscado por nombre: ventas, clics por origen (búsqueda, Home, catálogo, tienda) de los últimos 30 días, favoritos, reseñas y cómo lo ve el algoritmo.",
    args: '{ "busqueda": "nombre del producto" }',
    schema: z.object({ busqueda: z.string().trim().min(2).max(60) }),
    run: (args, { vendorId }) => productDetail(vendorId, args),
  },
  pedidos_detalle: {
    description: "Desglose de los pedidos de TU tienda en un periodo: por estado, por canal, tasa de cancelación, motivos de cancelación, ticket promedio y pedidos de mesa.",
    args: '{ "periodo": "hoy"|"7dias"|"30dias"|"90dias" }',
    schema: z.object({ periodo: periodSchema }),
    run: ({ periodo }, { vendorId }) => ordersBreakdown(vendorId, sinceForPeriod(periodo)),
  },
  mensajes_y_notificaciones: {
    description: "Mensajes con el equipo de la plataforma y notificaciones de TU panel (sin leer y las últimas).",
    args: "{}",
    schema: z.object({}).strict(),
    run: (_args, { vendorId }) => inbox(vendorId),
  },
  ofertas_y_codigos: {
    description: "Ofertas del Home, ofertas de tienda y códigos de descuento de TU tienda con su estado, usos y vencimiento.",
    args: "{}",
    schema: z.object({}).strict(),
    run: (_args, { vendorId }) => offersAndCodes(vendorId),
  },
  personal_y_mesas: {
    description: "Usuarios de sistema (personal) de TU tienda con su último acceso, y las mesas con QR y sus pedidos.",
    args: "{}",
    schema: z.object({}).strict(),
    run: (_args, { vendorId }) => teamAndTables(vendorId),
  },
  alertas_de_la_cuenta: {
    description: "Estado de TU cuenta (bloqueo, suspensión, baja), reportes de fraude recibidos, anomalías del ranking detectadas, solicitudes de cambio de datos y cambios de estado.",
    args: "{}",
    schema: z.object({}).strict(),
    run: (_args, { vendorId }) => alerts(vendorId),
  },
  clientes_y_chat: {
    description: "Visitas y carritos de clientes con sesión, favoritos, clientes que compraron y que repitieron, y el chat de TU tienda con clientes (conversaciones y últimas preguntas).",
    args: "{}",
    schema: z.object({}).strict(),
    run: (_args, { vendorId }) => customersAndChat(vendorId),
  },
  clientes_potenciales: {
    description: "Tus clientes con más potencial y tus mejores compradores: quién visitó o agregó al carrito y no compró, quién compra más, con nombre, teléfono, pedidos, total gastado y última actividad. Úsala para '¿cuál es mi cliente más potencial?', a quién contactar o a quién ofrecerle un descuento.",
    args: '{ "dias": 7-90 }',
    schema: z.object({ dias: z.number().int().min(7).max(90).default(30) }),
    run: ({ dias }, { vendorId }) => customersRanking(vendorId, dias),
  },
  pedido_al_detalle: {
    description: "Un pedido concreto de TU tienda con todo su detalle (productos, cantidades, precios, cliente, estado, motivo de cancelación). Se busca por el código del pedido (ej. Z-MUAA4037) o, si es de mesa, por su número.",
    args: '{ "codigo": "código o número del pedido" }',
    schema: z.object({ codigo: z.string().trim().min(1).max(30) }),
    run: (args, { vendorId }) => orderDetail(vendorId, args),
  },
  consultar_datos: makeQueryTool("VENDOR"),
  perfil_de_la_tienda: {
    description: "Qué le falta completar a TU tienda (logo, descripción, horarios, ubicación, métodos de pago, rubro, documento del chat) y la calidad de las fichas de tus productos.",
    args: "{}",
    schema: z.object({}).strict(),
    run: (_args, { vendorId }) => storeProfile(vendorId),
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
      return { periodo, productos: rows.map((r) => ({ id: r.productId, nombre: clip(byId[r.productId]?.name, 80), tienda: clip(byId[r.productId]?.vendor?.companyName, 60), unidadesVendidas: r._sum.quantity ?? 0 })) };
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
  consultar_tienda: {
    description: "Cualquier dato de UNA tienda concreta buscada por nombre. 'dato' elige qué: resumen, plan (suscripción y vencimiento), actividad (inicios de sesión y movimientos registrados), algoritmo (posición de sus productos y por qué), productos, pedidos, inventario, resenas, interes (clics y tiempo en ficha), mensajes, ofertas, equipo, alertas, clientes (incluye chat de la tienda), perfil.",
    args: '{ "busqueda": "parte del nombre de la tienda", "dato": "resumen"|"plan"|"actividad"|"algoritmo"|"productos"|"pedidos"|"inventario"|"resenas"|"interes"|"mensajes"|"ofertas"|"equipo"|"alertas"|"clientes"|"clientes_potenciales"|"perfil" }',
    schema: z.object({
      busqueda: z.string().trim().min(2).max(60),
      dato: z.enum(["resumen", "plan", "actividad", "algoritmo", "productos", "pedidos", "inventario", "resenas", "interes", "mensajes", "ofertas", "equipo", "alertas", "clientes", "clientes_potenciales", "perfil"]).default("resumen"),
    }),
    async run({ busqueda, dato }, ctx) {
      const matches = await prisma.vendor.findMany({
        where: { deletedAt: null, OR: [{ companyName: { contains: busqueda, mode: "insensitive" } }, { slug: { contains: busqueda, mode: "insensitive" } }] },
        select: { id: true, companyName: true },
        take: 4,
      });
      if (matches.length === 0) return { error: "No encontré ninguna tienda con ese nombre." };
      const vendorId = matches[0].id;
      const c = { ...ctx, vendorId };
      const byDato = {
        resumen: () => VENDOR_TOOLS.resumen_negocio.run({}, c),
        plan: () => VENDOR_TOOLS.plan_y_suscripcion.run({}, c),
        actividad: () => VENDOR_TOOLS.actividad_de_la_cuenta.run({}, c),
        algoritmo: () => VENDOR_TOOLS.algoritmo_de_mi_tienda.run({}, c),
        productos: () => VENDOR_TOOLS.mis_productos.run({ orden: "ventas", limite: 8 }, c),
        pedidos: () => VENDOR_TOOLS.pedidos_detalle.run({ periodo: "30dias" }, c),
        inventario: () => VENDOR_TOOLS.inventario_critico.run({}, c),
        resenas: () => VENDOR_TOOLS.resenas.run({ limite: 5 }, c),
        interes: () => VENDOR_TOOLS.interes_de_clientes.run({}, c),
        mensajes: () => VENDOR_TOOLS.mensajes_y_notificaciones.run({}, c),
        ofertas: () => VENDOR_TOOLS.ofertas_y_codigos.run({}, c),
        equipo: () => VENDOR_TOOLS.personal_y_mesas.run({}, c),
        alertas: () => VENDOR_TOOLS.alertas_de_la_cuenta.run({}, c),
        clientes: () => VENDOR_TOOLS.clientes_y_chat.run({}, c),
        clientes_potenciales: () => VENDOR_TOOLS.clientes_potenciales.run({ dias: 30 }, c),
        perfil: () => VENDOR_TOOLS.perfil_de_la_tienda.run({}, c),
      };
      return { tienda: matches[0].companyName, dato, otrasCoincidencias: matches.slice(1).map((m) => m.companyName), datos: await byDato[dato]() };
    },
  },
  como_funciona_el_algoritmo: VENDOR_TOOLS.como_funciona_el_algoritmo,
  consultar_datos: makeQueryTool("ADMIN"),
  tiendas_actividad: {
    description: "Actividad de TODAS las tiendas con su NOMBRE: cuáles venden y cuáles no (sin pedidos en N días), con plan, verificación, estado, último pedido, días sin pedidos, último acceso del dueño y productos activos, más un resumen con totales. Úsala para 'qué tiendas no tienen actividad', tiendas dormidas o abandonadas.",
    args: '{ "dias": 7-180, "filtro": "sin_actividad"|"todas", "limite": 1-15 }',
    schema: z.object({ dias: z.number().int().min(7).max(180).default(30), filtro: z.enum(["sin_actividad", "todas"]).default("sin_actividad"), limite: limitSchema(15, 12) }),
    run: ({ dias, filtro, limite }) => storesActivity({ days: dias, filter: filtro, limit: limite }),
  },
  suscripciones_plataforma: {
    description: "Suscripciones de TODA la plataforma: tiendas por plan y estado de verificación, vencimientos de los próximos 14 días, cancelaciones programadas, pruebas gratuitas activas, pagos por confirmar y pagos confirmados en 30 días.",
    args: "{}",
    schema: z.object({}).strict(),
    async run() {
      const now = new Date();
      const in14 = new Date(Date.now() + 14 * DAY_MS);
      const since = new Date(Date.now() - 30 * DAY_MS);
      const [byPlan, byVerification, expiring, cancelling, trials, pending, confirmed] = await Promise.all([
        prisma.vendor.groupBy({ by: ["planType"], where: { deletedAt: null }, _count: { _all: true } }),
        prisma.vendor.groupBy({ by: ["verificationStatus"], where: { deletedAt: null }, _count: { _all: true } }),
        prisma.vendor.findMany({ where: { deletedAt: null, planType: "BUSINESS", verificationStatus: "VERIFIED", nextPaymentDueDate: { lte: in14 } }, orderBy: { nextPaymentDueDate: "asc" }, take: 10, select: { companyName: true, nextPaymentDueDate: true, cancelAtPeriodEnd: true, stripeSubscriptionId: true } }),
        prisma.vendor.count({ where: { deletedAt: null, cancelAtPeriodEnd: true } }),
        prisma.vendor.count({ where: { deletedAt: null, trialEndsAt: { gt: now } } }),
        prisma.subscriptionPayment.findMany({ where: { claimedAt: { not: null }, confirmedAt: null }, orderBy: { claimedAt: "asc" }, take: 8, select: { claimedAt: true, months: true, amount: true, currency: true, vendor: { select: { companyName: true } } } }),
        prisma.subscriptionPayment.groupBy({ by: ["currency"], where: { confirmedAt: { gte: since } }, _count: { _all: true }, _sum: { amount: true } }),
      ]);
      return {
        tiendasPorPlan: byPlan.map((r) => ({ plan: r.planType, tiendas: r._count._all })),
        tiendasPorVerificacion: byVerification.map((r) => ({ estado: r.verificationStatus, tiendas: r._count._all })),
        vencenEnLosProximos14dias: expiring.map((v) => ({ tienda: clip(v.companyName, 50), vence: v.nextPaymentDueDate?.toISOString().slice(0, 10) ?? null, diasRestantes: v.nextPaymentDueDate ? Math.ceil((v.nextPaymentDueDate.getTime() - Date.now()) / DAY_MS) : null, seCancela: v.cancelAtPeriodEnd, cobro: v.stripeSubscriptionId ? "tarjeta" : "transferencia" })),
        cancelacionesProgramadas: cancelling,
        pruebasGratuitasActivas: trials,
        pagosPorConfirmar: pending.map((p) => ({ tienda: clip(p.vendor?.companyName, 50), desde: p.claimedAt?.toISOString().slice(0, 10), meses: p.months, monto: p.amount != null ? money(p.amount) : null, moneda: p.currency })),
        pagosConfirmadosUltimos30dias: confirmed.map((r) => ({ moneda: r.currency, pagos: r._count._all, total: money(r._sum.amount) })),
      };
    },
  },
  actividad_plataforma: {
    description: "Actividad de TODA la plataforma: personas que iniciaron sesión en 24 horas, 7 y 30 días por tipo de cuenta, sesiones abiertas, los últimos movimientos registrados (con la tienda) y cuántos de cada tipo hubo en 7 días.",
    args: '{ "limite": 1-20 }',
    schema: z.object({ limite: limitSchema(20, 12) }),
    async run({ limite }) {
      const since = (days) => new Date(Date.now() - days * DAY_MS);
      const logins = async (days) => Object.fromEntries((await prisma.user.groupBy({ by: ["role"], where: { lastLoginAt: { gte: since(days) } }, _count: { _all: true } })).map((r) => [r.role, r._count._all]));
      const [l1, l7, l30, openSessions, newSessions24h, logs, byAction] = await Promise.all([
        logins(1),
        logins(7),
        logins(30),
        prisma.session.count({ where: { revokedAt: null, expiresAt: { gt: new Date() } } }),
        prisma.session.count({ where: { createdAt: { gte: since(1) } } }),
        prisma.activityLog.findMany({ orderBy: { createdAt: "desc" }, take: limite, select: { action: true, description: true, actorRole: true, createdAt: true, vendor: { select: { companyName: true } } } }),
        prisma.activityLog.groupBy({ by: ["action"], where: { createdAt: { gte: since(7) } }, _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 10 }),
      ]);
      return {
        personasQueInicaronSesion: { ultimas24horas: l1, ultimos7dias: l7, ultimos30dias: l30 },
        sesionesAbiertasAhora: openSessions,
        sesionesIniciadasEnLas24horas: newSessions24h,
        movimientosRegistradosUltimos7diasPorTipo: byAction.map((a) => ({ accion: a.action, veces: a._count._all })),
        ultimosMovimientos: logs.map((l) => ({ fecha: l.createdAt.toISOString(), quien: l.actorRole, tienda: clip(l.vendor?.companyName, 40) || null, accion: l.action, detalle: clip(l.description, 120) })),
      };
    },
  },
  errores_recientes: {
    description: "Errores sin resolver del sistema (origen, mensaje y fecha) y cuántos hubo por origen en 7 días.",
    args: '{ "limite": 1-15 }',
    schema: z.object({ limite: limitSchema(15, 8) }),
    async run({ limite }) {
      const [open, byOrigin, rows] = await Promise.all([
        prisma.errorLog.count({ where: { resolved: false } }),
        prisma.errorLog.groupBy({ by: ["origin"], where: { createdAt: { gte: new Date(Date.now() - 7 * DAY_MS) } }, _count: { _all: true } }),
        prisma.errorLog.findMany({ where: { resolved: false }, orderBy: { createdAt: "desc" }, take: limite, select: { origin: true, message: true, createdAt: true } }),
      ]);
      return { erroresSinResolver: open, ultimos7diasPorOrigen: byOrigin.map((r) => ({ origen: r.origin, veces: r._count._all })), ultimos: rows.map((r) => ({ origen: r.origin, mensaje: clip(r.message, 160), fecha: r.createdAt.toISOString() })) };
    },
  },
  reportes_de_fraude: {
    description: "Reportes de fraude pendientes o con evidencia solicitada: tienda, estado, fecha y el motivo.",
    args: "{}",
    schema: z.object({}).strict(),
    async run() {
      const rows = await prisma.report.findMany({ where: { status: { in: ["PENDING", "EVIDENCE_REQUESTED"] } }, orderBy: { createdAt: "asc" }, take: 8, select: { status: true, message: true, createdAt: true, evidenceDueAt: true, vendor: { select: { companyName: true } } } });
      return { pendientes: rows.map((r) => ({ tienda: clip(r.vendor?.companyName, 50) || "(producto o venta rápida)", estado: r.status, fecha: r.createdAt.toISOString().slice(0, 10), plazoDeEvidencia: r.evidenceDueAt?.toISOString().slice(0, 10) ?? null, motivo: clip(r.message, 160) })) };
    },
  },
  resumen_productos: {
    description: "Catálogo de TODA la plataforma: total de productos, activos, agotados, sin fotos, destacados a mano y los más vistos.",
    args: "{}",
    schema: z.object({}).strict(),
    async run() {
      const live = { vendor: { deletedAt: null, isBlocked: false } };
      const [total, active, outOfStock, noPhotos, featured, topViewed] = await Promise.all([
        prisma.product.count({ where: live }),
        prisma.product.count({ where: { ...live, isActive: true } }),
        prisma.product.count({ where: { ...live, isActive: true, unlimitedStock: false, stock: { lte: 0 } } }),
        prisma.product.count({ where: { ...live, isActive: true, images: { isEmpty: true } } }),
        prisma.product.count({ where: { ...live, isFeatured: true } }),
        prisma.product.findMany({ where: { ...live, isActive: true }, orderBy: { viewCount: "desc" }, take: 5, select: { id: true, name: true, viewCount: true, clickCount: true, salesCount: true, vendor: { select: { companyName: true } } } }),
      ]);
      return { total, activos: active, activosAgotados: outOfStock, activosSinFotos: noPhotos, destacadosAMano: featured, masVistos: topViewed.map((p) => ({ id: p.id, nombre: clip(p.name, 60), tienda: clip(p.vendor?.companyName, 40), vistas: p.viewCount, clics: p.clickCount, ventas: p.salesCount })) };
    },
  },
  estado_ia: {
    description: "Estado de las integraciones de IA: modelos configurados por proveedor, su salud actual y qué proveedores están descansando por cuota agotada o clave inválida (el sistema salta a otro proveedor y vuelve a probar el principal solo).",
    args: "{}",
    schema: z.object({}).strict(),
    async run() {
      const [byProvider, health] = await Promise.all([getAllEffectiveModels(), getModelHealthRows()]);
      return {
        proveedoresDescansando: getProviderCooldowns().map((c) => ({ proveedor: c.provider, motivo: c.kind === "quota" ? "cuota agotada" : "clave inválida", segundosParaReintentar: c.secondsLeft })),
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


// Bloque 276: herramientas de personas, estados de tiendas, agentes de ventas, ventas rápidas y
// clientes. Las del vendedor reciben su vendorId de la sesión; las del admin leen toda la plataforma.
ADMIN_TOOLS.tiendas_por_estado = {
  description: "Cuántas tiendas hay en cada estado y CUÁLES son, con su nombre: activas, suspendidas por inactividad, bloqueadas por el admin y en eliminación pendiente (con motivo y fecha). Úsala SIEMPRE para 'tiendas suspendidas', 'bloqueadas' o 'eliminadas'; pon la lista en 'tabla'.",
  args: "{}",
  schema: z.object({}).strict(),
  run: () => storesByState(),
};
ADMIN_TOOLS.buscar_persona = {
  description: "Busca a UNA PERSONA por nombre, correo o teléfono entre TODAS las cuentas (clientes, dueños de tienda, administradores, usuarios de sistema) y devuelve todo su perfil: rol, contacto, ubicación, compras, su tienda (plan, verificación, estado) y los enlaces a su perfil archivado de verificación y a su tienda. Úsala para '¿quién es X?'.",
  args: '{ "busqueda": "nombre, correo o teléfono" }',
  schema: z.object({ busqueda: z.string().trim().min(2).max(80) }),
  run: ({ busqueda }) => findPerson(busqueda),
};
ADMIN_TOOLS.ficha_del_responsable = {
  description: "Ficha COMPLETA del responsable (representante) de una tienda, buscada por nombre de la tienda o de la persona: nombre, documento, ID fiscal, dirección, ubicación, fechas y revisor del registro, qué fotos subió, notas, incumplimientos y reportes, historial de estados y de verificación, y el enlace a la ficha con las fotos.",
  args: '{ "busqueda": "nombre de la tienda o del responsable" }',
  schema: z.object({ busqueda: z.string().trim().min(2).max(80) }),
  run: ({ busqueda }) => representativeSummary(busqueda),
};
ADMIN_TOOLS.agentes_de_ventas = {
  description: "Usuarios de sistema de TODAS las tiendas: qué tiendas tienen agentes de ventas (o meseros), cuántos, quiénes son y sus ventas manuales de 30 días.",
  args: '{ "tipo": "agentes"|"meseros"|"todos" }',
  schema: z.object({ tipo: z.enum(["agentes", "meseros", "todos"]).default("agentes") }),
  run: ({ tipo }) => salesAgents({ tipo }),
};
VENDOR_TOOLS.agentes_de_ventas = {
  description: "Los usuarios de sistema de TU negocio (agentes de ventas y meseros): quiénes son, si están activos, su último acceso y sus ventas manuales de 30 días.",
  args: '{ "tipo": "agentes"|"meseros"|"todos" }',
  schema: z.object({ tipo: z.enum(["agentes", "meseros", "todos"]).default("todos") }),
  run: ({ tipo }, ctx) => salesAgents({ vendorId: ctx.vendorId, tipo }),
};
ADMIN_TOOLS.ventas_rapidas = {
  description: "La sección Venta rápida: anuncios que publican los clientes (activos, visibles, vendidos, vencidos), quiénes publican y los últimos anuncios.",
  args: "{}",
  schema: z.object({}).strict(),
  run: () => quickSales(),
};
ADMIN_TOOLS.detalle_de_cliente = {
  description: "Un CLIENTE concreto (por nombre) en toda la plataforma: contacto, compras y totales, productos que más compra, lo que visita y agrega al carrito, favoritos, pedidos de productos y reseñas.",
  args: '{ "busqueda": "nombre del cliente" }',
  schema: z.object({ busqueda: z.string().trim().min(2).max(80) }),
  run: ({ busqueda }) => customerDetail({ search: busqueda }),
};
VENDOR_TOOLS.detalle_de_cliente = {
  description: "Un CLIENTE de tu tienda (por nombre): sus compras en tu negocio, los productos que más compra, lo que visita y agrega al carrito, favoritos y reseñas. Solo cuenta lo que hizo en TU tienda.",
  args: '{ "busqueda": "nombre del cliente" }',
  schema: z.object({ busqueda: z.string().trim().min(2).max(80) }),
  run: ({ busqueda }, ctx) => customerDetail({ vendorId: ctx.vendorId, search: busqueda }),
};

// Bloque 260 (pedido explícito — "acceso al historial del chat o otros chats"):
// el asistente puede consultar las OTRAS conversaciones de esta misma persona
// (nunca las de otra). scope/userId/vendorId salen de la sesión (ctx).
const pastConversationsTool = {
  description: "Busca en TUS conversaciones anteriores con este asistente (otras conversaciones, no la actual). Sin 'busqueda' devuelve las más recientes con su título.",
  args: '{ "busqueda": "texto a buscar" (opcional), "limite": 1-8 }',
  schema: z.object({ busqueda: z.string().trim().max(80).optional(), limite: limitSchema(8, 5) }),
  async run({ busqueda, limite }, { scope, userId, vendorId, conversationId }) {
    const owner = { scope, userId, vendorId: vendorId ?? null };
    const notCurrent = conversationId ? { conversationId: { not: conversationId } } : {};
    if (busqueda) {
      const rows = await prisma.assistantMessage.findMany({
        where: { ...owner, ...notCurrent, content: { contains: busqueda, mode: "insensitive" } },
        orderBy: { createdAt: "desc" },
        take: limite,
        select: { role: true, content: true, createdAt: true, conversation: { select: { title: true } } },
      });
      return { coincidencias: rows.map((r) => ({ conversacion: clip(r.conversation?.title, 60), fecha: r.createdAt.toISOString().slice(0, 10), quien: r.role === "user" ? "persona" : "asistente", texto: clip(r.content, 240) })) };
    }
    const convs = await prisma.assistantConversation.findMany({
      where: { ...owner, ...(conversationId ? { id: { not: conversationId } } : {}) },
      orderBy: { updatedAt: "desc" },
      take: limite,
      select: { title: true, updatedAt: true, messages: { orderBy: { createdAt: "desc" }, take: 1, select: { content: true, role: true } } },
    });
    return { conversaciones: convs.map((c) => ({ titulo: clip(c.title, 60), ultimaActividad: c.updatedAt.toISOString().slice(0, 10), ultimoMensaje: clip(c.messages[0]?.content, 200) })) };
  },
};
VENDOR_TOOLS.conversaciones_anteriores = pastConversationsTool;
ADMIN_TOOLS.conversaciones_anteriores = pastConversationsTool;

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
    "/admin/configuracion": "Configuración (seguridad, integraciones, planes y ajustes)",
    "/admin/ubicaciones": "Países y provincias",
    "/admin/categorias": "Categorías",
    "/admin/errores": "Errores",
    "/admin/actividad": "Actividad",
    "/admin/marca": "Marca de la plataforma",
    "/admin/ventas-manuales": "Agentes de ventas",
    "/admin/ventas-rapidas": "Venta rápida",
    "/admin/sugerencias": "Sugerencias",
    "/admin/ofertas-tienda": "Ofertas de tienda",
    "/admin/anuncios": "Anuncios",
    "/admin/asistente": "Asistente del marketplace (entrenar al bot público)",
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
    "/vendedor/reportes": "Reportes de fraude",
    "/vendedor/usuarios": "Usuarios de sistema",
    "/vendedor/perfil": "Mi perfil",
  },
};
