import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient, keepPreviousData } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import {
  ImagePlus,
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
} from "lucide-react";
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../../lib/api.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { CARD, IconCircle, CardHeader } from "../../components/dashboard/DashboardCard.jsx";

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
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const fileRef = useRef(null);
  const [removeTarget, setRemoveTarget] = useState(null);

  const { data } = useQuery({
    queryKey: ["admin-dashboard"],
    queryFn: async () => (await api.get("/admin/dashboard")).data,
  });

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  const { data: newSuggestions } = useQuery({
    queryKey: ["admin-suggestions", "new-count"],
    queryFn: async () => (await api.get("/admin/suggestions", { params: { status: "new" } })).data.suggestions,
  });

  // Bloque 48: mismas queryKeys que AdminLayout.jsx usa para el badge del
  // sidebar — React Query comparte el caché, así que estas 3 llegan gratis
  // (sin pegarle de nuevo al servidor) cuando el sidebar ya las pidió.
  const { data: fraudReportsCountData } = useQuery({
    queryKey: ["admin-fraud-reports-count"],
    queryFn: async () => (await api.get("/admin/reports/pending-count")).data,
  });
  const { data: rankingAnomaliesCountData } = useQuery({
    queryKey: ["admin-ranking-anomalies-count"],
    queryFn: async () => (await api.get("/admin/ranking-anomalies/pending-count")).data,
  });
  const { data: errorCountData } = useQuery({
    queryKey: ["admin-errors-unresolved-count"],
    queryFn: async () => (await api.get("/admin/errors/unresolved-count")).data,
  });
  const { data: pendingSubPayments } = useQuery({
    queryKey: ["admin-subscription-payments-pending"],
    queryFn: async () => (await api.get("/admin/subscription-payments/pending")).data.payments,
  });
  const { data: pendingChangeRequests } = useQuery({
    queryKey: ["admin-change-requests-pending"],
    queryFn: async () => (await api.get("/admin/change-requests")).data.requests,
  });

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

  const uploadHero = useMutation({
    mutationFn: async (files) => {
      const form = new FormData();
      for (const f of files) form.append("images", f);
      return (await api.post("/admin/settings/hero-images", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (_data, files) => {
      toast.success(files.length > 1 ? "Imágenes agregadas al hero." : "Imagen agregada al hero.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudieron subir las imágenes."),
  });

  const removeHero = useMutation({
    mutationFn: async (url) => (await api.delete("/admin/settings/hero-images", { data: { url } })).data,
    onSuccess: () => {
      setRemoveTarget(null);
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => {
      setRemoveTarget(null);
      toast.error(err.response?.data?.error ?? "No se pudo eliminar la imagen.");
    },
  });

  function handleFileChange(e) {
    const files = Array.from(e.target.files ?? []);
    if (!files.length) return;
    uploadHero.mutate(files);
    e.target.value = "";
  }

  const heroImages = settings?.heroImages ?? [];
  const siteName = settings?.siteName || "Baznova";
  const firstName = user?.fullName?.split(" ")[0] || "Admin";
  const rawMonth = new Date().toLocaleDateString("es-CU", { month: "long", year: "numeric" });
  const monthLabel = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);
  const pending = data?.pendingVerifications ?? 0;
  const suggestionsCount = newSuggestions?.length ?? 0;
  const fraudReportsCount = fraudReportsCountData?.count ?? 0;
  const rankingAnomaliesCount = rankingAnomaliesCountData?.count ?? 0;
  const errorCount = errorCountData?.count ?? 0;
  const pendingSubPaymentsCount = pendingSubPayments?.length ?? 0;
  const pendingChangeRequestsCount = pendingChangeRequests?.length ?? 0;

  const series = seriesData?.series ?? [];
  const angleTicks = granularity === "day" || granularity === "week" || series.length > 8;

  // Franja de KPIs — números reales, sin inventar tendencias que el backend
  // no calcula. GMV/ticket promedio se muestran sin sufijo de moneda a
  // propósito: Order.total mezcla monedas por ítem (OrderItem.currency), así
  // que un solo "CUP" al lado sería un dato falso, no una simplificación.
  const kpis = [
    { key: "activeVendors", icon: Store, label: "Tiendas activas", value: data ? data.metrics.activeVendors : "—", to: "/admin/tiendas" },
    { key: "orders", icon: ShoppingBag, label: "Pedidos (mes)", value: data ? data.metrics.ordersThisMonth : "—", to: "/admin/actividad" },
    {
      key: "gmv",
      icon: Wallet,
      label: "Valor de pedidos (mes)",
      value: data ? Number(data.metrics.gmv).toLocaleString("es-CU") : "—",
      sub: "Todas las monedas",
    },
    {
      key: "aov",
      icon: Receipt,
      label: "Ticket promedio (mes)",
      value: data ? Number(data.metrics.aov).toLocaleString("es-CU", { maximumFractionDigits: 0 }) : "—",
      sub: "Todas las monedas",
    },
    { key: "customers", icon: Users, label: "Clientes registrados", value: data ? data.metrics.totalCustomers : "—", to: "/admin/clientes" },
    {
      key: "mrr",
      icon: CreditCard,
      label: "MRR (Business)",
      value: data ? fmtMoney(data.metrics.mrrUsd, "USD") : "—",
      sub: data ? `${data.metrics.activeSubscriptions} tiendas activas` : "",
      to: "/admin/suscripciones",
    },
  ];

  // "Necesita tu atención" — consolida contadores que hoy solo vivían
  // sueltos en el sidebar o en tarjetas separadas, en un solo lugar
  // ordenable de un vistazo.
  const attentionItems = [
    { key: "verifications", icon: ShieldCheck, label: "Verificaciones KYC pendientes", count: pending, loading: !data, to: "/admin/verificaciones" },
    { key: "fraud", icon: ShieldAlert, label: "Reportes de fraude", count: fraudReportsCount, loading: !fraudReportsCountData, to: "/admin/reportes-fraude" },
    {
      key: "ranking",
      icon: Radar,
      label: "Anomalías del ranking",
      count: rankingAnomaliesCount,
      loading: !rankingAnomaliesCountData,
      to: "/admin/anomalias-ranking",
    },
    { key: "errors", icon: AlertTriangle, label: "Errores del sistema", count: errorCount, loading: !errorCountData, to: "/admin/errores" },
    { key: "suggestions", icon: MessageSquare, label: "Sugerencias nuevas", count: suggestionsCount, loading: !newSuggestions, to: "/admin/sugerencias" },
    {
      key: "subPayments",
      icon: CreditCard,
      label: "Pagos de suscripción por confirmar",
      count: pendingSubPaymentsCount,
      loading: !pendingSubPayments,
      to: "/admin/suscripciones",
    },
    {
      key: "changeRequests",
      icon: Pencil,
      label: "Solicitudes de cambio pendientes",
      count: pendingChangeRequestsCount,
      loading: !pendingChangeRequests,
      to: "/admin/tiendas",
    },
  ];
  const totalAttention = attentionItems.reduce((sum, i) => sum + i.count, 0);

  const mainFunnel = data?.verificationFunnel?.filter((s) => MAIN_FUNNEL_STAGES.includes(s.status)) ?? [];
  const specialFunnel = data?.verificationFunnel?.filter((s) => !MAIN_FUNNEL_STAGES.includes(s.status) && s.count > 0) ?? [];
  const maxFunnel = Math.max(1, ...mainFunnel.map((s) => s.count));

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 font-display text-[28px] font-extrabold tracking-tight text-on-surface">
            Hola de nuevo, <span className="font-medium text-on-surface-variant">{firstName}</span>
          </h1>
          <p className="text-[13.5px] text-outline">Así va {siteName} hoy — toda la plataforma, en un vistazo.</p>
        </div>
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

      {/* ── Franja de KPIs ── */}
      <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
        {kpis.map((k) => {
          const inner = (
            <div className={`${CARD} flex h-full flex-col gap-2.5 p-4`}>
              <IconCircle icon={k.icon} tone="teal" />
              <div className="min-w-0">
                <div className="text-[11px] leading-tight text-outline">{k.label}</div>
                <div className="mt-0.5 truncate font-display text-[18px] font-extrabold tracking-tight text-on-surface">{k.value}</div>
                {k.sub && <div className="truncate text-[10.5px] text-outline">{k.sub}</div>}
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
                tick={{ fontSize: 10.5, fill: "#75777c" }}
                axisLine={false}
                tickLine={false}
                interval={series.length > 20 ? Math.ceil(series.length / 12) : 0}
                angle={angleTicks ? -35 : 0}
                textAnchor={angleTicks ? "end" : "middle"}
              />
              <YAxis yAxisId="left" tick={{ fontSize: 10, fill: "#75777c" }} axisLine={false} tickLine={false} width={54} />
              <YAxis yAxisId="right" orientation="right" tick={{ fontSize: 10, fill: "#75777c" }} axisLine={false} tickLine={false} width={32} allowDecimals={false} />
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
              <p className="text-label-sm text-outline">Cargando...</p>
            ) : data.topPotentialVendors.length ? (
              data.topPotentialVendors.map((v) => {
                const h = HEALTH_LEVEL[v.level];
                return (
                  <Link key={v.vendorId} to="/admin/tiendas" className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-container/60">
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
              <p className="text-label-sm text-outline">Ninguna tienda llega hoy a ese umbral — vuelve a mirar cuando haya más actividad.</p>
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
                  {item.loading ? "—" : item.count}
                </span>
              </Link>
            ))}
          </div>
        </div>

        <div className={`${CARD} flex flex-col p-6`}>
          <CardHeader icon={ShieldCheck} tone="teal" title="Embudo de verificación" subtitle="Tiendas por etapa" to="/admin/verificaciones" linkLabel="Ver verificaciones" />
          <div className="mt-4 flex flex-1 flex-col justify-around gap-2.5">
            {!data ? (
              <p className="text-label-sm text-outline">Cargando...</p>
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
                      <span key={s.status} className="rounded-full bg-error/10 px-2 py-1 text-[10.5px] font-bold text-error">
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

      {/* ── Actividad reciente + suscripción por moneda / provincias ── */}
      <div className="mb-7 grid grid-cols-1 gap-5 lg:grid-cols-[2.3fr_1fr]">
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
              <div className="text-right text-[11px] font-semibold text-white/75">{data ? `${data.metrics.businessVendors} tiendas Business` : ""}</div>
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

      <div className={`${CARD} p-6`}>
        <CardHeader icon={ImagePlus} tone="teal" title="Imagen principal del sitio" subtitle="Se muestra en la primera sección (hero) de la Home para todos los visitantes" />
        <p className="mb-1 mt-3 text-[12.5px] text-outline">
          Una a la vez, con un fundido automático. Si subes más de una, abajo del hero aparecen puntos que marcan cuántas hay. Si no subes
          ninguna, se usa un placeholder.
        </p>
        <p className="mb-4 text-[12.5px] text-outline">
          Tamaño recomendado: <strong>1200×800px</strong> o más grande, en relación <strong>3:2</strong> — el mismo
          formato del recuadro donde se muestra en la Home. Cada imagen siempre se ajusta completa a ese espacio sin
          deformarse ni recortarse; si sube con otra relación de aspecto (por ejemplo, más alta que ancha), queda
          centrada con el sobrante relleno en vez de estirarse.
        </p>
        <div className="flex flex-wrap gap-2.5">
          {heroImages.map((url) => (
            <div key={url} className="group relative h-[90px] w-[130px] flex-shrink-0 overflow-hidden rounded-xl border border-surface-container-high bg-surface-container">
              <img src={`${api.defaults.baseURL}${url}`} alt="" className="h-full w-full object-contain" />
              <button
                type="button"
                onClick={() => setRemoveTarget(url)}
                disabled={removeHero.isPending}
                className="absolute right-1 top-1 rounded-full bg-black/60 p-1 text-white opacity-0 hover:bg-black/80 group-hover:opacity-100"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </div>
          ))}
          <button
            onClick={() => fileRef.current?.click()}
            disabled={uploadHero.isPending}
            className="flex h-[90px] w-[130px] flex-shrink-0 flex-col items-center justify-center gap-1.5 rounded-xl border border-dashed border-outline-variant text-on-secondary-container transition-colors hover:bg-surface-container/40 disabled:opacity-50"
          >
            <ImagePlus className="h-5 w-5" />
            <span className="text-[12px] font-bold">{uploadHero.isPending ? "Subiendo..." : "Agregar imagen(es)"}</span>
          </button>
          <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp" multiple className="hidden" onChange={handleFileChange} />
        </div>
      </div>

      <ConfirmModal
        open={!!removeTarget}
        title="¿Eliminar esta imagen del hero?"
        message="Se quita del slider de la Home de inmediato. Esta acción no se puede deshacer."
        confirmLabel={removeHero.isPending ? "Eliminando..." : "Sí, eliminar"}
        danger
        onConfirm={() => removeHero.mutate(removeTarget)}
        onCancel={() => setRemoveTarget(null)}
      />
    </div>
  );
}
