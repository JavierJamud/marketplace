import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import {
  AlertTriangle,
  PackageX,
  TrendingUp,
  Users,
  Sparkles,
  MousePointerClick,
  Timer,
  Award,
  Boxes,
  Star,
  Plus,
  ArrowUpRight,
  CalendarDays,
  CalendarRange,
  BarChart3,
  Receipt,
  Wallet,
  Gauge,
  Eye,
  X,
} from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, LabelList } from "recharts";
import { api } from "../../lib/api.js";
import { CARD, CARD_SHADOW, IconCircle, ArrowLink, CardHeader } from "../../components/dashboard/DashboardCard.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function fmtShortDate(d) {
  return new Date(d).toLocaleDateString("es-CU", { day: "numeric", month: "short" });
}

// Bloque 225: los inputs type="date" trabajan con strings "YYYY-MM-DD" sin
// hora — new Date("2026-09-01") ya los interpreta como medianoche UTC, así
// que formatear con la hora LOCAL del navegador puede mostrar el día
// anterior en husos horarios negativos (mismo tipo de bug que se encontró y
// corrigió del lado del backend, ver vendors.controller.js). timeZone:"UTC"
// lo deja siempre consistente con el string que el propio input mostraba.
function fmtDateOnly(s) {
  return new Date(`${s}T00:00:00Z`).toLocaleDateString("es-CU", { day: "numeric", month: "short", timeZone: "UTC" });
}

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

const STATUS_LABEL = {
  NEW: "Nuevo",
  PREPARING: "Preparando",
  READY: "En camino",
  DELIVERED: "Entregado",
  CANCELLED: "Cancelado",
  RECEIVED: "Recibido",
};
const STATUS_COLOR = {
  NEW: "#337475",
  PREPARING: "#8A5100",
  READY: "#0A8F42",
  DELIVERED: "#0CAE53",
  CANCELLED: "#ba1a1a",
  RECEIVED: "#75777c",
};
// Bloque 14: valores consolidados de OrderChannel (antes WHATSAPP/TRANSFER).
const CHANNEL_LABEL = { CASH: "Efectivo", COD: "Pago contra entrega", ONLINE: "Pago en línea con el vendedor", TABLE: "Mesa" };

// Bloque 230 (Fase 3, pedido explícito — "score de salud de tienda para el
// vendedor (semáforo)"): 3 niveles reales de vuelta del backend
// (computeVendorHealthScore, vendors.controller.js) — acá solo se traduce a
// color/etiqueta, ningún cálculo nuevo vive en el frontend.
const HEALTH_LEVEL = {
  green: { label: "Saludable", tone: "green", dot: "#0CAE53", bg: "rgba(12,174,83,0.12)" },
  yellow: { label: "Necesita atención", tone: "orange", dot: "#8A5100", bg: "rgba(138,81,0,0.12)" },
  red: { label: "Crítico", tone: "red", dot: "#ba1a1a", bg: "rgba(186,26,26,0.12)" },
};

// Bloque 218/219/221 (pedido explícito, con imagen de referencia de un
// dashboard fintech — "rediséñalo, fíjate en cada detalle", manteniendo la
// paleta propia del sitio, no la verde de la imagen): tarjetas con sombra
// suave, cabecera "ícono en círculo + título + subtítulo + botón de flecha"
// en cada tarjeta, y la MISMA composición de la referencia — fila hero de 3
// columnas (tarjeta de membresía / gráfica con la barra pico resaltada /
// balance del mes con gráfica de área) y debajo tabla de pedidos + columna
// con métrica grande y tarjeta anidada de avatares.
function ChartTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] px-3 py-2">
      <p className="text-[11px] font-semibold text-outline">{label}</p>
      <p className="text-[13px] font-bold text-on-surface">{fmtCUP(payload[0].value)}</p>
    </div>
  );
}

// Etiqueta flotante sobre la barra pico (mismo detalle que el "+17.8%" de
// la referencia). Recharts pasa x/y/width de la barra ya calculados, así
// que la posición sigue a la barra en cualquier ancho de pantalla — nunca
// hay que calcular píxeles a mano.
function PeakLabel({ x, y, width, value, index, peakIndex }) {
  if (index !== peakIndex || !(Number(value) > 0)) return null;
  const cx = x + width / 2;
  const text = fmtCUP(value);
  const w = text.length * 6.6 + 18;
  return (
    <g>
      <rect x={cx - w / 2} y={y - 36} width={w} height={21} rx={10.5} fill="#337475" />
      <text x={cx} y={y - 21.5} textAnchor="middle" fill="#ffffff" fontSize={10.5} fontWeight={700}>
        {text}
      </text>
      <circle cx={cx} cy={y - 7} r={3} fill="#337475" />
    </g>
  );
}

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

