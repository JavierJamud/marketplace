import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Activity, GraduationCap, Gift, Sparkles, RefreshCw, Mail } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { timeAgo, exactDateTime } from "../../lib/relativeTime.js";
import { CARD } from "../dashboard/DashboardCard.jsx";
import { ListSkeleton } from "../ui/Skeleton.jsx";

// Actividad y uso del panel de las tiendas (lo registran lib/usePanelUsage.js y backend lib/vendorUsage.js):
//  - VendorUsageSection: en la ficha de una tienda. Qué secciones usa más, cuáles no usa (dónde capacitarla), los pasos que
//    dio y un análisis con IA de qué enseñarle y qué herramientas ofrecerle.
//  - UsageOverview: lo mismo para todas las tiendas juntas, en Actividad.

const PERIODS = [7, 30, 90];
const ROLE_LABEL = { VENDOR: "Dueño", VENDOR_STAFF: "Equipo", ADMIN: "Admin", CUSTOMER: "Cliente" };
const WHO_FILTERS = [
  { id: "all", label: "Todo" },
  { id: "VENDOR", label: "Dueño" },
  { id: "VENDOR_STAFF", label: "Equipo" },
  { id: "ADMIN", label: "Admin" },
];

function PeriodPicker({ value, onChange }) {
  return (
    <div role="group" aria-label="Periodo" className="flex gap-1 rounded-full bg-surface-container p-1">
      {PERIODS.map((d) => (
        <button
          key={d}
          type="button"
          aria-pressed={value === d}
          onClick={() => onChange(d)}
          className={`min-h-9 rounded-full px-3 text-[12.5px] font-bold ${value === d ? "bg-surface-container-lowest text-on-surface shadow-sm" : "text-on-surface-variant"}`}
        >
          {d} días
        </button>
      ))}
    </div>
  );
}

function Kpi({ label, value }) {
  return (
    <div className="rounded-xl bg-surface-container-low px-3 py-2.5">
      <p className="text-[11.5px] font-semibold text-on-surface-variant">{label}</p>
      <p className="font-display text-[20px] font-extrabold text-on-surface">{value}</p>
    </div>
  );
}

