import { useRef, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { ImagePlus, X, Store, Users, ShoppingBag, TrendingUp, MapPin, Activity, ShieldCheck, Lightbulb, CalendarDays, BarChart3, ArrowUpRight } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { api } from "../../lib/api.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { CARD, CARD_SHADOW, IconCircle, ArrowLink, CardHeader } from "../../components/dashboard/DashboardCard.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
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

const PERIOD_SERIES = [
  { key: "pedidos", name: "Pedidos", color: "#337475" },
  { key: "tiendas", name: "Tiendas nuevas", color: "#fe9800" },
];

function PeriodTooltip({ active, payload, label }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] px-3 py-2">
      <p className="mb-1 text-[11px] font-semibold text-outline">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} className="text-[12.5px] font-bold" style={{ color: p.color }}>
          {p.name}: {p.value}
        </p>
      ))}
    </div>
  );
}

// Bloque 221 (pedido explícito, con imagen de referencia de un dashboard
// fintech — "rediseña los paneles de vendedores y de admin... fíjate en
// cada detalle", manteniendo la paleta propia del sitio, no la verde de
// la imagen): misma composición que VendorDashboard.jsx — fila hero de 3
// columnas (métrica chica / tarjeta navy de plataforma / métrica chica con
// pill · gráfica de barras · métrica grande con lista y accesos directos)
// y debajo la actividad como tabla + columna con métrica grande y tarjeta
// anidada. Todo lo que ya existía (métricas, actividad, provincias,
// verificaciones, sugerencias, imágenes del hero) sigue acá, solo cambia
// dónde y cómo se ve.
export default function AdminDashboard() {
  const queryClient = useQueryClient();
  const { user } = useAuth();
  const fileRef = useRef(null);
  // Bloque 96 (pedido explícito): 1 imagen fija -> varias, mostradas en un
  // slider en la Home. removeTarget guarda la URL relativa pendiente de
  // confirmar borrado — mismo patrón de "Sí, eliminar" que la galería de
  // fotos de producto (VendorProducts.jsx).
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
    e.target.value = ""; // permite volver a elegir el mismo archivo si hace falta
  }

  const heroImages = settings?.heroImages ?? [];
  const siteName = settings?.siteName || "Baznova";
  const firstName = user?.fullName?.split(" ")[0] || "Admin";
  const rawMonth = new Date().toLocaleDateString("es-CU", { month: "long", year: "numeric" });
  const monthLabel = rawMonth.charAt(0).toUpperCase() + rawMonth.slice(1);
  const pending = data?.pendingVerifications ?? 0;
  const suggestionsCount = newSuggestions?.length ?? 0;

  const periodData = data
    ? [
        { label: "Últimas 24h", pedidos: data.ordersByPeriod.day, tiendas: data.newVendorsByPeriod.day },
        { label: "7 días", pedidos: data.ordersByPeriod.week, tiendas: data.newVendorsByPeriod.week },
        { label: "30 días", pedidos: data.ordersByPeriod.month, tiendas: data.newVendorsByPeriod.month },
      ]
    : [];

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

      {/* ── Fila hero (3 columnas) ── */}
      <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-[1fr_1.3fr_1fr]">
        <div className="flex flex-col gap-4">
          <div className={`${CARD} p-5`}>
            <CardHeader icon={Store} tone="teal" title="Tiendas activas" subtitle="Con al menos un pedido" to="/admin/tiendas" linkLabel="Ver tiendas" />
            <div className="mt-3 font-display text-[26px] font-extrabold tracking-tight text-on-surface">{data ? data.metrics.activeVendors : "—"}</div>
          </div>

          {/* Tarjeta navy de plataforma — misma "tarjeta de crédito" de la
              referencia: marca arriba a la izquierda, chip naranja de marca
              y el ingreso estimado por suscripciones como monto principal. */}
          <Link
            to="/admin/suscripciones"
            className="relative flex flex-1 flex-col justify-between overflow-hidden rounded-2xl bg-gradient-to-br from-primary to-primary-container p-5 text-white shadow-[0_14px_30px_-10px_rgba(14,26,40,0.6)] transition-transform hover:-translate-y-0.5"
          >
            <div className="pointer-events-none absolute -right-10 -top-12 h-36 w-36 rounded-full bg-white/[0.06]" />
            <div className="pointer-events-none absolute -bottom-12 left-1/3 h-32 w-32 rounded-full bg-white/[0.05]" />
            <div className="relative flex items-center justify-between">
              <span className="font-display text-[15px] font-extrabold italic tracking-tight">{siteName}</span>
              <span className="rounded-full bg-white/15 px-2 py-0.5 text-[10.5px] font-bold tracking-wide">ADMIN</span>
            </div>
            <div className="relative mt-5">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.12em] text-white/60">Ingresos por suscripción · estimado</div>
              <div className="mt-1 truncate font-display text-[22px] font-extrabold tracking-tight">{data ? fmtCUP(data.metrics.subscriptionRevenueEstimate) : "—"}</div>
            </div>
            <div className="relative mt-5 flex items-end justify-between">
              <div className="h-6 w-8 rounded-[4px] bg-gradient-to-br from-secondary-container to-secondary" />
              <div className="text-right text-[11px] font-semibold text-white/75">{data ? `${data.metrics.businessVendors} tiendas Business` : ""}</div>
            </div>
          </Link>

          <div className={`${CARD} flex items-center justify-between gap-3 p-5`}>
            <div className="min-w-0">
              <div className="text-[12px] text-outline">Verificaciones KYC pendientes</div>
              <div className="font-display text-[24px] font-extrabold tracking-tight text-on-surface">{data ? pending : "—"}</div>
            </div>
            <Link
              to="/admin/verificaciones"
              className="flex-shrink-0 rounded-full bg-secondary-container px-3 py-1.5 text-[11.5px] font-bold text-on-secondary-container transition hover:brightness-95"
            >
              Revisar →
            </Link>
          </div>
        </div>

        <div className={`${CARD} flex flex-col p-6`}>
          <CardHeader icon={BarChart3} title="Pedidos por período" subtitle="Junto a las tiendas nuevas" to="/admin/actividad" linkLabel="Ver actividad" />
          <div className="mt-3 flex items-center gap-3">
            {PERIOD_SERIES.map((s) => (
              <span key={s.key} className="flex items-center gap-1.5 text-[11px] font-semibold text-on-surface-variant">
                <span className="h-2.5 w-2.5 rounded-full" style={{ background: s.color }} />
                {s.name}
              </span>
            ))}
          </div>
          <div className="mt-1 min-h-[240px] flex-1">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={periodData} margin={{ top: 16, right: 4, left: -8, bottom: 0 }} barGap={6}>
                <CartesianGrid strokeDasharray="4 4" vertical={false} stroke="#e8e5e6" />
                <XAxis dataKey="label" tick={{ fontSize: 11, fill: "#75777c" }} axisLine={false} tickLine={false} />
                <YAxis tick={{ fontSize: 10, fill: "#75777c" }} axisLine={false} tickLine={false} width={44} allowDecimals={false} />
                <Tooltip content={<PeriodTooltip />} cursor={{ fill: "rgba(0,0,0,0.03)" }} />
                {PERIOD_SERIES.map((s) => (
                  <Bar key={s.key} dataKey={s.key} name={s.name} fill={s.color} radius={[9, 9, 9, 9]} maxBarSize={34} />
                ))}
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className={`${CARD} flex flex-col p-6`}>
          <CardHeader icon={Users} tone="teal" title="Clientes registrados" subtitle="En toda la plataforma" to="/admin/clientes" linkLabel="Ver clientes" />
          <div className="mt-4 text-center">
            <div className="text-[12px] text-outline">Total</div>
            <div className="font-display text-[28px] font-extrabold tracking-tight text-on-surface">{data ? data.metrics.totalCustomers : "—"}</div>
          </div>
          <div className="mt-4 flex flex-1 flex-col">
            <div className="mb-2 flex items-center gap-1.5 text-[11.5px] font-semibold text-on-surface-variant">
              <MapPin className="h-3.5 w-3.5 text-secondary" /> Tiendas por provincia
            </div>
            <div className="flex flex-1 flex-col justify-around gap-2">
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
          <div className="mt-4 flex gap-2">
            <Link
              to="/admin/clientes"
              className="flex flex-1 items-center justify-center gap-1 rounded-full bg-primary px-3 py-2.5 text-[12.5px] font-bold text-white transition-transform hover:-translate-y-0.5"
            >
              Clientes <ArrowUpRight className="h-3.5 w-3.5" />
            </Link>
            <Link
              to="/admin/tiendas"
              className="flex flex-1 items-center justify-center rounded-full border border-outline-variant px-3 py-2.5 text-[12.5px] font-bold text-on-surface-variant transition-colors hover:bg-surface-container/50"
            >
              Tiendas
            </Link>
          </div>
        </div>
      </div>

      {/* ── Fila 2: actividad (2 columnas) + sugerencias con tarjeta anidada ── */}
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

        <div className={`${CARD} flex flex-col p-6`}>
          <CardHeader icon={Lightbulb} tone="orange" title="Sugerencias nuevas" subtitle="Enviadas por vendedores y clientes" to="/admin/sugerencias" linkLabel="Ver sugerencias" />
          <div className="mt-4 flex flex-wrap items-center gap-3">
            <div className="font-display text-[30px] font-extrabold tracking-tight text-on-surface">{newSuggestions ? suggestionsCount : "—"}</div>
            {newSuggestions && (
              <span className="rounded-full bg-secondary/10 px-2.5 py-1 text-[11px] font-bold text-secondary">
                {suggestionsCount === 1 ? "sin revisar" : "sin revisar aún"}
              </span>
            )}
          </div>

          <div className="mt-5 flex items-center justify-between gap-3 border-t border-surface-container-high/70 pt-4">
            <div className="flex min-w-0 items-center gap-2.5">
              <IconCircle icon={ShoppingBag} tone="blue" />
              <div className="min-w-0">
                <div className="text-[12px] text-outline">Pedidos (mes)</div>
                <div className="font-display text-[20px] font-extrabold leading-tight tracking-tight text-on-surface">{data ? data.metrics.ordersThisMonth : "—"}</div>
              </div>
            </div>
            <ArrowLink to="/admin/actividad" label="Ver actividad" />
          </div>

          <div className="mt-auto pt-5">
            <div className="rounded-xl border border-surface-container-high/70 bg-surface-container-low p-4">
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="text-[13px] font-bold text-on-surface">Tiendas: activas vs inactivas</div>
                  <p className="text-[11px] text-outline">Activa = recibió al menos un pedido alguna vez</p>
                </div>
                <ArrowLink to="/admin/tiendas" label="Ver tiendas" />
              </div>
              <div className="mt-3 flex items-center gap-5">
                <div>
                  <div className="font-display text-[22px] font-extrabold leading-tight text-verified-dark">{data ? data.vendorActivity.active : "—"}</div>
                  <div className="text-[11px] text-outline">Activas</div>
                </div>
                <div>
                  <div className="font-display text-[22px] font-extrabold leading-tight text-outline">{data ? data.vendorActivity.inactive : "—"}</div>
                  <div className="text-[11px] text-outline">Sin pedidos aún</div>
                </div>
              </div>
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
        {/* Bloque 91 (pedido explícito): tamaño recomendado calculado a partir
            del recuadro real del hero en Home.jsx (columna de la imagen del
            grid del hero, ~578×400px en pantallas de escritorio, relación
            ~3:2) — la imagen se ajusta sola al contenedor con object-contain
            (Bloque 94: nunca se recorta ni se deforma), pero subir algo con
            esta misma relación de aspecto evita dejar franjas vacías a los
            costados. Se pide al doble de resolución del recuadro para que se
            vea nítida en pantallas de alta densidad (retina). */}
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
