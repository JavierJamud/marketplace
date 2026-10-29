import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import {
  X,
  Store,
  Users,
  ShoppingBag,
  MapPin,
  Activity,
  ShieldCheck,
  ShieldAlert,
  Radar,
  AlertTriangle,
  MessageSquare,
  Pencil,
  CreditCard,
  Wallet,
  Receipt,
  Award,
  Bell,
  CalendarDays,
  CalendarRange,
  BarChart3,
  Layers,
} from "lucide-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { CARD, IconCircle, CardHeader } from "../../components/dashboard/DashboardCard.jsx";
import { WelcomeHeading, WeeklySummaryCard } from "../../components/WelcomeSummary.jsx";
import { NewVendorsCard } from "../../components/admin/NewVendorsCard.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

function fmtMoney(amount, currency) {
  return `${Number(amount).toLocaleString("es-CU", { maximumFractionDigits: 0 })} ${currency}`;
}

function fmtDateOnly(s) {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString("es-CU", { day: "numeric", month: "short", timeZone: "UTC" });
}

function timeAgo(iso) {
  const diffMs = Date.now() - new Date(iso).getTime();
  const mins = Math.floor(diffMs / 60000);
  if (mins < 1) return "Recién";
  if (mins < 60) return `Hace ${mins} min`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `Hace ${hours} h`;
  const days = Math.floor(hours / 24);
  return days === 1 ? "Ayer" : `Hace ${days} días`;
}

// Bloque 230 (mismo criterio que HEALTH_LEVEL en VendorDashboard.jsx — acá
// solo se traduce el score que ya devuelve computeVendorHealthScore del
// backend a color/etiqueta, ningún cálculo nuevo vive en el frontend).
const HEALTH_LEVEL = {
  green: { label: "Saludable", dot: "#0CAE53", bg: "rgba(12,174,83,0.12)" },
  yellow: { label: "Necesita atención", dot: "#8A5100", bg: "rgba(138,81,0,0.12)" },
  red: { label: "Crítico", dot: "#ba1a1a", bg: "rgba(186,26,26,0.12)" },
};

// Bloque 48: mismo patrón de selector Día/Semana/Mes/Año + rango opcional
// que ya usa SalesChartCard en VendorDashboard.jsx (Bloque 225/227) — se
// reusa tal cual, adaptado a GET /admin/dashboard/sales-series (toda la
// plataforma en vez de una sola tienda).
const GRANULARITY_OPTIONS = [
  { key: "day", label: "Día" },
  { key: "week", label: "Semana" },
  { key: "month", label: "Mes" },
  { key: "year", label: "Año" },
];
const GRANULARITY_SUBTITLE = {
  day: "Últimos 30 días",
  week: "Últimas 12 semanas",
  month: "Últimos 12 meses",
  year: "Últimos 5 años",
};

const SERIES_LEGEND = [
  { key: "total", name: "Valor de pedidos", color: "#337475" },
  { key: "orders", name: "Pedidos", color: "#fe9800" },
  { key: "vendors", name: "Tiendas nuevas", color: "#0e6ba8" },
];

function SeriesTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] px-3 py-2">
      <p className="mb-1 text-[11px] font-semibold text-outline">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-[12.5px] font-bold" style={{ color: p.color }}>
          {p.name}: {p.dataKey === "total" ? Number(p.value).toLocaleString("es-CU") : p.value}
        </p>
      ))}
    </div>
  );
}

// Montos de cobro: los USD llevan centavos (un plan de 9,99 USD), los CUP no suelen. Nunca se mezclan monedas.
function fmtPlanMoney(amount, currency) {
  return `${Number(amount ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${currency}`;
}