// Barras de uso por sección: el largo es el peso relativo (minutos + acciones), el texto da los números reales.
function SectionBars({ sections, showStores }) {
  if (!sections.length) return <p className="text-[13px] text-on-surface-variant">Todavía no hay uso registrado en este periodo.</p>;
  const score = (s) => s.minutes + s.actions * 2 + s.views;
  const max = Math.max(...sections.map(score), 1);
  return (
    <ul className="space-y-2.5">
      {sections.map((s) => (
        <li key={s.section}>
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-x-3 text-[13px]">
            <span className="font-semibold text-on-surface">{s.label}</span>
            <span className="text-[12px] text-on-surface-variant">
              {s.minutes} min · {s.views} {s.views === 1 ? "visita" : "visitas"} · {s.actions} {s.actions === 1 ? "acción" : "acciones"}
              {showStores ? ` · ${s.stores} ${s.stores === 1 ? "tienda" : "tiendas"}` : ` · ${s.activeDays} ${s.activeDays === 1 ? "día" : "días"}`}
            </span>
          </div>
          <div className="h-2 overflow-hidden rounded-full bg-surface-container" aria-hidden="true">
            <div className="h-full rounded-full bg-tertiary-accent" style={{ width: `${Math.max(4, (score(s) / max) * 100)}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

function InsightCard({ insight, onRun, running, error, scopeLabel }) {
  return (
    <div className="rounded-2xl border border-tertiary-accent/25 bg-tertiary-accent/[0.05] p-4">
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-bold text-on-surface">
          <Sparkles className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Análisis con IA
        </h3>
        <button
          type="button"
          onClick={onRun}
          disabled={running}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full bg-primary px-4 text-[12.5px] font-bold text-on-primary disabled:opacity-60"
        >
          <RefreshCw className={`h-3.5 w-3.5 ${running ? "animate-spin" : ""}`} aria-hidden="true" />
          {running ? "Analizando..." : insight ? "Volver a analizar" : "Analizar"}
        </button>
      </div>
      {error && <p className="mb-2 text-[12.5px] font-semibold text-error">{error}</p>}
      {!insight ? (
        <p className="text-[13px] text-on-surface-variant">
          La IA lee el uso de los últimos 30 días {scopeLabel} y dice qué se usa más, en qué conviene capacitar y qué herramientas ofrecer.
        </p>
      ) : (
        <div className="space-y-3 text-[13px] text-on-surface">
          {insight.resumen && <p>{insight.resumen}</p>}
          {insight.capacitar?.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-on-surface-variant">
                <GraduationCap className="h-3.5 w-3.5" aria-hidden="true" /> Dónde capacitar
              </p>
              <ul className="space-y-1">
                {insight.capacitar.map((c) => (
                  <li key={c.section}>
                    <strong>{c.label}:</strong> {c.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {insight.ofrecer?.length > 0 && (
            <div>
              <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold uppercase tracking-wide text-on-surface-variant">
                <Gift className="h-3.5 w-3.5" aria-hidden="true" /> Qué ofrecer
              </p>
              <ul className="space-y-1">
                {insight.ofrecer.map((o) => (
                  <li key={o.tool}>
                    <strong>{o.label}:</strong> {o.motivo}
                  </li>
                ))}
              </ul>
            </div>
          )}
          <p className="text-[11.5px] text-outline">Hecho {timeAgo(insight.updatedAt).toLowerCase()}</p>
        </div>
      )}
    </div>
  );
}

// Resumen semanal que recibe la tienda por correo cada viernes a las 00:00 (hora de Cuba), escrito para el vendedor. Aquí se
// ve el último enviado y se puede mandar ahora (backend: jobs/weeklyVendorSummary.job.js).
function WeeklySummaryCard({ vendorId }) {
  const queryClient = useQueryClient();
  const queryKey = ["admin-vendor-weekly-summary", vendorId];
  const { data } = useQuery({ queryKey, queryFn: async () => (await api.get(`/admin/vendors/${vendorId}/weekly-summary`)).data.summary });
  const send = useMutation({
    mutationFn: async () => (await api.post(`/admin/vendors/${vendorId}/weekly-summary`)).data,
    onSuccess: (d) => {
      toast.success("Resumen enviado", `Le llegó a ${d.to}.`);
      queryClient.invalidateQueries({ queryKey });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el resumen."),
  });
  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
      <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
        <h3 className="flex items-center gap-2 text-[14px] font-bold text-on-surface">
          <Mail className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Resumen semanal para la tienda
        </h3>
        <button
          type="button"
          onClick={() => send.mutate()}
          disabled={send.isPending}
          className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-outline-variant px-4 text-[12.5px] font-bold text-on-surface hover:bg-surface-container disabled:opacity-60"
        >
          {send.isPending ? "Enviando..." : "Enviar ahora"}
        </button>
      </div>
      <p className="text-[12.5px] text-on-surface-variant">
        La tienda lo recibe sola cada viernes a las 00:00, hora de Cuba: los números de su semana y qué puede mejorar, escrito por la IA para el vendedor.
      </p>
      {data && (
        <p className="mt-2 text-[12px] text-outline" title={exactDateTime(data.updatedAt)}>
          Último envío {timeAgo(data.updatedAt).toLowerCase()} a {data.to}
          {data.stats ? ` · ${data.stats.orders} ${data.stats.orders === 1 ? "pedido" : "pedidos"} en esa semana` : ""}
        </p>
      )}
    </div>
  );
}

function useInsight(url, queryKey) {
  const queryClient = useQueryClient();
  const [error, setError] = useState(null);
  const run = useMutation({
    mutationFn: async () => (await api.post(url)).data.insight,
    onMutate: () => setError(null),
    onSuccess: () => queryClient.invalidateQueries({ queryKey }),
    onError: (err) => {
      const msg = err.response?.data?.error ?? "No se pudo hacer el análisis.";
      setError(msg);
      toast.error(msg);
    },
  });
  return { run, error };
}

export function VendorUsageSection({ vendorId }) {
  const [days, setDays] = useState(30);
  const [who, setWho] = useState("all");
  const queryKey = ["admin-vendor-usage", vendorId];
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKey, days],
    queryFn: async () => (await api.get(`/admin/vendors/${vendorId}/usage`, { params: { days } })).data,
  });
  const { run, error } = useInsight(`/admin/vendors/${vendorId}/usage/insights`, queryKey);
  const timeline = (data?.timeline ?? []).filter((t) => who === "all" || t.actorRole === who);

  return (
    <section className={`${CARD} p-4 sm:p-5`} aria-labelledby="usage-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="usage-title" className="flex items-center gap-2 text-[14.5px] font-bold text-on-surface">
          <Activity className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Actividad y uso del panel
        </h2>
        <PeriodPicker value={days} onChange={setDays} />
      </div>

      {isLoading && <ListSkeleton />}
      {isError && (
        <p className="text-[13px] text-error">
          No se pudo cargar el uso.{" "}
          <button type="button" className="min-h-11 font-semibold underline" onClick={() => refetch()}>
            Reintentar
          </button>
        </p>
      )}
      {data && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              <Kpi label="Minutos activos" value={data.totals.minutes} />
              <Kpi label="Acciones" value={data.totals.actions} />
              <Kpi label="Días con uso" value={data.activeDays} />
              <Kpi label="Secciones usadas" value={data.sections.length} />
            </div>
            <div>
              <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-on-surface-variant">Lo que más usa</h3>
              <SectionBars sections={data.sections} />
            </div>
            {data.unused.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-on-surface-variant">No lo usa (dónde ayudarla)</h3>
                <div className="flex flex-wrap gap-1.5">
                  {data.unused.map((u) => (
                    <span key={u.section} className="rounded-full bg-secondary-container/40 px-2.5 py-1 text-[12px] font-semibold text-on-surface">
                      {u.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
            <InsightCard insight={data.insight} onRun={() => run.mutate()} running={run.isPending} error={error} scopeLabel="de esta tienda" />
            <WeeklySummaryCard vendorId={vendorId} />
          </div>

          <div className="min-w-0">
            <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
              <h3 className="text-[12px] font-bold uppercase tracking-wide text-on-surface-variant">Pasos que dio</h3>
              <div role="group" aria-label="Quién lo hizo" className="flex flex-wrap gap-1">
                {WHO_FILTERS.map((f) => (
                  <button
                    key={f.id}
                    type="button"
                    aria-pressed={who === f.id}
                    onClick={() => setWho(f.id)}
                    className={`min-h-9 rounded-full border px-2.5 text-[12px] font-semibold ${who === f.id ? "border-tertiary-accent bg-tertiary-accent text-white" : "border-surface-container-high text-on-surface-variant"}`}
                  >
                    {f.label}
                  </button>
                ))}
              </div>
            </div>
            {timeline.length === 0 ? (
              <p className="text-[13px] text-on-surface-variant">Sin pasos registrados{who === "all" ? "" : " de este tipo"}.</p>
            ) : (
              <ol className="max-h-[520px] space-y-0 overflow-y-auto border-l-2 border-surface-container-high pl-4">
                {timeline.map((t) => (
                  <li key={t.id} className="relative py-2">
                    <span className="absolute -left-[21px] top-3 h-2.5 w-2.5 rounded-full bg-tertiary-accent" aria-hidden="true" />
                    <p className="text-[13px] text-on-surface">{t.description}</p>
                    <p className="text-[11.5px] text-outline" title={exactDateTime(t.createdAt)}>
                      {t.actor?.fullName ?? ROLE_LABEL[t.actorRole] ?? ""} · {ROLE_LABEL[t.actorRole] ?? ""} · {timeAgo(t.createdAt)}
                    </p>
                  </li>
                ))}
              </ol>
            )}
          </div>
        </div>
      )}
    </section>
  );
}

export function UsageOverview() {
  const [days, setDays] = useState(30);
  const queryKey = ["admin-usage-overview"];
  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: [...queryKey, days],
    queryFn: async () => (await api.get("/admin/usage/overview", { params: { days } })).data,
  });
  const { run, error } = useInsight("/admin/usage/insights", queryKey);

  return (
    <section className={`${CARD} mb-5 p-4 sm:p-5`} aria-labelledby="usage-overview-title">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 id="usage-overview-title" className="flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <Activity className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Uso del panel de las tiendas
        </h2>
        <PeriodPicker value={days} onChange={setDays} />
      </div>
      {isLoading && <ListSkeleton />}
      {isError && (
        <p className="text-[13px] text-error">
          No se pudo cargar el uso.{" "}
          <button type="button" className="min-h-11 font-semibold underline" onClick={() => refetch()}>
            Reintentar
          </button>
        </p>
      )}
      {data && (
        <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
          <div className="min-w-0 space-y-4">
            <div className="grid grid-cols-3 gap-2">
              <Kpi label="Tiendas" value={data.stores.length} />
              <Kpi label="Usaron el panel" value={data.stores.length - data.inactive} />
              <Kpi label="Sin uso" value={data.inactive} />
            </div>
            <div>
              <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-on-surface-variant">Secciones más usadas</h3>
              <SectionBars sections={data.sections} showStores />
            </div>
            {data.unusedEverywhere.length > 0 && (
              <div>
                <h3 className="mb-1.5 text-[12px] font-bold uppercase tracking-wide text-on-surface-variant">Ninguna tienda las usó</h3>
                <div className="flex flex-wrap gap-1.5">
                  {data.unusedEverywhere.map((u) => (
                    <span key={u.section} className="rounded-full bg-secondary-container/40 px-2.5 py-1 text-[12px] font-semibold text-on-surface">
                      {u.label}
                    </span>
                  ))}
                </div>
              </div>
            )}
          </div>
          <div className="min-w-0 space-y-4">
            <InsightCard insight={data.insight} onRun={() => run.mutate()} running={run.isPending} error={error} scopeLabel="de todas las tiendas" />
            <div>
              <h3 className="mb-2 text-[12px] font-bold uppercase tracking-wide text-on-surface-variant">Tiendas por uso</h3>
              <ul className="max-h-[320px] divide-y divide-surface-container-high overflow-y-auto">
                {data.stores.map((s) => (
                  <li key={s.id}>
                    <Link to={`/admin/tiendas/${s.id}`} className="flex min-h-11 items-center justify-between gap-3 py-2 hover:bg-surface-container/40">
                      <span className="truncate text-[13px] font-semibold text-on-surface">{s.companyName}</span>
                      <span className="flex-shrink-0 text-[12px] text-on-surface-variant">
                        {s.activeDays ? `${s.minutes} min · ${s.actions} acciones · ${s.activeDays} días` : "sin uso"}
                      </span>
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </div>
      )}
      <p className="mt-3 text-[11.5px] text-outline">El uso por sección se registra desde la versión 26.0.83: los días anteriores no tienen datos.</p>
    </section>
  );
}
