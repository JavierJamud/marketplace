import { useState } from "react";
import { useSearchParams } from "react-router-dom";
import { Tabs } from "../../components/ui/Tabs.jsx";
import AdminSupportTickets from "../../components/admin/AdminSupportTickets.jsx";

// Pestañas: los errores técnicos que registra el sistema y los tickets que mandan las tiendas con su captura.
const ERROR_TABS = [
  { id: "system", label: "Errores del sistema" },
  { id: "tickets", label: "Tickets de las tiendas" },
];
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Check, AlertTriangle } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

// Bloque 33: el backend solo conoce los 6 valores reales de ErrorOrigin —
// estos grupos son puramente de la UI (mapean a 1+ origin real cada uno),
// el filtro se manda como lista separada por coma (ver errorLogs.controller.js).
const ORIGIN_FILTERS = [
  { id: "all", label: "Todos", origins: null },
  { id: "bots", label: "Solo bots", origins: ["BOT_TIENDA", "BOT_GENERAL"] },
  { id: "reportes", label: "Reportes de usuarios", origins: ["REPORTE_USUARIO"] },
  { id: "pantalla", label: "Errores de pantalla", origins: ["PAGINA"] },
  { id: "emails", label: "Solo emails", origins: ["EMAIL_RESEND"] },
  { id: "pagos", label: "Solo pagos", origins: ["STRIPE"] },
  { id: "audio", label: "Transcripción de audio", origins: ["TRANSCRIPCION_AUDIO"] },
  { id: "otro", label: "Otros", origins: ["OTRO"] },
];

const STATUS_FILTERS = [
  { id: "unresolved", label: "Sin resolver" },
  { id: "resolved", label: "Resueltos" },
  { id: "all", label: "Todos" },
];

const ORIGIN_LABELS = {
  BOT_TIENDA: "Bot de tienda",
  BOT_GENERAL: "Bot general",
  EMAIL_RESEND: "Email (Resend)",
  STRIPE: "Stripe",
  TRANSCRIPCION_AUDIO: "Transcripción de audio",
  REPORTE_USUARIO: "Reporte de usuario",
  PAGINA: "Error de pantalla (automático)",
  OTRO: "Otro",
};