function ymdLocal(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const PLAN_ROW_GRID = "sm:grid sm:grid-cols-[minmax(0,1.6fr)_72px_minmax(0,1fr)_minmax(0,1fr)] sm:items-center sm:gap-3";

// Ingresos por plan de este mes, con CUP y USD en columnas separadas (nunca se convierten ni se suman entre sí), y las
// tiendas de cada plan. Sale de `revenueByPlan` de GET /admin/dashboard (mismo mes del negocio que el resto de la
// página); si el servidor no lo manda, de GET /admin/plan-stats con el mes en curso. Los dos usan el cálculo sin doble
// cuenta entre el pago inicial y la renovación. Los planes no son fijos (el admin crea y archiva), así que las filas
// salen de la respuesta tal cual; cada una enlaza a Tiendas filtrada por ese plan (?plan=CLAVE).
function PlanRevenueCard({ dashboard, dashboardLoading, dashboardError, retryDashboard }) {
  const fromDashboard = dashboard?.revenueByPlan ?? null;
  const now = new Date();
  const from = ymdLocal(new Date(now.getFullYear(), now.getMonth(), 1));
  const to = ymdLocal(now);
  const stats = useQuery({
    queryKey: ["admin-plan-stats", from, to],
    queryFn: async () => (await api.get("/admin/plan-stats", { params: { from, to } })).data,
    enabled: !!dashboard && !fromDashboard,
  });
  const data = fromDashboard ?? stats.data;
  const isLoading = !data && (dashboardLoading || stats.isLoading);
  const isError = !data && (dashboardError || stats.isError);
  const isFetching = stats.isFetching;
  const refetch = () => (dashboardError ? retryDashboard() : stats.refetch());
  const rows = data?.plans ?? [];
  const totals = data?.totals;
  const noRevenue = rows.length > 0 && !Number(totals?.revenue?.CUP) && !Number(totals?.revenue?.USD);

  return (
    <div className={`${CARD} mb-5 p-6`}>
      <CardHeader
        icon={Layers}
        tone="teal"
        title="Ingresos por plan"
        subtitle="Cobrado este mes y tiendas de cada plan. CUP y USD van por separado."
        to="/admin/suscripciones"
        linkLabel="Ver suscripciones"
      />
      {isLoading ? (
        <div className="mt-4">
          <ListSkeleton rows={4} />
        </div>
      ) : isError ? (
        <div className="mt-4 flex flex-wrap items-center gap-3">
          <p className="text-[13px] text-error">No se pudieron cargar los ingresos por plan.</p>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="min-h-11 rounded-lg border border-outline-variant px-4 text-[13px] font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50"
          >
            {isFetching ? "Reintentando..." : "Reintentar"}
          </button>
        </div>
      ) : rows.length === 0 ? (
        <p className="mt-4 text-[13px] text-on-surface-variant">Todavía no hay planes configurados.</p>
      ) : (
        <div className="mt-4">
          <div className={`hidden border-b border-surface-container-high px-2 pb-2 text-[11px] font-semibold text-outline ${PLAN_ROW_GRID}`}>
            <span>Plan</span>
            <span className="text-right">Tiendas</span>
            <span className="text-right">Cobrado en CUP</span>
            <span className="text-right">Cobrado en USD</span>
          </div>
          <ul className="divide-y divide-surface-container-high">
            {rows.map((r) => {
              const name = r.displayName ?? r.planType;
              const inner = (
                <>
                  <div className="flex min-w-0 items-baseline justify-between gap-3 sm:block">
                    <div className="min-w-0">
                      <div className="truncate text-[13px] font-semibold text-on-surface">
                        {name}
                        {r.archived ? <span className="font-normal text-on-surface-variant"> (archivado)</span> : null}
                      </div>
                      <div className="truncate text-[11.5px] text-on-surface-variant">
                        {/* "paying" en el dashboard, "upToDate" en plan-stats: tiendas con el pago al día. En un plan gratis
                            no hay pago que llevar al día ("0 al día" se leería como un problema). */}
                        {r.isFree ? "Gratis" : `${r.upToDate ?? r.paying ?? 0} al día`}
                        {r.inTrial ? ` · ${r.inTrial} en prueba` : ""}
                        {r.overdue ? ` · ${r.overdue} con cobro atrasado` : ""}
                      </div>
                    </div>
                    <span className="flex-shrink-0 text-[12.5px] font-semibold text-on-surface sm:hidden">
                      {r.vendors} {r.vendors === 1 ? "tienda" : "tiendas"}
                    </span>
                  </div>
                  <span className="hidden text-right text-[13px] font-semibold text-on-surface sm:block">{r.vendors}</span>
                  <div className="mt-1 flex flex-wrap gap-x-4 text-[12.5px] sm:contents">
                    <span className="text-on-surface sm:text-right sm:text-[13px]">{fmtPlanMoney(r.revenue?.CUP, "CUP")}</span>
                    <span className="text-on-surface sm:text-right sm:text-[13px]">{fmtPlanMoney(r.revenue?.USD, "USD")}</span>
                  </div>
                </>
              );
              const rowClass = `block min-h-11 px-2 py-2.5 ${PLAN_ROW_GRID}`;
              return (
                <li key={r.planType}>
                  {r.archived ? (
                    <div className={rowClass}>{inner}</div>
                  ) : (
                    // Sin aria-label: reemplazaría el contenido y el lector de pantalla no leería las tiendas ni las cifras.
                    // El texto oculto al final dice adónde lleva el enlace.
                    <Link
                      to={`/admin/tiendas?plan=${encodeURIComponent(r.planType)}`}
                      className={`${rowClass} rounded-xl transition-colors hover:bg-surface-container/60 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent`}
                    >
                      {inner}
                      <span className="sr-only">. Ver las tiendas del plan {name}</span>
                    </Link>
                  )}
                </li>
              );
            })}
          </ul>
          {totals && (
            <div className={`mt-1 border-t border-surface-container-high px-2 pt-2.5 ${PLAN_ROW_GRID}`}>
              <div className="flex items-baseline justify-between gap-3 sm:block">
                <span className="text-[13px] font-bold text-on-surface">Total</span>
                <span className="text-[12.5px] font-bold text-on-surface sm:hidden">
                  {totals.vendors} {totals.vendors === 1 ? "tienda" : "tiendas"}
                </span>
              </div>
              <span className="hidden text-right text-[13px] font-bold text-on-surface sm:block">{totals.vendors}</span>
              <div className="mt-1 flex flex-wrap gap-x-4 text-[12.5px] font-bold sm:contents">
                <span className="text-on-surface sm:text-right sm:text-[13px]">{fmtPlanMoney(totals.revenue?.CUP, "CUP")}</span>
                <span className="text-on-surface sm:text-right sm:text-[13px]">{fmtPlanMoney(totals.revenue?.USD, "USD")}</span>
              </div>
            </div>
          )}
          {noRevenue && <p className="mt-3 text-[12px] text-on-surface-variant">Todavía no hay cobros confirmados este mes.</p>}
          {/* Las cifras de tiendas usan el mismo alcance que la lista de Tiendas (buildRevenueByPlan, LISTED_VENDOR_SCOPE),
              así que al abrir un plan se ve el mismo número. Lo cobrado sí incluye a todas: es dinero ya recibido. */}
          {fromDashboard && (
            <p className="mt-3 text-[12px] text-on-surface-variant">
              No cuenta las tiendas bloqueadas, suspendidas ni con eliminación pendiente, igual que la lista de Tiendas. Lo cobrado sí las incluye.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

// Bloque 48: etapas "de flujo" del embudo de verificación — las 3 terminales/
// especiales (pago fallido, suspendida, rechazada) se muestran aparte, nunca
// mezcladas con el avance normal del trámite.
const MAIN_FUNNEL_STAGES = ["NOT_STARTED", "PENDING_DOCS", "IN_REVIEW", "PENDING_PAYMENT", "VERIFIED"];

// Bloque 221 (pedido explícito, con imagen de referencia de un dashboard
// fintech): tarjetas con sombra suave, cabecera "ícono en círculo + título +
// subtítulo + botón de flecha". Bloque 48 (pedido explícito — "un dashboard
// más moderno que recoja todos los datos de la plataforma, tiendas con alto
// potencial, gráficas con más detalle y que se puedan filtrar mejor"):
// franja de KPIs reales arriba, una sola gráfica de ventas/pedidos/tiendas
// nuevas con selector de período (reemplaza el bar chart fijo de 3 barras),
// y una fila de decisión con 3 tarjetas nuevas — tiendas con alto potencial
// (reusa computeVendorHealthScore, nunca un cálculo nuevo), todo lo
// pendiente de revisar en un solo lugar, y el embudo de verificación.
export default function AdminDashboard() {
  const { user } = useAuth();

  const { data, isLoading: dashboardLoading, isError: dashboardError, isFetching: dashboardFetching, refetch: refetchDashboard } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => (await api.get("/admin/dashboard")).data,
  });

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  // Sugerencias nuevas, pagos de renovación por confirmar y cambios de datos pendientes: los mismos contadores que el menú
  // lateral (AdminLayout.jsx, misma queryKey, así llegan del caché). Antes se bajaban las tres listas completas solo para
  // contarlas.
  const sectionCountsQuery = useQuery({
    queryKey: ["admin-section-counts"],
    queryFn: async () => (await api.get("/admin/section-counts")).data,
  });
  const sectionCounts = sectionCountsQuery.data;

  // Bloque 48: mismas queryKeys que AdminLayout.jsx usa para el badge del
  // sidebar — React Query comparte el caché, así que estas 3 llegan gratis
  // (sin pegarle de nuevo al servidor) cuando el sidebar ya las pidió.
  const fraudReportsQuery = useQuery({
    queryKey: ["admin-fraud-reports-count"],
    queryFn: async () => (await api.get("/admin/reports/pending-count")).data,
  });
  const fraudReportsCountData = fraudReportsQuery.data;
  const rankingAnomaliesQuery = useQuery({
    queryKey: ["admin-ranking-anomalies-count"],
    queryFn: async () => (await api.get("/admin/ranking-anomalies/pending-count")).data,
  });
  const rankingAnomaliesCountData = rankingAnomaliesQuery.data;
  const errorCountQuery = useQuery({
    queryKey: ["admin-errors-unresolved-count"],
    queryFn: async () => (await api.get("/admin/errors/unresolved-count")).data,
  });
  const errorCountData = errorCountQuery.data;

  const [granularity, setGranularity] = useState("month");
  const [range, setRange] = useState({ from: "", to: "" });
  const [rangeOpen, setRangeOpen] = useState(false);
  const hasRange = Boolean(range.from && range.to);
  const { data: seriesData, isFetching: seriesFetching } = useQuery({
    queryKey: ["admin-sales-series", granularity, hasRange ? range.from : null, hasRange ? range.to : null],
    queryFn: async () =>
      (
        await api.get("/admin/dashboard/sales-series", {
          params: { granularity, ...(hasRange ? { from: range.from, to: range.to } : {}) },
        })
      ).data,
    placeholderData: keepPreviousData,
  });

  const siteName = settings?.siteName || "Baznova";
  // Nombre privado del admin (Mi perfil); sin él, un saludo neutro.
  const firstName = user?.firstName?.trim() || "Administrador";
  const rawMonth = new Date().toLocaleDateString("es-CU", { month: "long", year: "numeric" });
  const monthLabel = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);
  const pending = data?.pendingVerifications ?? 0;
  const suggestionsCount = sectionCounts?.sugerencias?.total ?? 0;
  const fraudReportsCount = fraudReportsCountData?.count ?? 0;
  const rankingAnomaliesCount = rankingAnomaliesCountData?.count ?? 0;
  const errorCount = errorCountData?.count ?? 0;
  const pendingSubPaymentsCount = sectionCounts?.verificaciones?.tabs?.renovaciones ?? 0;
  const pendingChangeRequestsCount = sectionCounts?.verificaciones?.tabs?.cambios ?? 0;

  const series = seriesData?.series ?? [];
  const angleTicks = granularity === "day" || granularity === "week" || series.length > 8;

  // Franja de KPIs — números reales, sin inventar tendencias que el backend
  // no calcula. Valor de pedidos y ticket promedio van por moneda
  // (gmvMonthByCurrency / aovByCurrency): CUP arriba y USD debajo, nunca
  // sumados. Con un servidor viejo sin esos campos, la cifra sin moneda de antes.
  const gmvByCurrency = data?.metrics?.gmvMonthByCurrency ?? null;
  const aovByCurrency = data?.metrics?.aovByCurrency ?? null;
  // Ticket promedio de una moneda sin pedidos este mes: el servidor manda null. Sin redondear: fmtPlanMoney ya deja dos
  // decimales (un ticket de 7,81 USD se leía "8 USD").
  const fmtAov = (value, currency) => (value == null ? `sin pedidos en ${currency}` : fmtPlanMoney(value, currency));
  // Monedas activadas por el admin aparte de CUP y USD (assertActiveCurrency): sus pedidos llegan en los mismos campos y
  // van en el subtítulo, solo las que tuvieron pedidos este mes.
  const otherCurrencies = (byCurrency, hasValue) =>
    Object.entries(byCurrency ?? {}).filter(([c, v]) => c !== "CUP" && c !== "USD" && hasValue(v));
  const subLine = (byCurrency, fmt, hasValue) => [`Y ${fmt(byCurrency.USD, "USD")}`, ...otherCurrencies(byCurrency, hasValue).map(([c, v]) => fmt(v, c))].join(" · ");
  const kpis = [
    { key: "activeVendors", icon: Store, label: "Tiendas activas", value: data ? data.metrics.activeVendors : "—", to: "/admin/tiendas" },
    { key: "orders", icon: ShoppingBag, label: "Pedidos (mes)", value: data ? data.metrics.ordersThisMonth : "—", to: "/admin/actividad" },
    {
      key: "gmv",
      icon: Wallet,
      label: "Valor de pedidos (mes)",
      // gmvMonth (no gmv, que es el total de toda la historia): mismo mes y
      // mismo criterio sin cancelados que "Pedidos (mes)" y la gráfica de ventas.
      // Si el servidor manda el valor por moneda (gmvMonthByCurrency), CUP y USD
      // van por separado y nunca se suman; mientras no, la suma sin moneda.
      // El número va grande y la moneda en pequeño al lado (unit): con "12 345 678 CUP" a 18 px la tarjeta de 2 columnas
      // a 390 px cortaba justo la moneda.
      value: data
        ? gmvByCurrency
          ? Number(gmvByCurrency.CUP ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 2 })
          : Number(data.metrics.gmvMonth ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 2 })
        : "—",
      unit: data && gmvByCurrency ? "CUP" : null,
      sub: gmvByCurrency ? subLine(gmvByCurrency, fmtPlanMoney, (v) => Number(v) > 0) : "Todas las monedas",
    },
    {
      key: "aov",
      icon: Receipt,
      label: "Ticket promedio (mes)",
      // Sin pedidos en CUP el valor es "Sin pedidos" (no 0, que se leería como pedidos de 0) y "En CUP" abre el subtítulo:
      // como unidad al lado, a 390 px partía el texto en tres líneas.
      value: data
        ? aovByCurrency
          ? aovByCurrency.CUP == null
            ? "Sin pedidos"
            : Number(aovByCurrency.CUP).toLocaleString("es-CU", { maximumFractionDigits: 2 })
          : Number(data.metrics.aov).toLocaleString("es-CU", { maximumFractionDigits: 0 })
        : "—",
      unit: data && aovByCurrency && aovByCurrency.CUP != null ? "CUP" : null,
      sub: aovByCurrency
        ? `${aovByCurrency.CUP == null ? "En CUP. " : ""}${subLine(aovByCurrency, fmtAov, (v) => v != null)}`
        : "Todas las monedas",
    },
    { key: "customers", icon: Users, label: "Clientes registrados", value: data ? data.metrics.totalCustomers : "—", to: "/admin/clientes" },
    {
      key: "mrr",
      icon: CreditCard,
      // Sin la sigla en inglés: lo que entra cada mes por las tiendas al día en un plan de pago.
      // "Estimado": es el precio mensual de las tiendas al día, no lo que entró este mes (eso está en Ingresos por plan).
      label: "Ingreso mensual estimado (planes de pago)",
      // Lo cobrado en USD arriba y lo de CUP debajo (también el plan por defecto
      // cuando se cobra): nunca se convierten ni se suman. Sin mrrByCurrency
      // (servidor viejo) queda solo el USD, como antes.
      value: data ? fmtPlanMoney(data.metrics.mrrByCurrency?.USD ?? data.metrics.mrrUsd, "USD") : "—",
      sub: data
        ? `${data.metrics.mrrByCurrency ? `Y ${fmtPlanMoney(data.metrics.mrrByCurrency.CUP, "CUP")} · ` : ""}${data.metrics.activeSubscriptions} ${
            data.metrics.activeSubscriptions === 1 ? "tienda activa" : "tiendas activas"
          }`
        : "",
      to: "/admin/suscripciones",
    },
  ];

  // "Necesita tu atención" — consolida contadores que hoy solo vivían
  // sueltos en el sidebar o en tarjetas separadas, en un solo lugar
  // ordenable de un vistazo.
  const attentionItems = [
    {
      key: "verifications",
      icon: ShieldCheck,
      label: "Verificaciones KYC pendientes",
      count: pending,
      query: { data, isError: dashboardError, isFetching: dashboardFetching, refetch: refetchDashboard },
      to: "/admin/verificaciones",
    },
    { key: "fraud", icon: ShieldAlert, label: "Reportes de fraude", count: fraudReportsCount, query: fraudReportsQuery, to: "/admin/reportes-fraude" },
    {
      key: "ranking",
      icon: Radar,
      label: "Anomalías del ranking",
      count: rankingAnomaliesCount,
      query: rankingAnomaliesQuery,
      to: "/admin/anomalias-ranking",
    },
    { key: "errors", icon: AlertTriangle, label: "Errores del sistema", count: errorCount, query: errorCountQuery, to: "/admin/errores" },
    { key: "suggestions", icon: MessageSquare, label: "Sugerencias nuevas", count: suggestionsCount, query: sectionCountsQuery, to: "/admin/sugerencias" },
    // Los pagos de renovación y los cambios de datos se confirman en Verificaciones, cada uno en su pestaña. Antes llevaban a
    // Suscripciones y a Tiendas, donde no aparece lo pendiente.
    {
      key: "subPayments",
      icon: CreditCard,
      label: "Pagos de suscripción por confirmar",
      count: pendingSubPaymentsCount,
      query: sectionCountsQuery,
      to: "/admin/verificaciones?tab=renovaciones",
    },
    {
      key: "changeRequests",
      icon: Pencil,
      label: "Solicitudes de cambio pendientes",
      count: pendingChangeRequestsCount,
      query: sectionCountsQuery,
      to: "/admin/verificaciones?tab=cambios",
    },
  ].map((i) => ({
    ...i,
    // Sin dato y con error: la consulta falló. Antes quedaba en "cargando" para siempre, y como las tres de section-counts
    // salen de una sola consulta, un fallo dejaba colgadas las tres sin forma de reintentar.
    failed: !i.query.data && !!i.query.isError,
    loading: !i.query.data && !i.query.isError,
  }));
  const failedAttention = attentionItems.filter((i) => i.failed);
  const retryingAttention = failedAttention.some((i) => i.query.isFetching);
  // Una sola consulta puede alimentar varias filas (section-counts): se reintenta una vez cada una.
  const retryAttention = () => [...new Set(failedAttention.map((i) => i.query.refetch))].forEach((refetch) => refetch());
  const totalAttention = attentionItems.reduce((sum, i) => sum + i.count, 0);

  const mainFunnel = data?.verificationFunnel?.filter((s) => MAIN_FUNNEL_STAGES.includes(s.status)) ?? [];
  const specialFunnel = data?.verificationFunnel?.filter((s) => !MAIN_FUNNEL_STAGES.includes(s.status) && s.count > 0) ?? [];
  const maxFunnel = Math.max(1, ...mainFunnel.map((s) => s.count));

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <WelcomeHeading name={firstName} />
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-surface-container-high bg-surface-container-lowest px-4 py-2.5 text-[13px] font-semibold text-on-surface-variant">
            <CalendarDays className="h-4 w-4 text-outline" />
            {monthLabel}
          </span>
          <Link
            to="/admin/verificaciones"
            className="flex items-center gap-1.5 rounded-full bg-secondary-container px-5 py-2.5 text-[13.5px] font-bold text-on-secondary-container shadow-[0_8px_20px_-8px_rgba(254,152,0,0.6)] transition-transform hover:-translate-y-0.5"
          >
            <ShieldCheck className="h-4 w-4" /> Verificaciones
            {pending > 0 && <span className="ml-0.5 rounded-full bg-white/70 px-1.5 text-[11px] font-extrabold text-on-secondary-container">{pending}</span>}
          </Link>
        </div>
      </div>

      <WeeklySummaryCard className="mb-5" />

      {/* ── Franja de KPIs ── */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => {
          const inner = (
            <div className={`${CARD} flex h-full flex-col gap-2.5 p-4`}>
              <IconCircle icon={k.icon} tone="teal" />
              <div className="min-w-0">
                <div className="text-[11px] leading-tight text-outline">{k.label}</div>
                {/* Sin truncate: con varias monedas el valor y el subtítulo pasan a otra línea en vez de cortar la moneda. */}
                <div className="mt-0.5 font-display text-[18px] font-extrabold tracking-tight text-on-surface [overflow-wrap:anywhere]">
                  {k.value}
                  {k.unit && <span className="ml-1 whitespace-nowrap text-[12px] font-bold text-on-surface-variant">{k.unit}</span>}
                </div>
                {k.sub && <div className="text-[10.5px] leading-snug text-outline [overflow-wrap:anywhere]">{k.sub}</div>}
              </div>
            </div>
          );
          return k.to ? (
            <Link key={k.key} to={k.to} className="block transition-transform hover:-translate-y-0.5">
              {inner}
            </Link>
          ) : (
            <div key={k.key}>{inner}</div>
          );
        })}
      </div>

      {/* ── Gráfica única de ventas/pedidos/tiendas nuevas, filtrable ── */}
      <div className={`${CARD} mb-5 flex flex-col p-6`}>
        <CardHeader
          icon={BarChart3}
          title="Ventas y crecimiento de la plataforma"
          subtitle={hasRange ? `Del ${fmtDateOnly(range.from)} al ${fmtDateOnly(range.to)}` : GRANULARITY_SUBTITLE[granularity]}
          to="/admin/actividad"
          linkLabel="Ver actividad"
        />

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <div className="flex gap-1 rounded-full bg-surface-container p-1">
            {GRANULARITY_OPTIONS.map((g) => (
              <button
                key={g.key}
                onClick={() => {
                  setGranularity(g.key);
                  setRange({ from: "", to: "" });
                }}
                className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors ${
                  granularity === g.key && !hasRange ? "bg-tertiary-accent text-white shadow-sm" : "text-on-surface-variant hover:text-on-surface"
                }`}
              >
                {g.label}
              </button>
            ))}
          </div>
          <button
            onClick={() => setRangeOpen((o) => !o)}
            title="Filtrar por rango de fechas"
            className={`flex flex-shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors ${
              hasRange ? "bg-secondary-container text-on-secondary-container" : "bg-surface-container text-on-surface-variant hover:text-on-surface"
            }`}
          >
            <CalendarRange className="h-3.5 w-3.5" /> Rango
          </button>
          <div className="ml-auto flex items-center gap-3">
            {SERIES_LEGEND.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-[11px] font-semibold text-on-surface-variant">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
        </div>

        {rangeOpen && (
          <div className="mt-3 flex flex-wrap items-end gap-2.5 rounded-xl border border-surface-container-high/70 bg-surface-container-low p-3">
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-outline">Desde</label>
              <input
                type="date"
                value={range.from}
                max={range.to || undefined}
                onChange={(e) => setRange((r) => ({ ...r, from: e.target.value }))}
                className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 text-[12.5px] outline-none focus:border-tertiary-accent"
              />
            </div>
            <div>
              <label className="mb-1 block text-[11px] font-semibold text-outline">Hasta</label>
              <input
                type="date"
                value={range.to}
                min={range.from || undefined}
                max={new Date().toISOString().slice(0, 10)}
                onChange={(e) => setRange((r) => ({ ...r, to: e.target.value }))}
                className="rounded-lg border border-outline-variant bg-surface-container-lowest px-2.5 py-1.5 text-[12.5px] outline-none focus:border-tertiary-accent"
              />
            </div>
            {hasRange && (
              <button onClick={() => setRange({ from: "", to: "" })} className="rounded-lg px-2.5 py-1.5 text-[12px] font-semibold text-error hover:bg-error/10">
                Quitar filtro
              </button>
            )}
          </div>
        )}

        <div className="mt-4 flex flex-wrap items-baseline gap-x-6 gap-y-1">
          <div>
            <div className="text-[11px] text-outline">Valor de pedidos</div>
            <div className="font-display text-[20px] font-extrabold tracking-tight text-on-surface">
              {seriesData ? Number(seriesData.total).toLocaleString("es-CU") : "—"}
            </div>
          </div>
          <div>
            <div className="text-[11px] text-outline">Pedidos</div>
            <div className="font-display text-[20px] font-extrabold tracking-tight text-on-surface">{seriesData ? seriesData.orders : "—"}</div>
          </div>
          <div>
            <div className="text-[11px] text-outline">Tiendas nuevas</div>
            <div className="font-display text-[20px] font-extrabold tracking-tight text-on-surface">{seriesData ? seriesData.vendors : "—"}</div>
          </div>
        </div>

        <div className={`mt-2 h-[280px] transition-opacity ${seriesFetching ? "opacity-50" : "opacity-100"}`}>
          <ResponsiveContainer width="100%" height="100%">
            <ComposedChart data={series} margin={{ top: 8, right: 8, left: -8, bottom: angleTicks ? 20 : 0 }}>
              <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e8e5e6" />
              <XAxis
                dataKey="label"
                tick={{ fontSize: 10.5, fill: "#65676c" }}
                axisLine={false}
                tickLine={false}
                interval={series.length > 20 ? Math.ceil(series.length / 12) : 0}
                angle={angleTicks ? -35 : 0}
                textAnchor={angleTicks ? "end" : "middle"}
              />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#65676c" }} axisLine={false} tickLine={false} width={54} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#65676c" }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
              <Tooltip content={<SeriesTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
              <Bar yAxisId="left" dataKey="total" name="Valor de pedidos" radius={[7, 7, 0, 0]} maxBarSize={30} fill="#337475" />
              <Line yAxisId="right" type="monotone" dataKey="orders" name="Pedidos" stroke="#fe9800" strokeWidth={2.5} dot={{ r: 3 }} />
              <Line yAxisId="right" type="monotone" dataKey="vendors" name="Tiendas nuevas" stroke="#0e6ba8" strokeWidth={2.5} dot={{ r: 3 }} strokeDasharray="4 3" />
            </ComposedChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* ── Fila de decisión: alto potencial · necesita atención · embudo ── */}
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-3">
        <div className={`${CARD} flex flex-col p-6`}>
          <CardHeader icon={Award} tone="green" title="Tiendas con alto potencial" subtitle="Salud ≥ 50 y más ingresos en 30 días" to="/admin/tiendas" linkLabel="Ver tiendas" />
          <div className="mt-3 flex flex-1 flex-col">
            {!data ? (
              <ListSkeleton rows={4} />
            ) : data.topPotentialVendors.length ? (
              data.topPotentialVendors.map((v) => {
                const h = HEALTH_LEVEL[v.level];
                return (
                  <Link key={v.vendorId} to={`/admin/tiendas/${v.vendorId}`} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-container/60">
                    <div
                      className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[13px] font-extrabold text-white"
                      style={{ background: v.color || "#337475" }}
                    >
                      {v.companyName.charAt(0).toUpperCase()}
                    </div>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-on-surface">{v.companyName}</div>
                      <div className="truncate text-[11px] text-outline">
                        {Number(v.recentRevenue).toLocaleString("es-CU")} · {v.recentOrders} {v.recentOrders === 1 ? "pedido" : "pedidos"}
                      </div>
                    </div>
                    <span
                      className="flex flex-shrink-0 items-center gap-1 rounded-full px-2 py-1 text-[10.5px] font-bold"
                      style={{ background: h.bg, color: h.dot }}
                    >
                      <span className="h-1.5 w-1.5 rounded-full" style={{ background: h.dot }} /> {v.score}
                    </span>
                  </Link>
                );
              })
            ) : (
              <p className="text-label-sm text-outline">Ninguna tienda llega hoy a ese umbral. Vuelve a mirar cuando haya más actividad.</p>
            )}
          </div>
        </div>

        <div className={`${CARD} flex flex-col p-6`}>
          <CardHeader icon={Bell} tone={totalAttention > 0 ? "red" : "teal"} title="Necesita tu atención" subtitle="Todo lo pendiente, en un solo lugar" />
          <div className="mt-2 flex flex-1 flex-col">
            {attentionItems.map((item) => (
              <Link
                key={item.key}
                to={item.to}
                className={`flex items-center gap-3 rounded-xl px-2 py-2 transition-colors hover:bg-surface-container/60 ${item.count > 0 ? "" : "opacity-55"}`}
              >
                <IconCircle icon={item.icon} tone={item.count > 0 ? "orange" : "neutral"} />
                <div className="min-w-0 flex-1 truncate text-[12.5px] font-semibold text-on-surface">{item.label}</div>
                <span
                  className={`flex-shrink-0 rounded-full px-2 py-0.5 text-[11.5px] font-extrabold ${
                    item.count > 0 ? "bg-secondary/15 text-secondary" : "text-outline"
                  }`}
                >
                  {item.loading ? <span aria-label="Cargando">...</span> : item.failed ? <span aria-label="Sin dato">-</span> : item.count}
                </span>
              </Link>
            ))}
            {failedAttention.length > 0 && (
              <div className="mt-2 flex flex-wrap items-center gap-2 border-t border-surface-container-high/70 pt-2.5">
                <p className="text-[12.5px] text-error">
                  {failedAttention.length === 1 ? "No se pudo cargar un contador." : `No se pudieron cargar ${failedAttention.length} contadores.`}
                </p>
                <button
                  type="button"
                  onClick={retryAttention}
                  disabled={retryingAttention}
                  className="min-h-11 rounded-lg border border-outline-variant px-4 text-[13px] font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50"
                >
                  {retryingAttention ? "Reintentando..." : "Reintentar"}
                </button>
              </div>
            )}
          </div>
        </div>

        <div className={`${CARD} flex flex-col p-6`}>
          <CardHeader icon={ShieldCheck} tone="teal" title="Embudo de verificación" subtitle="Tiendas por etapa" to="/admin/verificaciones" linkLabel="Ver verificaciones" />
          <div className="mt-4 flex flex-1 flex-col justify-around gap-2.5">
            {!data ? (
              <ListSkeleton rows={4} />
            ) : (
              <>
                {mainFunnel.map((s) => (
                  <div key={s.status} className="flex items-center gap-2.5">
                    <span className="w-[104px] flex-shrink-0 truncate text-[11.5px] text-on-surface-variant">{s.label}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container">
                      <div className="h-full rounded-full bg-tertiary-accent-light" style={{ width: `${Math.round((s.count / maxFunnel) * 100)}%` }} />
                    </div>
                    <span className="w-6 flex-shrink-0 text-right text-[11.5px] text-outline">{s.count}</span>
                  </div>
                ))}
                {specialFunnel.length > 0 && (
                  <div className="mt-1 flex flex-wrap gap-1.5 border-t border-surface-container-high/70 pt-2.5">
                    {specialFunnel.map((s) => (
                      // Volver al plan por defecto no es un error: tono neutro, como STATUS_BADGE.PLAN_ENDED en AdminVerifications.
                      <span
                        key={s.status}
                        className={`rounded-full px-2 py-1 text-[10.5px] font-bold ${
                          s.status === "PLAN_ENDED" ? "bg-surface-container text-on-surface-variant" : "bg-error/10 text-error"
                        }`}
                      >
                        {s.label}: {s.count}
                      </span>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </div>
      </div>

      <PlanRevenueCard dashboard={data} dashboardLoading={dashboardLoading} dashboardError={dashboardError} retryDashboard={refetchDashboard} />

      <NewVendorsCard />

      {/* ── Actividad reciente + suscripción por moneda / provincias ── */}
      <div className="mb-7 grid grid-cols-1 gap-5 lg:grid-cols-[minmax(0,2.3fr)_minmax(0,1fr)]">
        <div className={`${CARD} p-6`}>
          <CardHeader icon={Activity} tone="teal" title="Actividad reciente" subtitle="Lo último que pasó en la plataforma" to="/admin/actividad" linkLabel="Ver toda la actividad" />
          {data?.activity?.length ? (
            <div className="mt-4">
              <div className="hidden items-center gap-3 px-2 pb-2 text-[11px] font-semibold text-outline sm:flex">
                <div className="flex-1">Evento</div>
                <div className="w-[96px] text-right">Cuándo</div>
              </div>
              <div className="flex flex-col">
                {data.activity.map((a, i) => (
                  <div key={i} className="flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-surface-container/60">
                    <span className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full text-[14px]" style={{ background: a.bg }}>
                      {a.emoji}
                    </span>
                    <div className="min-w-0 flex-1 text-[13px] text-on-surface">{a.text}</div>
                    <div className="w-[96px] flex-shrink-0 text-right text-[11.5px] text-outline">{timeAgo(a.time)}</div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-body-md text-on-surface-variant">Todavía no hay actividad.</p>
          )}
        </div>

        <div className="flex flex-col gap-5">
          {/* Tarjeta navy de plataforma — ingresos por suscripción confirmados
              este mes, cada moneda en su propia línea (Bloque 47: nunca
              sumadas entre sí, mezclar CUP con USD daría un total sin
              sentido). */}
          <Link
            to="/admin/suscripciones"
            className="relative flex flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary-container p-5 text-white shadow-[0_14px_30px_-10px_rgba(14,26,40,0.6)] transition-transform hover:-translate-y-0.5"
          >
            <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/[0.06]" />
            <div className="pointer-events-none absolute -bottom-12 left-1/3 h-32 w-32 rounded-full bg-white/[0.05]" />
            <div className="relative flex items-center justify-between">
              <span className="font-display text-[15px] font-extrabold italic tracking-tight">{siteName}</span>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] font-bold tracking-wide">ADMIN</span>
            </div>
            <div className="relative mt-5">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/60">Ingresos por suscripción · este mes</div>
              {data?.metrics.subscriptionRevenueByCurrency?.length ? (
                <div className="mt-1 flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
                  {data.metrics.subscriptionRevenueByCurrency.map((r) => (
                    <span key={r.currency} className="truncate font-display text-[20px] font-extrabold tracking-tight">
                      {fmtMoney(r.amount, r.currency)}
                    </span>
                  ))}
                </div>
              ) : (
                <div className="mt-1 font-display text-[18px] font-extrabold tracking-tight text-white/70">
                  {data ? "Sin pagos confirmados aún" : "—"}
                </div>
              )}
            </div>
            <div className="relative mt-5 flex items-end justify-between">
              <div className="h-6 w-8 rounded-[4px] bg-gradient-to-br from-secondary-container to-secondary" />
              <div className="text-right text-[11px] font-semibold text-white/75">{data ? `${data.metrics.businessVendors} ${data.metrics.businessVendors === 1 ? "tienda" : "tiendas"} con plan de pago` : ""}</div>
            </div>
          </Link>

          <div className={`${CARD} flex flex-1 flex-col p-6`}>
            <CardHeader icon={MapPin} tone="teal" title="Tiendas por provincia" to="/admin/tiendas" linkLabel="Ver tiendas" />
            <div className="mt-4 flex flex-1 flex-col justify-around gap-2">
              {data?.byProvince?.length ? (
                data.byProvince.slice(0, 6).map((p) => (
                  <div key={p.name} className="flex items-center gap-2.5">
                    <span className="w-[88px] flex-shrink-0 truncate text-[11.5px] text-on-surface-variant">{p.name}</span>
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-surface-container">
                      <div className="h-full rounded-full bg-tertiary-accent-light" style={{ width: p.pct }} />
                    </div>
                    <span className="w-6 flex-shrink-0 text-right text-[11.5px] text-outline">{p.n}</span>
                  </div>
                ))
              ) : (
                <p className="text-label-sm text-outline">Sin datos todavía.</p>
              )}
            </div>
          </div>
        </div>
      </div>

    </div>
  );
}
