import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Radar } from "lucide-react";
import { api } from "../../lib/api.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL = {
  PENDING: { label: "Pendiente", bg: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
  DISMISSED: { label: "Descartada", bg: "rgba(35,47,62,0.1)", color: "#232F3E" },
  ACTIONED: { label: "Ya se actuó", bg: "rgba(12,174,83,0.12)", color: "#0CAE53" },
};

const KIND_LABEL = {
  REVIEW_BURST: "Ráfaga de reseñas",
  CLICK_SPIKE: "Pico de clics",
};

function targetInfo(a) {
  if (a.product) return { label: `Producto: ${a.product.name}`, sub: a.product.vendor?.companyName, href: a.product.vendor ? `/producto/${a.product.vendor.slug}/${a.product.slug}` : null };
  if (a.vendor) return { label: `Tienda: ${a.vendor.companyName}`, sub: null, href: `/tienda/${a.vendor.slug}` };
  return { label: "Objetivo eliminado", sub: null, href: null };
}

// Bloque 229 (Fase 2 del blindaje del ranking — pedido explícito:
// "visibilidad para el admin"): calco directo de AdminFraudReports.jsx —
// misma grilla, mismo patrón de filtro por estado y modal de confirmación.
// A diferencia de un reporte de fraude, acá nunca hay una consecuencia
// automática que aplicar: "Ya se actuó" solo documenta que el admin hizo
// algo a mano en otra pantalla (Tiendas/Productos/Comentarios); esta cola
// nunca ejecuta nada por sí sola.
export default function AdminRankingAnomalies() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("PENDING");
  const [dismissTarget, setDismissTarget] = useState(null);
  const [dismissNote, setDismissNote] = useState("");
  const [actionTarget, setActionTarget] = useState(null);
  const [actionNote, setActionNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-ranking-anomalies", statusFilter],
    queryFn: async () => (await api.get("/admin/ranking-anomalies", { params: statusFilter ? { status: statusFilter } : undefined })).data.anomalies,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-ranking-anomalies"] });
    queryClient.invalidateQueries({ queryKey: ["admin-ranking-anomalies-count"] });
  };

  const dismiss = useMutation({
    mutationFn: async ({ id, reviewNote }) => (await api.post(`/admin/ranking-anomalies/${id}/dismiss`, { reviewNote })).data,
    onSuccess: () => {
      toast.success("Anomalía descartada.");
      setDismissTarget(null);
      setDismissNote("");
      invalidate();
    },
    onError: (err) => { toast.error(err.response?.data?.error ?? "No se pudo descartar."); setDismissTarget(null); },
  });

  const action = useMutation({
    mutationFn: async ({ id, reviewNote }) => (await api.post(`/admin/ranking-anomalies/${id}/action`, { reviewNote })).data,
    onSuccess: () => {
      toast.success("Marcada como atendida.");
      setActionTarget(null);
      setActionNote("");
      invalidate();
    },
    onError: (err) => { toast.error(err.response?.data?.error ?? "No se pudo marcar."); setActionTarget(null); },
  });

  const anomalies = data ?? [];

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Radar} tone="orange" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Anomalías del ranking</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">
        Ráfagas de reseñas de 5★ desde cuentas nuevas y picos de clics fuera de lo normal, detectados solos por los crons de vigilancia. Ninguna se
        aplica sola — solo levantan bandera para que la revises. Si algo amerita acción real (suspender producto/tienda, ocultar reseñas), hazlo
        desde Productos, Tiendas o Comentarios y luego márcala como "Ya se actuó" acá.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["", "Todas"],
          ["PENDING", "Pendientes"],
          ["ACTIONED", "Ya se actuó"],
          ["DISMISSED", "Descartadas"],
        ].map(([value, label]) => (
          <button
            key={value}
            onClick={() => setStatusFilter(value)}
            className={`rounded-full px-3.5 py-1.5 text-[12px] font-semibold ${
              statusFilter === value ? "bg-tertiary-accent text-white" : "bg-surface-container-lowest text-on-surface-variant border border-surface-container-high"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <div className="overflow-x-auto rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        <div className="grid grid-cols-[1.1fr_1.8fr_2.4fr_1.3fr_1.6fr] gap-3 bg-surface-container-low px-[22px] py-3.5 text-[11.5px] font-bold uppercase tracking-wide text-outline min-w-[900px]">
          <span>Tipo</span><span>Objetivo</span><span>Detalle</span><span>Fecha</span><span className="text-right">Acción</span>
        </div>
        {isLoading && <p className="p-5 text-body-md text-on-surface-variant">Cargando...</p>}
        {!isLoading && anomalies.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">No hay anomalías acá.</p>}
        {anomalies.map((a) => {
          const target = targetInfo(a);
          const status = STATUS_LABEL[a.status];
          return (
            <div key={a.id} className="grid min-w-[900px] grid-cols-[1.1fr_1.8fr_2.4fr_1.3fr_1.6fr] items-center gap-3 border-t border-surface-container px-[22px] py-3.5">
              <div>
                <span className="text-[12.5px] font-semibold text-on-surface">{KIND_LABEL[a.kind] ?? a.kind}</span>
                <div className="mt-0.5 w-fit rounded-full px-2 py-0.5 text-[10.5px] font-bold" style={{ background: status.bg, color: status.color }}>
                  {status.label}
                </div>
              </div>
              <div>
                {target.href ? (
                  <Link to={target.href} target="_blank" className="text-[13px] font-semibold text-tertiary-accent hover:underline">{target.label}</Link>
                ) : (
                  <span className="text-[13px] font-semibold text-on-surface">{target.label}</span>
                )}
                {target.sub && <div className="text-[11.5px] text-outline">{target.sub}</div>}
              </div>
              <p className="text-[12.5px] text-on-surface-variant">{a.details}</p>
              <span className="text-[12px] text-outline">{fmtDate(a.detectedAt)}</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                {a.status === "PENDING" && (
                  <>
                    <button
                      onClick={() => { setDismissTarget(a); setDismissNote(""); }}
                      className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant"
                    >
                      Descartar
                    </button>
                    <button
                      onClick={() => { setActionTarget(a); setActionNote(""); }}
                      className="rounded-[7px] bg-verified-dark px-2.5 py-1.5 text-[12px] font-semibold text-white"
                    >
                      Ya se actuó
                    </button>
                  </>
                )}
                {a.status !== "PENDING" && a.reviewedBy && (
                  <span className="text-[11px] text-outline">{a.reviewedBy.fullName}</span>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmModal
        open={!!dismissTarget}
        title="¿Descartar esta anomalía?"
        message="No se aplica ningún cambio — solo se marca como revisada y falsa alarma."
        confirmLabel={dismiss.isPending ? "Descartando..." : "Sí, descartar"}
        onConfirm={() => dismiss.mutate({ id: dismissTarget.id, reviewNote: dismissNote.trim() || undefined })}
        onCancel={() => setDismissTarget(null)}
      >
        <textarea
          value={dismissNote}
          onChange={(e) => setDismissNote(e.target.value)}
          placeholder="Nota interna (opcional)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>

      <ConfirmModal
        open={!!actionTarget}
        title="¿Marcar como atendida?"
        message="Confirma esto solo después de haber actuado a mano en Productos, Tiendas o Comentarios (suspender, ocultar reseñas, etc.). Esta pantalla no aplica ningún cambio por sí sola."
        confirmLabel={action.isPending ? "Guardando..." : "Sí, ya actué"}
        onConfirm={() => action.mutate({ id: actionTarget.id, reviewNote: actionNote.trim() || undefined })}
        onCancel={() => setActionTarget(null)}
      >
        <textarea
          value={actionNote}
          onChange={(e) => setActionNote(e.target.value)}
          placeholder="Qué se hizo (opcional)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>
    </div>
  );
}
