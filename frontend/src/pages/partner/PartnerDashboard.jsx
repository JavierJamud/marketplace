import { useQuery } from "@tanstack/react-query";
import { Activity, AlertTriangle, Clock, Copy, Gauge, Link2, Store } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { CARD, CardHeader } from "../../components/dashboard/DashboardCard.jsx";
import { WelcomeHeading } from "../../components/WelcomeSummary.jsx";

const fmt = (n) => Number(n ?? 0).toLocaleString("es-CU");

function Kpi({ icon: Icon, label, value, hint }) {
  return (
    <div className={`${CARD} flex flex-col gap-2 p-4`}>
      <span className="flex h-9 w-9 items-center justify-center rounded-full bg-tertiary-accent/10 text-tertiary-accent">
        <Icon className="h-[18px] w-[18px]" aria-hidden="true" />
      </span>
      <div>
        <div className="text-[11px] text-outline">{label}</div>
        <div className="font-display text-[22px] font-extrabold tracking-tight text-on-surface">{value}</div>
        {hint && <div className="text-[11px] text-outline">{hint}</div>}
      </div>
    </div>
  );
}

// Barras de solicitudes por día; la parte de errores va en rojo, apilada abajo.
export function DailyChart({ byDay }) {
  const max = Math.max(1, ...byDay.map((d) => d.requests));
  return (
    <div className="flex h-36 items-end gap-1" role="img" aria-label="Solicitudes por día">
      {byDay.map((d) => {
        const h = Math.max(3, Math.round((d.requests / max) * 100));
        const errorShare = d.requests ? Math.round((d.errors / d.requests) * 100) : 0;
        return (
          <div key={d.day} className="flex h-full min-w-[6px] max-w-[48px] flex-1 flex-col justify-end" title={`${d.day}: ${fmt(d.requests)} solicitudes, ${fmt(d.errors)} con error`}>
            <div className="flex w-full flex-col justify-end overflow-hidden rounded-t bg-tertiary-accent" style={{ height: `${h}%` }}>
              {errorShare > 0 && <div className="w-full bg-error" style={{ height: `${errorShare}%` }} />}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function Bar({ label, used, limit }) {
  const pct = Math.min(100, Math.round((used / Math.max(1, limit)) * 100));
  return (
    <div>
      <div className="flex justify-between text-[11.5px] text-on-surface-variant">
        <span>{label}</span>
        <span className="tabular-nums">{fmt(used)} de {fmt(limit)}</span>
      </div>
      <div className="mt-0.5 h-2 w-full overflow-hidden rounded-full bg-surface-container-high">
        <div className={`h-full ${pct > 90 ? "bg-error" : "bg-tertiary-accent"}`} style={{ width: `${Math.max(pct, used > 0 ? 2 : 0)}%` }} />
      </div>
    </div>
  );
}

export default function PartnerDashboard() {
  const { user } = useAuth();
  const { data: me } = useQuery({ queryKey: ["partner-portal-me", user?.id], queryFn: async () => (await api.get("/partner-portal/me")).data });
  const { data, isLoading } = useQuery({
    queryKey: ["partner-portal-overview", user?.id, 30],
    queryFn: async () => (await api.get("/partner-portal/overview", { params: { days: 30 } })).data,
    refetchInterval: 15000,
  });
  const usage = data?.usage;
  const keys = (data?.keys ?? []).filter((k) => k.status === "ACTIVE");

  async function copy(text) {
    try {
      await navigator.clipboard.writeText(text);
      toast.success("Enlace copiado.");
    } catch {
      toast.error("No se pudo copiar.");
    }
  }

  return (
    <div>
      <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <WelcomeHeading name={me?.partner?.name ?? "socio"} />
      </div>

      {isLoading || !usage ? (
        <p className="text-[13.5px] text-outline">Cargando tus métricas...</p>
      ) : (
        <>
          <div className="mb-5 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
            <Kpi icon={Activity} label="Solicitudes de hoy" value={fmt(usage.requestsToday)} hint={`${fmt(usage.errorsToday)} con error`} />
            <Kpi icon={Gauge} label="Últimos 30 días" value={fmt(usage.requests)} hint="solicitudes" />
            <Kpi icon={AlertTriangle} label="Errores (30 días)" value={fmt(usage.errors)} hint={`${fmt(usage.rejected)} rechazadas por límite o sitio`} />
            <Kpi icon={Clock} label="Tiempo medio" value={`${fmt(usage.avgMs)} ms`} hint="por solicitud" />
            <Kpi icon={Store} label="Tiendas por tu enlace" value={fmt(me?.partner?.stores)} hint="registradas en Baznova" />
          </div>

          <div className={`${CARD} mb-5 p-5`}>
            <CardHeader icon={Activity} tone="teal" title="Solicitudes por día" subtitle="Últimos 30 días; en rojo, las que terminaron con error" />
            <div className="mt-4">
              {usage.byDay.length ? <DailyChart byDay={usage.byDay} /> : <p className="py-6 text-center text-[13px] text-outline">Todavía no hay solicitudes. Cuando tu sitio use la API, aparecerán aquí.</p>}
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-5 lg:grid-cols-2">
            <div className={`${CARD} p-5`}>
              <CardHeader icon={Gauge} tone="teal" title="Cuota de tu credencial" subtitle="Lo que has usado ahora mismo" />
              <div className="mt-3 space-y-4">
                {keys.length === 0 && <p className="text-[13px] text-outline">No tienes una credencial activa. Pídele a Baznova que te cree una.</p>}
                {keys.map((k) => (
                  <div key={k.id}>
                    <div className="flex flex-wrap items-center justify-between gap-2 text-[13px]">
                      <span className="font-semibold text-on-surface">{k.name}</span>
                      <span className="rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-bold text-on-surface-variant">{k.kind === "SERVER" ? "Servidor" : "Navegador"}</span>
                    </div>
                    {k.live && (
                      <div className="mt-1.5 space-y-1.5">
                        <Bar label="Por minuto" used={k.live.minuteUsed} limit={k.live.minuteLimit} />
                        <Bar label="Hoy" used={k.live.dayUsed} limit={k.live.dayLimit} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>

            <div className={`${CARD} p-5`}>
              <CardHeader icon={Link2} tone="teal" title="Registra tiendas desde tu sitio" subtitle="Cada tienda que se registre con este enlace queda ligada a ti" />
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <code className="min-h-11 flex-1 break-all rounded-xl bg-surface-container px-3 py-3 text-[12.5px] text-on-surface">{me?.partner?.signupUrl}</code>
                <button onClick={() => copy(me?.partner?.signupUrl)} className="flex min-h-11 items-center gap-1.5 rounded-xl border border-outline-variant px-3 text-[13px] font-semibold text-on-surface hover:bg-surface-container">
                  <Copy className="h-4 w-4" aria-hidden="true" /> Copiar
                </button>
              </div>
              <p className="mt-3 text-[12px] text-outline">
                Dirección de la API: <code className="break-all text-on-surface">{me?.apiBase}</code>
              </p>
            </div>
          </div>

          <div className={`${CARD} p-5`}>
            <CardHeader icon={Activity} tone="teal" title="Por recurso" subtitle="Qué partes de la API usas más (30 días)" />
            <div className="mt-3 overflow-x-auto">
              <table className="w-full text-left text-[12.5px]">
                <thead>
                  <tr className="border-b border-surface-container-high text-[11px] font-bold uppercase tracking-wide text-outline">
                    <th className="px-2 py-2">Recurso</th>
                    <th className="px-2 py-2">Solicitudes</th>
                    <th className="px-2 py-2">Errores</th>
                    <th className="px-2 py-2">Tiempo medio</th>
                  </tr>
                </thead>
                <tbody>
                  {usage.byEndpoint.length === 0 && (
                    <tr>
                      <td colSpan={4} className="px-2 py-6 text-center text-outline">Sin datos todavía.</td>
                    </tr>
                  )}
                  {usage.byEndpoint.map((e) => (
                    <tr key={e.endpoint} className="border-b border-surface-container last:border-b-0">
                      <td className="px-2 py-2 font-mono text-on-surface">{e.endpoint}</td>
                      <td className="px-2 py-2 tabular-nums">{fmt(e.requests)}</td>
                      <td className={`px-2 py-2 tabular-nums ${e.errors ? "font-bold text-error" : ""}`}>{fmt(e.errors)}</td>
                      <td className="px-2 py-2 tabular-nums">{fmt(e.avgMs)} ms</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </>
      )}
    </div>
  );
}
