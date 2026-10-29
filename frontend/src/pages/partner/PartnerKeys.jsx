import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, Copy, Globe, KeyRound } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { copyToClipboard } from "../../lib/clipboard.js";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { CARD, IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Bar } from "./PartnerDashboard.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";

// Error de carga con Reintentar: sin esto, una consulta fallida dejaba la tarjeta vacía o el esqueleto para siempre.
function LoadError({ title, error, onRetry, busy }) {
  return (
    <div role="alert">
      <div className="flex items-start gap-3">
        <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-error" aria-hidden="true" />
        <div className="min-w-0">
          <p className="text-[14px] font-bold text-on-surface">{title}</p>
          <p className="mt-1 text-[13px] text-on-surface-variant">{error?.response?.data?.error ?? "Revisa tu conexión e inténtalo de nuevo."}</p>
        </div>
      </div>
      <button
        type="button"
        onClick={onRetry}
        disabled={busy}
        className="mt-4 flex min-h-11 items-center gap-1.5 rounded-xl border border-outline-variant px-4 text-[13px] font-semibold text-on-surface hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-60"
      >
        {busy ? "Cargando..." : "Reintentar"}
      </button>
    </div>
  );
}

// Tu credencial, siempre visible: no se oculta ni se muestra una sola vez. Solo el equipo de la plataforma puede regenerarla.
// Es el único lugar de esta página que explica el caso "sin credencial": la lista de abajo no repite el aviso.
// El backend responde reason "none" tanto si nunca hubo credencial como si todas están revocadas (solo busca una ACTIVE),
// así que la lista de llaves (hasRevoked) decide qué decir. Mientras esa lista carga (keysLoading) no se dice nada,
// para no mostrar "todavía no tienes credencial" y cambiarlo un instante después.
function ApiKeyCard({ hasRevoked, keysLoading }) {
  const { user } = useAuth();
  const { siteName } = usePlatformSettings();
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({ queryKey: ["partner-portal-api-key", user?.id], queryFn: async () => (await api.get("/partner-portal/api-key")).data });
  const copy = async (text, ok) => ((await copyToClipboard(text)) ? toast.success(ok) : toast.error("No se pudo copiar."));
  return (
    <section className={`${CARD} mb-5 p-5`} aria-labelledby="cred-title">
      <h2 id="cred-title" className="mb-1 text-[15px] font-bold text-on-surface">Tu credencial de la API</h2>
      <p className="mb-3 text-[12.5px] text-outline">Es la única que necesitas: productos, tiendas, carrito, pedidos y planes. Envíala en cada solicitud con <code>Authorization: Bearer</code>. Si se filtra, avisa a {siteName}: solo el equipo puede regenerarla.</p>
      {isLoading && <ListSkeleton />}
      {!data && isError && <LoadError title="No se pudo cargar tu credencial" error={error} onRetry={() => refetch()} busy={isFetching} />}
      {data && !data.apiKey && (data.reason === "legacy" || !keysLoading) && (
        <p className="text-[13px] text-on-surface-variant">
          {data.reason === "legacy"
            ? `Esta credencial se creó antes de poder verse aquí. Pídele a ${siteName} que la regenere y te llegará la nueva por correo.`
            : hasRevoked
              ? `Tu credencial fue revocada. Pídele a ${siteName} una nueva.`
              : `Todavía no tienes credencial. ${siteName} te la creará cuando apruebe tu solicitud.`}
        </p>
      )}
      {data?.apiKey && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <code className="min-h-11 flex-1 break-all rounded-xl bg-surface-container px-3 py-3 text-[12.5px] text-on-surface" data-testid="partner-api-key">{data.apiKey}</code>
            <button onClick={() => copy(data.apiKey, "Credencial copiada.")} className="flex min-h-11 items-center gap-1.5 rounded-xl border border-outline-variant px-3 text-[13px] font-semibold text-on-surface hover:bg-surface-container">
              <Copy className="h-4 w-4" aria-hidden="true" /> Copiar
            </button>
          </div>
          <p className="mt-3 text-[12px] text-outline">Dirección de la API: <code className="break-all text-on-surface">{data.apiBase}</code></p>
        </>
      )}
    </section>
  );
}

const fmtDate = (d) => (d ? new Date(d).toLocaleString("es-CU", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" }) : "Nunca");

// Bloque 299: llaves del socio, solo lectura. El valor completo de la credencial activa se ve y se copia en la
// tarjeta de arriba (ApiKeyCard); aquí, por cada llave, se ve su prefijo, sus permisos, desde dónde puede usarse
// y cuánto lleva usado.
export default function PartnerKeys() {
  const { user } = useAuth();
  const { siteName } = usePlatformSettings();
  const { data: me } = useQuery({ queryKey: ["partner-portal-me", user?.id], queryFn: async () => (await api.get("/partner-portal/me")).data });
  const { data, isLoading, isError, error, refetch, isFetching } = useQuery({
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
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Credencial y cuotas</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">Tienes una sola credencial para toda la API: productos, carrito, pedidos y planes. Regenerarla o cambiar sus sitios autorizados solo lo hace {siteName}.</p>

      <ApiKeyCard hasRevoked={keys.some((k) => k.status === "REVOKED")} keysLoading={isLoading} />

      {/* Sin llaves no se muestra nada aquí: ApiKeyCard ya dice que todavía no hay credencial (antes salían dos avisos). */}
      {isLoading && <ListSkeleton />}
      {!data && isError && (
        <div className={`${CARD} p-5`}>
          <LoadError title="No se pudieron cargar tus permisos y cuotas" error={error} onRetry={() => refetch()} busy={isFetching} />
        </div>
      )}

      <div className="space-y-4">
        {keys.map((k) => (
          <section key={k.id} className={`${CARD} p-5`}>
            <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10 text-tertiary-accent">
                  <Globe className="h-[18px] w-[18px]" aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <div className="truncate text-[15px] font-bold text-on-surface">{k.name}</div>
                  <div className="font-mono text-[12px] text-outline">{k.prefix}…</div>
                </div>
              </div>
              <span className={`rounded-full px-2.5 py-0.5 text-[11px] font-bold ${k.status === "ACTIVE" ? "bg-verified/15 text-verified-dark" : "bg-error/10 text-error"}`}>{k.status === "ACTIVE" ? "Activa" : "Revocada"}</span>
            </div>

            <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[13px] sm:grid-cols-2">
              <div>
                <dt className="text-[11.5px] text-on-surface-variant">Último uso</dt>
                <dd className="font-semibold text-on-surface">{fmtDate(k.lastUsedAt)}</dd>
              </div>
              <div>
                <dt className="text-[11.5px] text-on-surface-variant">Sitios y direcciones IP autorizados</dt>
                <dd className="break-words font-semibold text-on-surface">{[...k.allowedDomains, ...k.allowedIps].join(", ") || "Ninguno"}</dd>
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