// Bloque 225 (pedido explícito, con captura — "que tu gráfica de ventas por
// día y ventas por mes y ventas de los últimos 12 meses sea una sola con
// varios botones de cambio... día, semana, mes, año... y también filtrar de
// una fecha a otra"): reemplaza las 3 gráficas fijas de antes por UNA sola,
// con selector de granularidad + un rango de fechas opcional que pisa el
// rango por default de esa granularidad — ver GET /vendors/me/dashboard/
// sales-series (vendors.controller.js) para el cálculo real de cada barra.
function SalesChartCard() {
  const [granularity, setGranularity] = useState("month");
  const [range, setRange] = useState({ from: "", to: "" });
  const [rangeOpen, setRangeOpen] = useState(false);
  const hasRange = Boolean(range.from && range.to);

  const { data, isFetching } = useQuery({
    queryKey: ["vendor-sales-series", granularity, hasRange ? range.from : null, hasRange ? range.to : null],
    queryFn: async () =>
      (
        await api.get("/vendors/me/dashboard/sales-series", {
          params: { granularity, ...(hasRange ? { from: range.from, to: range.to } : {}) },
        })
      ).data,
    // Bloque 225: mientras llega la respuesta del nuevo filtro, se sigue
    // viendo la gráfica anterior (atenuada, ver isFetching más abajo) en vez
    // de un parpadeo a vacío — react-query v5, reemplaza al viejo
    // keepPreviousData:true.
    placeholderData: keepPreviousData,
  });

  const series = data?.series ?? [];
  const peakIndex = series.reduce((best, cur, i) => (Number(cur.total) > Number(series[best]?.total ?? -1) ? i : best), -1);
  const angleTicks = granularity === "day" || granularity === "week" || series.length > 8;

  return (
    <div className={`${CARD} flex flex-col p-6`}>
      <CardHeader
        icon={BarChart3}
        title="Ventas"
        subtitle={hasRange ? `Del ${fmtDateOnly(range.from)} al ${fmtDateOnly(range.to)}` : GRANULARITY_SUBTITLE[granularity]}
        to="/vendedor/pedidos"
        linkLabel="Ver pedidos"
      />

      {/* Bloque 227 (pedido explícito, con captura — "cuando selecciono día
          se ve al lado del título pero cuando selecciono mes se ve
          debajo"): esto vivía dentro del `right` de CardHeader, envolviendo
          o no según si entraba justo en el ancho disponible en ese momento
          (`flex-wrap` decide solo según los px reales de cada estado) — con
          "Día" a veces cabía al lado del título y con "Mes" no, un salto
          inconsistente. Ahora es su PROPIA fila, siempre debajo del título,
          sin depender de ningún cálculo de ancho. */}
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

      <div className="mt-4 flex items-baseline gap-2.5">
        <div className="font-display text-[22px] font-extrabold tracking-tight text-on-surface">{data ? fmtCUP(data.total) : "—"}</div>
        {data && <div className="text-[12px] text-outline">{data.orders} {data.orders === 1 ? "pedido" : "pedidos"}</div>}
      </div>

      {/* Bloque 225 (bug real encontrado en la propia verificación en vivo de
          este bloque): `flex-1` junto a una altura fija, dentro de un padre
          `flex flex-col` (eje principal = vertical), hace que el navegador
          IGNORE la altura fija (flex-basis:0% del flex-1 le gana a `height`
          en el eje principal) — la gráfica colapsaba a 0px de alto y
          desaparecía en silencio, aunque los datos sí habían llegado bien.
          Solo la altura fija, sin flex-1. */}
      <div className={`mt-2 h-[220px] transition-opacity ${isFetching ? "opacity-50" : "opacity-100"}`}>
        <ResponsiveContainer width="100%" height="100%">
          <BarChart data={series} margin={{ top: 32, right: 4, left: -8, bottom: angleTicks ? 20 : 0 }}>
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
            <YAxis tick={{ fontSize: 10, fill: "#75777c" }} axisLine={false} tickLine={false} width={44} />
            <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
            <Bar dataKey="total" radius={[7, 7, 7, 7]} maxBarSize={34} fill="#337475">
              <LabelList dataKey="total" content={(props) => <PeakLabel {...props} peakIndex={peakIndex} />} />
            </Bar>
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}

// Bloque 194 ("cada producto dentro de su pedido debe mostrar el estado" —
// no, ese fue otro bloque; acá: listas cortas repetidas 4 veces en esta
// página con el mismo layout foto+nombre+badge) — un solo componente
// reusado en vez de copiar el mismo JSX 4 veces.
function MiniProductRow({ image, name, badge, badgeColor }) {
  return (
    <div className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-container/50">
      <div className="h-10 w-10 flex-shrink-0 overflow-hidden rounded-xl bg-surface-container">
        {image && <img src={imgUrl(image)} alt="" className="h-full w-full object-cover" />}
      </div>
      <div className="flex-1 truncate text-[13px] font-semibold text-on-surface">{name}</div>
      {badge && (
        <span className="flex-shrink-0 rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: `${badgeColor}1a`, color: badgeColor }}>
          {badge}
        </span>
      )}
    </div>
  );
}

// Bloque 230 (pedido explícito, con captura — "quiero que cada uno tenga un
// botón de ver y al hacer clic... se levante la ventana con los datos que
// está mostrando y detalles"): mismo patrón de overlay/panel que
// OrderDetailModal.jsx (click afuera cierra, X arriba a la derecha), y
// MiniProductRow (arriba) reusado tal cual para cada fila de producto.
function InventoryDetailModal({ title, subtitle, color, products, badge, onClose }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4"
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-lg bg-surface-container-lowest p-6">
        <div className="mb-1 flex items-start justify-between gap-3">
          <div>
            <h3 className="text-title-lg font-bold text-on-surface">{title}</h3>
            <p className="text-[12.5px] text-outline">{subtitle}</p>
          </div>
          <button onClick={onClose} className="flex-shrink-0 rounded-full p-1.5 text-outline hover:bg-surface-container">
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="mt-3 flex flex-col">
          {products.length > 0 ? (
            products.map((p) => <MiniProductRow key={p.id} image={p.images?.[0]} name={p.name} badge={badge(p)} badgeColor={color} />)
          ) : (
            <p className="py-3 text-body-md text-on-surface-variant">No hay productos en esta categoría.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function unitsLabel(n) {
  return `${n} ${n === 1 ? "unidad" : "unidades"}`;
}

// Cada tarjeta de "inventario en tiempo real" sabe armar su propio modal a
// partir de `analytics.inventory` (ver getDashboardAnalytics,
// vendors.controller.js) — mismos 4 grupos de productos que ya calcula el
// backend para los conteos, ahora también expuestos como lista.
const INVENTORY_STATS = [
  {
    key: "tracked",
    label: "Productos con seguimiento",
    color: "#337475",
    value: (inv) => inv.trackedProducts,
    products: (inv) => inv.products.tracked,
    badge: (p) => unitsLabel(p.stock),
    subtitle: (inv) => `${inv.trackedProducts} ${inv.trackedProducts === 1 ? "producto lleva" : "productos llevan"} seguimiento de stock.`,
  },
  {
    key: "units",
    label: "Unidades totales",
    color: "#0E6BA8",
    value: (inv) => inv.totalUnits,
    products: (inv) => [...inv.products.tracked].sort((a, b) => b.stock - a.stock),
    badge: (p) => unitsLabel(p.stock),
    subtitle: (inv) => `${unitsLabel(inv.totalUnits)} en total, sumando el stock de tus ${inv.trackedProducts} productos con seguimiento.`,
  },
  {
    key: "lowStock",
    label: "Con poco stock",
    color: "#8A5100",
    value: (inv) => inv.lowStockCount,
    products: (inv) => inv.products.lowStock,
    badge: (p) => unitsLabel(p.stock),
    subtitle: () => "Repón pronto para no perder ventas por falta de inventario.",
  },
  {
    key: "outOfStock",
    label: "Agotados",
    color: "#ba1a1a",
    value: (inv) => inv.outOfStockCount,
    products: (inv) => inv.products.outOfStock,
    badge: () => "Sin stock",
    subtitle: () => "Sin unidades disponibles — no se pueden vender hasta reponer.",
  },
  {
    key: "unlimited",
    label: "Disponibles siempre",
    color: "#0A8F42",
    value: (inv) => inv.unlimitedStockProducts,
    products: (inv) => inv.products.unlimited,
    badge: () => "Sin seguimiento",
    subtitle: () => "Marcados como \"disponible siempre\" — nunca se les hace seguimiento de stock.",
  },
];

const BEST_SELLER_TABS = [
  { key: "today", label: "Hoy" },
  { key: "thisWeek", label: "Esta semana" },
  { key: "thisMonth", label: "Este mes" },
];

export default function VendorDashboard() {
  const { vendor } = useOutletContext();
  const [bestSellerTab, setBestSellerTab] = useState("thisWeek");
  const [openInventoryStat, setOpenInventoryStat] = useState(null);

  const { data } = useQuery({
    queryKey: ["vendor-dashboard"],
    queryFn: async () => (await api.get("/vendors/me/dashboard")).data,
  });

  // Bloque 194 (pedido explícito — "más resúmenes en su panel, basado en el
  // algoritmo que utiliza la plataforma... la gráfica colorida... los
  // productos más vendidos por día, por semana y por mes, el inventario en
  // tiempo real... resumen de sus meseros que más venden"): endpoint
  // separado del de arriba, ver getDashboardAnalytics (vendors.controller.js).
  const { data: analytics } = useQuery({
    queryKey: ["vendor-dashboard-analytics"],
    queryFn: async () => (await api.get("/vendors/me/dashboard/analytics")).data,
  });

  // Bloque 194 ("la IA vaya reconociendo el modo de uso del negocio y le
  // recomiende consejos... consejos diarios"): se genera 1 vez por día en
  // el propio backend (ver getOrGenerateVendorDailyTips) — acá solo se pide
  // y se muestra, nunca staleTime corto (no hay ningún motivo para pedirlo
  // de nuevo dentro del mismo día, ya viene cacheado del lado del server).
  const { data: tipsData, isLoading: tipsLoading } = useQuery({
    queryKey: ["vendor-dashboard-tips"],
    queryFn: async () => (await api.get("/vendors/me/dashboard/tips")).data,
    staleTime: 60 * 60 * 1000,
  });

  const bestSellers = analytics?.bestSellers?.[bestSellerTab] ?? [];

  // Mismo rango que usa el backend para salesThisWeek (últimos 7 días, ver
  // getDashboard en vendors.controller.js) — el chip solo lo hace visible.
  const weekRange = `${fmtShortDate(Date.now() - 7 * 24 * 60 * 60 * 1000)} – ${fmtShortDate(Date.now())}`;
  const potential = data?.potentialCustomers ?? [];

  return (
    <div>
      <div className="mb-7 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="mb-1 font-display text-[28px] font-extrabold tracking-tight text-on-surface">
            Hola de nuevo, <span className="font-medium text-on-surface-variant">{vendor?.companyName}</span>
          </h1>
          <p className="text-[13.5px] text-outline">Así va tu tienda esta semana.</p>
        </div>
        <div className="flex flex-wrap items-center gap-2.5">
          <span className="inline-flex items-center gap-2 rounded-full border border-surface-container-high bg-surface-container-lowest px-4 py-2.5 text-[13px] font-semibold text-on-surface-variant">
            <CalendarDays className="h-4 w-4 text-outline" />
            {weekRange}
          </span>
          <Link
            to="/vendedor/productos"
            className="flex items-center gap-1.5 rounded-full bg-secondary-container px-5 py-2.5 text-[13.5px] font-bold text-on-secondary-container shadow-[0_8px_20px_-8px_rgba(254,152,0,0.6)] transition-transform hover:-translate-y-0.5"
          >
            <Plus className="h-4 w-4" /> Nuevo producto
          </Link>
        </div>
      </div>

      {/* ── Fila hero — 2 columnas (pedido explícito: "ventas por día" y
          "ventas de este mes" van uno debajo del otro, más anchos y no tan
          altos/estirados, en vez de 3 columnas angostas). ── */}
      <div className="mb-5 grid grid-cols-1 items-start gap-5 lg:grid-cols-[1fr_1.6fr]">
        {/* Columna 1: métrica chica → métrica chica con pill (pedido
            explícito: se saca la tarjeta de membresía que iba en medio —
            no aportaba nada que el vendedor no viera ya en Verificación). */}
        <div className="flex flex-col gap-4">
          <div className={`${CARD} p-5`}>
            <CardHeader icon={TrendingUp} tone="green" title="Ventas (semana)" subtitle="Últimos 7 días" to="/vendedor/pedidos" linkLabel="Ver pedidos" />
            <div className="mt-3 font-display text-[26px] font-extrabold tracking-tight text-on-surface">{data ? fmtCUP(data.salesThisWeek) : "—"}</div>
          </div>

          <div className={`${CARD} flex items-center justify-between gap-3 p-5`}>
            <div className="min-w-0">
              <div className="text-[12px] text-outline">Pedidos nuevos</div>
              <div className="font-display text-[24px] font-extrabold tracking-tight text-on-surface">{data ? data.newOrdersCount : "—"}</div>
            </div>
            <Link
              to="/vendedor/pedidos"
              className="flex-shrink-0 rounded-full bg-secondary-container px-3 py-1.5 text-[11.5px] font-bold text-on-secondary-container transition hover:brightness-95"
            >
              Atender →
            </Link>
          </div>
        </div>

        {/* Columna 2: la gráfica única de ventas (pedido explícito — "que tu
            gráfica de ventas por día y ventas por mes y ventas de los
            últimos 12 meses sea una sola con varios botones de cambio"). */}
        <SalesChartCard />
      </div>

      {/* Bloque 230 (Fase 3, pedido explícito — "score de salud de tienda
          para el vendedor (semáforo) — reutiliza completitud, cancelaciones,
          stock que ya calculas"): franja propia, no anidada dentro de otra
          tarjeta — resume 3 señales que ya viven cada una en su propia
          sección de este panel (completitud de producto abajo en
          "Productos por agotarse"/"agotados", cancelaciones, stock), así que
          amerita su propio espacio a simple vista. */}
      {data?.healthScore && (
        <div className={`${CARD} mb-5 p-6`}>
          <CardHeader
            icon={Gauge}
            tone={HEALTH_LEVEL[data.healthScore.level]?.tone}
            title="Salud de tu tienda"
            subtitle="Completitud de productos, cancelaciones y stock, en un solo número"
          />
          <div className="mt-4 flex flex-wrap items-center gap-x-8 gap-y-4">
            <div className="flex flex-shrink-0 items-center gap-3">
              <span className="h-3 w-3 flex-shrink-0 rounded-full" style={{ background: HEALTH_LEVEL[data.healthScore.level]?.dot }} />
              <span className="font-display text-[30px] font-extrabold tracking-tight text-on-surface">{data.healthScore.score}/100</span>
              <span
                className="rounded-full px-2.5 py-1 text-[11px] font-bold"
                style={{ background: HEALTH_LEVEL[data.healthScore.level]?.bg, color: HEALTH_LEVEL[data.healthScore.level]?.dot }}
              >
                {HEALTH_LEVEL[data.healthScore.level]?.label}
              </span>
            </div>
            <div className="flex flex-1 flex-wrap gap-x-8 gap-y-3 border-t border-surface-container-high/70 pt-4 sm:border-t-0 sm:border-l sm:pl-8 sm:pt-0">
              <div>
                <div className="text-[11px] text-outline">Completitud de productos</div>
                <div className="text-[15px] font-bold text-on-surface">{data.healthScore.completeness}%</div>
              </div>
              <div>
                <div className="text-[11px] text-outline">Cancelaciones (30 días)</div>
                <div className="text-[15px] font-bold text-on-surface">{data.healthScore.cancellationRate}%</div>
              </div>
              <div>
                <div className="text-[11px] text-outline">Stock saludable</div>
                <div className="text-[15px] font-bold text-on-surface">{data.healthScore.stockHealth}%</div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* ── Fila 2: tabla de pedidos (2 columnas) + métrica grande con tarjeta anidada ── */}
      <div className="mb-7 grid grid-cols-1 gap-5 lg:grid-cols-[2.3fr_1fr]">
        <div className={`${CARD} p-6`}>
          <CardHeader icon={Receipt} title="Pedidos recientes" subtitle="Lo último que entró a tu tienda" to="/vendedor/pedidos" linkLabel="Ver todos los pedidos" />
          {data?.recentOrders?.length ? (
            <div className="mt-4">
              <div className="hidden items-center gap-3 px-2 pb-2 text-[11px] font-semibold text-outline sm:flex">
                <div className="flex-1">Cliente</div>
                <div className="w-[118px]">Fecha</div>
                <div className="w-[104px]">Total</div>
                <div className="w-[96px]">Estado</div>
              </div>
              <div className="flex flex-col">
                {data.recentOrders.map((o) => {
                  const color = STATUS_COLOR[o.status] ?? "#75777c";
                  return (
                    <div key={o.id} className="flex items-center gap-3 rounded-xl px-2 py-3 transition-colors hover:bg-surface-container/60">
                      <div className="flex min-w-0 flex-1 items-center gap-3">
                        <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-surface-container text-[12.5px] font-bold text-on-surface-variant">
                          {(o.customer ?? "C")[0]?.toUpperCase()}
                        </div>
                        <div className="min-w-0">
                          <div className="truncate text-[13px] font-semibold text-on-surface">{o.customer}</div>
                          <div className="truncate text-[11px] text-outline">
                            {o.id} · {CHANNEL_LABEL[o.channel] ?? o.channel}
                          </div>
                        </div>
                      </div>
                      <div className="hidden w-[118px] text-[12px] text-on-surface-variant sm:block">
                        {new Date(o.date).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" })}
                      </div>
                      <div className="w-[104px] text-[13px] font-bold text-on-surface">{fmtCUP(o.total)}</div>
                      <div className="flex w-[96px] items-center gap-1.5 text-[12px] font-semibold" style={{ color }}>
                        <span className="h-2 w-2 flex-shrink-0 rounded-full" style={{ background: color }} />
                        <span className="truncate">{STATUS_LABEL[o.status] ?? o.status}</span>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : (
            <p className="mt-4 text-body-md text-on-surface-variant">Todavía no hay pedidos.</p>
          )}
        </div>

        {/* Una sola tarjeta en la columna derecha (no dos apiladas): así su
            alto queda parejo con la tabla de al lado y ninguna de las dos
            termina estirada con un hueco en blanco adentro. */}
        <div className={`${CARD} flex flex-col p-6`}>
          <CardHeader icon={Boxes} tone="teal" title="Productos activos" subtitle="Visibles en tu tienda" to="/vendedor/productos" linkLabel="Ver productos" />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="font-display text-[30px] font-extrabold tracking-tight text-on-surface">{data ? data.activeProducts : "—"}</div>
            {data && (
              <span className="rounded-full bg-verified/10 px-2.5 py-1 text-[11px] font-bold text-verified-dark">
                {data.maxProducts ? `de ${data.maxProducts} · Regular` : "Business · ilimitado"}
              </span>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-surface-container-high/70 pt-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <IconCircle icon={Star} tone="orange" />
              <div className="min-w-0">
                <div className="text-[12px] text-outline">Calificación</div>
                <div className="font-display text-[20px] font-extrabold leading-tight tracking-tight text-on-surface">{data ? `${data.rating.toFixed(1)} ★` : "—"}</div>
              </div>
            </div>
            <div className="flex flex-shrink-0 items-center gap-2">
              {data && (
                <span className="rounded-full bg-secondary/10 px-2.5 py-1 text-[11px] font-bold text-secondary">
                  {data.reviewCount} {data.reviewCount === 1 ? "reseña" : "reseñas"}
                </span>
              )}
              <ArrowLink to="/vendedor/resenas" label="Ver reseñas" />
            </div>
          </div>

          {/* Tarjeta anidada ("Mandatory Payments" en la referencia):
              avatares superpuestos de clientes potenciales, con el detalle
              completo (teléfono/correo) más abajo en la página. `mt-auto`
              la deja pegada al fondo de la tarjeta, como en la referencia. */}
          <div className="mt-auto pt-5">
            <div className="rounded-xl border border-surface-container-high/70 bg-surface-container-low p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-bold text-on-surface">Clientes potenciales</div>
                  <p className="text-[11px] text-outline">Últimos 30 días</p>
                </div>
                <ArrowLink hash="#clientes-potenciales" label="Ver detalle de clientes potenciales" />
              </div>
              {potential.length ? (
                <div className="mt-3 flex items-center">
                  <div className="flex -space-x-2.5">
                    {potential.slice(0, 4).map((c) => (
                      <div
                        key={c.id}
                        className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-surface-container-low bg-tertiary-accent/15 text-[13px] font-bold text-tertiary-accent"
                      >
                        {(c.fullName ?? c.email)[0]?.toUpperCase()}
                      </div>
                    ))}
                  </div>
                  {potential.length > 4 && (
                    <div className="-ml-2.5 flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full border-2 border-surface-container-low bg-secondary-container text-[12px] font-extrabold text-on-secondary-container">
                      +{potential.length - 4}
                    </div>
                  )}
                </div>
              ) : (
                <p className="mt-2 text-[12px] text-on-surface-variant">Nadie por ahora.</p>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Bloque 194: consejos diarios de IA ("consejos diarios para que los
          vendedores sean más productivos"). */}
      <div className={`mb-7 rounded-2xl border border-tertiary-accent/20 bg-gradient-to-br from-tertiary-accent/[0.07] to-transparent p-6 ${CARD_SHADOW}`}>
        <div className="mb-3.5 flex items-center gap-2.5">
          <IconCircle icon={Sparkles} tone="teal" />
          <div>
            <div className="text-[14px] font-bold text-on-surface">Consejos de hoy para tu negocio</div>
            <p className="text-[11.5px] text-outline">Generados a partir de tus propias ventas, clics y stock — se renuevan una vez al día.</p>
          </div>
        </div>
        {tipsLoading ? (
          <p className="text-body-md text-on-surface-variant">Analizando tu negocio...</p>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            {(tipsData?.tips ?? []).map((tip, i) => (
              <div key={i} className="rounded-xl bg-surface-container-lowest p-3.5 shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
                <p className="mb-1 text-[13px] font-bold text-on-surface">{tip.title}</p>
                <p className="text-[12px] leading-[17px] text-on-surface-variant">{tip.description}</p>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Bloque 194 ("el inventario en tiempo real"): la query de arriba ya
          se refresca sola (staleTime global de 5min, ver queryClient.js —
          suficiente para "en tiempo real" en el sentido de inventario, no
          hace falta un poll agresivo acá). */}
      {analytics?.inventory && (
        <div className="mb-7 grid grid-cols-2 gap-3.5 lg:grid-cols-5">
          {INVENTORY_STATS.map((s) => (
            <div key={s.key} className={`${CARD} p-4`}>
              <div className="mb-1.5 flex items-center justify-between gap-1.5">
                <div className="flex min-w-0 items-center gap-1.5">
                  <Boxes className="h-3.5 w-3.5 flex-shrink-0" style={{ color: s.color }} />
                  <span className="truncate text-[10.5px] font-bold uppercase tracking-wide text-outline">{s.label}</span>
                </div>
                {/* Bloque 230 (pedido explícito, con captura — "quiero que
                    cada uno tenga un botón de ver y al hacer clic... se
                    levante la ventana con los datos que está mostrando y
                    detalles"). */}
                <button
                  onClick={() => setOpenInventoryStat(s.key)}
                  title={`Ver detalle de ${s.label.toLowerCase()}`}
                  className="flex-shrink-0 rounded-full p-1 text-outline transition-colors hover:bg-surface-container hover:text-on-surface"
                >
                  <Eye className="h-3.5 w-3.5" />
                </button>
              </div>
              <div className="font-display text-xl font-extrabold" style={{ color: s.color }}>{s.value(analytics.inventory)}</div>
            </div>
          ))}
        </div>
      )}

      {openInventoryStat &&
        (() => {
          const stat = INVENTORY_STATS.find((s) => s.key === openInventoryStat);
          return (
            <InventoryDetailModal
              title={stat.label}
              subtitle={stat.subtitle(analytics.inventory)}
              color={stat.color}
              products={stat.products(analytics.inventory)}
              badge={stat.badge}
              onClose={() => setOpenInventoryStat(null)}
            />
          );
        })()}

      {/* Bloque 194 ("los productos más vendidos por día, por semana y por
          mes"): 1 sola lista con pestañas, en vez de 3 listas fijas una
          debajo de otra — menos scroll, mismo dato. */}
      <div className={`${CARD} p-6`}>
        <CardHeader icon={TrendingUp} tone="green" title="Productos más vendidos" to="/vendedor/productos" linkLabel="Ver productos" />
        {/* Bloque 234 (bug real reportado en vivo — "el dashboard... no
            quedó responsiva, deslizo la página de derecha a izquierda"):
            mismo bug que Bloque 225/227 ya había resuelto para el selector
            de la gráfica de Ventas, pero acá nunca se aplicó — este
            selector viajaba por el `right` de CardHeader, que es
            `flex-shrink-0` (DashboardCard.jsx), así que en pantallas
            angostas de verdad (~320-360px) no cabía ni podía encogerse, y
            en vez de acomodarse se salía del borde de la tarjeta (confirmado
            en vivo con Playwright: 273px de ancho pedido contra ~241px
            disponibles en la tarjeta a 320px de viewport). Misma solución:
            su propia fila debajo del título, en vez de compartir la fila
            del `right`. */}
        <div className="mt-3 flex gap-1 rounded-full bg-surface-container p-1 [&>button]:flex-1">
          {BEST_SELLER_TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setBestSellerTab(t.key)}
              className={`rounded-full px-3 py-1.5 text-[11.5px] font-bold transition-colors ${
                bestSellerTab === t.key ? "bg-tertiary-accent text-white shadow-sm" : "text-on-surface-variant hover:text-on-surface"
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>
        <div className="mt-3 flex flex-col">
          {bestSellers.length ? (
            bestSellers.map((p) => <MiniProductRow key={p.id} image={p.images?.[0]} name={p.name} badge={`${p.soldCount} ${p.soldCount === 1 ? "vendido" : "vendidos"}`} badgeColor="#0A8F42" />)
          ) : (
            <p className="py-2 text-body-md text-on-surface-variant">Sin ventas suficientes en este período todavía.</p>
          )}
        </div>
      </div>

      {/* Bloque 194 ("dónde los clientes hacen más clic en su tienda, dónde
          permanecen más"): mismas señales del algoritmo de Destacados
          (productRanking.js), mostradas acá tal cual. */}
      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={`${CARD} p-6`}>
          <CardHeader icon={MousePointerClick} tone="teal" title="Más clics de clientes" subtitle="Productos que más abren" />
          <div className="mt-3 flex flex-col">
            {analytics?.engagement?.topClicks?.length ? (
              analytics.engagement.topClicks.map((p) => (
                <MiniProductRow key={p.id} image={p.images?.[0]} name={p.name} badge={`${p.clickCount} clics`} badgeColor="#337475" />
              ))
            ) : (
              <p className="py-2 text-body-md text-on-surface-variant">Todavía no hay suficientes clics registrados.</p>
            )}
          </div>
        </div>

        <div className={`${CARD} p-6`}>
          <CardHeader icon={Timer} tone="teal" title="Donde más se detienen" subtitle="Tiempo promedio viendo cada producto" />
          <div className="mt-3 flex flex-col">
            {analytics?.engagement?.topDwell?.length ? (
              analytics.engagement.topDwell.map((p) => (
                <MiniProductRow key={p.id} image={p.images?.[0]} name={p.name} badge={`${p.avgDwellSeconds}s`} badgeColor="#7B4FA6" />
              ))
            ) : (
              <p className="py-2 text-body-md text-on-surface-variant">Todavía no hay suficiente actividad registrada.</p>
            )}
          </div>
        </div>
      </div>

      {/* Bloque 194 ("resumen de sus meseros que más venden") — solo
          restaurantes lo van a tener con datos reales (staffLeaderboard sale
          de ActivityLog de pedidos de mesa), pero se muestra igual con el
          estado vacío para cualquier tienda sin actividad de mesa todavía. */}
      {vendor?.isRestaurant && (
        <div className={`${CARD} mt-5 p-6`}>
          <CardHeader icon={Award} tone="orange" title="Tus meseros que más venden" subtitle="Últimas 8 semanas — pedidos de mesa que cada uno aceptó o creó" to="/vendedor/usuarios" linkLabel="Ver usuarios" />
          <div className="mt-3 flex flex-col">
            {analytics?.staffLeaderboard?.length ? (
              analytics.staffLeaderboard.map((s, i) => (
                <div key={s.userId} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-container/50">
                  <div className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-surface-container-highest text-[12px] font-extrabold text-on-surface-variant">
                    {i + 1}
                  </div>
                  <div className="flex-1">
                    <div className="text-[13px] font-semibold text-on-surface">{s.fullName}</div>
                    <div className="text-[11px] text-outline">{s.ordersHandled} {s.ordersHandled === 1 ? "pedido" : "pedidos"}</div>
                  </div>
                  <div className="flex-shrink-0 text-[13px] font-bold text-[#0A8F42]">{fmtCUP(s.totalSales)}</div>
                </div>
              ))
            ) : (
              <p className="py-2 text-body-md text-on-surface-variant">Todavía no hay pedidos de mesa aceptados por tu equipo.</p>
            )}
          </div>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
        <div className={`${CARD} p-6`}>
          <CardHeader icon={AlertTriangle} tone="orange" title="Productos por agotarse" to="/vendedor/productos" linkLabel="Ver productos" />
          <div className="mt-3 flex flex-col">
            {data?.lowStockProducts?.length ? (
              data.lowStockProducts.map((p) => <MiniProductRow key={p.id} image={p.images?.[0]} name={p.name} badge={`${p.stock} ${p.stock === 1 ? "unidad" : "unidades"}`} badgeColor="#8A5100" />)
            ) : (
              <p className="py-2 text-body-md text-on-surface-variant">Ningún producto está por agotarse.</p>
            )}
          </div>
        </div>

        <div className={`${CARD} p-6`}>
          <CardHeader icon={PackageX} title="Productos agotados" to="/vendedor/productos" linkLabel="Ver productos" />
          <div className="mt-3 flex flex-col">
            {data?.outOfStockProducts?.length ? (
              data.outOfStockProducts.map((p) => <MiniProductRow key={p.id} image={p.images?.[0]} name={p.name} badge="Sin stock" badgeColor="#ba1a1a" />)
            ) : (
              <p className="py-2 text-body-md text-on-surface-variant">Ningún producto está agotado.</p>
            )}
          </div>
        </div>

        <div id="clientes-potenciales" className={`${CARD} scroll-mt-24 p-6 lg:col-span-2`}>
          <CardHeader
            icon={Users}
            tone="teal"
            title="Clientes potenciales"
            subtitle="Visitaron tu tienda o agregaron algo al carrito en los últimos 30 días, sin completar un pedido."
          />
          <div className="mt-3 grid grid-cols-1 gap-x-6 sm:grid-cols-2">
            {potential.length ? (
              potential.map((c) => (
                <div key={c.id} className="flex items-center gap-3 rounded-xl px-2 py-2.5 transition-colors hover:bg-surface-container/50">
                  <div className="flex h-9 w-9 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/15 text-[12px] font-bold text-tertiary-accent">
                    {(c.fullName ?? c.email)[0]?.toUpperCase()}
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-on-surface">{c.fullName ?? "Cliente"}</div>
                    <div className="truncate text-[11.5px] text-outline">{c.phone ?? c.email}</div>
                  </div>
                </div>
              ))
            ) : (
              <p className="py-2 text-body-md text-on-surface-variant">No hay clientes potenciales por ahora.</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