export default function AdminErrors() {
  const queryClient = useQueryClient();
  const [params, setParams] = useSearchParams();
  const tab = params.get("tab") === "tickets" ? "tickets" : "system";
  const setTab = (id) => setParams(id === "tickets" ? { tab: "tickets" } : {});
  // Lo pendiente de cada pestaña (mismo contador que el menú lateral).
  const { data: sectionCounts } = useQuery({
    queryKey: ["admin-section-counts"],
    queryFn: async () => (await api.get("/admin/section-counts")).data,
    refetchInterval: 30000,
  });
  const tabsWithCounts = ERROR_TABS.map((t) => ({ ...t, count: sectionCounts?.errores?.tabs?.[t.id === "system" ? "sistema" : "tickets"] ?? 0 }));
  const [originFilter, setOriginFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("unresolved");

  const originGroup = ORIGIN_FILTERS.find((f) => f.id === originFilter);
  const resolvedParam = statusFilter === "all" ? undefined : statusFilter === "resolved" ? "true" : "false";

  const { data, isLoading } = useQuery({
    queryKey: ["admin-errors", originFilter, statusFilter],
    queryFn: async () =>
      (
        await api.get("/admin/errors", {
          params: { origin: originGroup?.origins ? originGroup.origins.join(",") : undefined, resolved: resolvedParam },
        })
      ).data.errors,
  });

  const resolve = useMutation({
    mutationFn: async (id) => (await api.patch(`/admin/errors/${id}/resolve`)).data,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-errors"] });
      queryClient.invalidateQueries({ queryKey: ["admin-errors-unresolved-count"] });
      toast.success("Marcado como resuelto.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo marcar como resuelto."),
  });

  return (
    <div className="max-w-[900px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={AlertTriangle} tone="orange" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Errores</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">
        Fallas técnicas reales registradas automáticamente (bots, emails, pagos, transcripción de audio, y cualquier otra
        del backend) — este es el único lugar del sitio donde se ve el detalle real, nunca se expone al cliente/vendedor.
      </p>

      <Tabs tabs={tabsWithCounts} value={tab} onChange={setTab} className="mb-4" />
      {tab === "tickets" ? (
        <AdminSupportTickets />
      ) : (
        <>
      <div className="mb-2.5 flex flex-wrap gap-2">
        {ORIGIN_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setOriginFilter(f.id)}
            className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${
              originFilter === f.id ? "border-tertiary bg-tertiary text-white" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>
      <div className="mb-[22px] flex flex-wrap gap-2">
        {STATUS_FILTERS.map((f) => (
          <button
            key={f.id}
            onClick={() => setStatusFilter(f.id)}
            className={`rounded-full border px-4 py-2 text-[13px] font-semibold ${
              statusFilter === f.id ? "border-error bg-error text-white" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {isLoading && <ListSkeleton />}
      {!isLoading && data?.length === 0 && <p className="text-body-md text-on-surface-variant">No hay errores para este filtro.</p>}

      <div className="flex flex-col gap-3.5">
        {data?.map((e) => (
          <div
            key={e.id}
            className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-5"
            style={{ opacity: e.resolved ? 0.65 : 1 }}
          >
            <div className="mb-2.5 flex flex-wrap items-center justify-between gap-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full bg-tertiary-accent/10 px-2.5 py-1 text-[11px] font-bold text-tertiary-accent">
                  {ORIGIN_LABELS[e.origin] ?? e.origin}
                </span>
                <span className="text-[11.5px] text-outline">{new Date(e.createdAt).toLocaleString("es-CU")}</span>
              </div>
              {e.resolved ? (
                <span className="flex items-center gap-1 rounded-full bg-verified/10 px-2.5 py-1 text-[11px] font-bold text-verified-dark">
                  <Check className="h-3 w-3" strokeWidth={3} /> Resuelto
                </span>
              ) : (
                <span className="rounded-full bg-error/10 px-2.5 py-1 text-[11px] font-bold text-error">Sin resolver</span>
              )}
            </div>

            {e.origin === "REPORTE_USUARIO" && e.context ? (
              <div className="space-y-1.5 text-[13.5px] text-on-surface">
                <p className="whitespace-pre-wrap break-words font-semibold">{e.context.description}</p>
                <p className="text-[12.5px] text-on-surface-variant">
                  {e.context.who?.kind === "cuenta" ? `${e.context.who.name ?? e.context.who.email} (${e.context.who.role}${e.context.who.vendor ? `, tienda ${e.context.who.vendor.name}` : ""})` : "Visitante sin sesión"}
                  {e.context.contactEmail ? ` · ${e.context.contactEmail}` : ""}
                  {e.context.page ? ` · pantalla ${e.context.page}` : ""}
                </p>
                {e.context.request?.path && (
                  <p className="font-mono text-[12px] text-error">
                    Falló: {e.context.request.method} {e.context.request.path} {e.context.request.status ?? "sin respuesta"} {e.context.request.message}
                  </p>
                )}
              </div>
            ) : (
              <p className="whitespace-pre-wrap break-words font-mono text-[12.5px] leading-relaxed text-on-surface">{e.message}</p>
            )}

            {e.context && (
              <pre className="mt-2.5 max-h-40 overflow-auto rounded-md bg-surface-container p-3 text-[11px] leading-relaxed text-on-surface-variant">
                {JSON.stringify(e.context, null, 2)}
              </pre>
            )}

            {!e.resolved && (
              <button
                onClick={() => resolve.mutate(e.id)}
                disabled={resolve.isPending}
                className="mt-3.5 rounded-md bg-surface-container px-3.5 py-2 text-[12px] font-bold text-on-surface-variant disabled:opacity-50"
              >
                Marcar como resuelto
              </button>
            )}
          </div>
        ))}
      </div>
        </>
      )}
    </div>
  );
}
