import { useQuery } from "@tanstack/react-query";
import { Globe, KeyRound, Server } from "lucide-react";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { CARD, IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Bar } from "./PartnerDashboard.jsx";

const fmtDate = (d) => (d ? new Date(d).toLocaleString("es-CU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Nunca");

// Bloque 299: llaves del socio, solo lectura. El valor secreto de una llave no se puede volver a ver (solo
// se muestra una vez, cuando Baznova la crea): aquí se ve su prefijo, sus permisos, desde dónde puede usarse
// y cuánto lleva usado.
export default function PartnerKeys() {
  const { user } = useAuth();
  const { data: me } = useQuery({ queryKey: ["partner-portal-me", user?.id], queryFn: async () => (await api.get("/partner-portal/me")).data });
  const { data, isLoading } = useQuery({
    queryKey: ["partner-portal-overview", user?.id, 30],
    queryFn: async () => (await api.get("/partner-portal/overview", { params: { days: 30 } })).data,
    refetchInterval: 15000,
  });
  const keys = data?.keys ?? [];
  const scopeLabel = Object.fromEntries((me?.scopes ?? []).map((s) => [s.id, s.label]));

  return (
    <div className="max-w-[980px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={KeyRound} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Llaves y cuotas</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">Tus llaves de la API. Si necesitas una nueva, cambiar sus permisos o sus sitios autorizados, pídeselo a Baznova.</p>

      {isLoading && <p className="text-[13.5px] text-outline">Cargando...</p>}
      {!isLoading && keys.length === 0 && <div className={`${CARD} p-6 text-[13.5px] text-outline`}>Todavía no tienes llaves. Baznova te las creará cuando tu sitio esté listo.</div>}

      <div className="space-y-4">
        {keys.map((k) => (
          <section key={k.id} className={`${CARD} p-5`}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10 text-tertiary-accent">
                  {k.kind === "SERVER" ? <Server className="h-[18px] w-[18px]" aria-hidden="true" /> : <Globe className="h-[18px] w-[18px]" aria-hidden="true" />}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-bold text-on-surface">{k.name}</div>
                  <div className="font-mono text-[12px] text-outline">{k.prefix}…</div>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${k.status === "ACTIVE" ? "bg-[#0CAE53]/15 text-[#087A38]" : "bg-error/10 text-error"}`}>{k.status === "ACTIVE" ? "Activa" : "Revocada"}</span>
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-[11.5px] text-on-surface-variant">Tipo</dt>
                <dd className="font-semibold text-on-surface">{k.kind === "SERVER" ? "Servidor (llave secreta, por IP)" : "Navegador (llave pública, por dominio)"}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-on-surface-variant">Último uso</dt>
                <dd className="font-semibold text-on-surface">{fmtDate(k.lastUsedAt)}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-on-surface-variant">{k.kind === "SERVER" ? "Direcciones IP autorizadas" : "Sitios autorizados"}</dt>
                <dd className="break-words font-semibold text-on-surface">{(k.kind === "SERVER" ? k.allowedIps : [...k.allowedDomains, ...k.allowedIps]).join(", ") || "Ninguno"}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-on-surface-variant">Vence</dt>
                <dd className="font-semibold text-on-surface">{k.expiresAt ? fmtDate(k.expiresAt) : "No vence"}</dd>
              </div>
              <div className="sm:col-span-2">
                <dt className="mb-1 text-[11.5px] text-on-surface-variant">Permisos</dt>
                <dd className="flex flex-wrap gap-1.5">
                  {k.scopes.map((s) => (
                    <span key={s} className="rounded-full bg-surface-container px-2.5 py-0.5 text-[11.5px] font-semibold text-on-surface-variant">{scopeLabel[s] ?? s}</span>
                  ))}
                </dd>
              </div>
            </dl>

            {k.live && (
              <div className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Bar label="Por minuto" used={k.live.minuteUsed} limit={k.live.minuteLimit} />
                <Bar label="Hoy" used={k.live.dayUsed} limit={k.live.dayLimit} />
              </div>
            )}
          </section>
        ))}
      </div>
    </div>
  );
}
