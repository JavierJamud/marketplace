import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { ShieldAlert } from "lucide-react";
import { api } from "../../lib/api.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

const STATUS_LABEL = {
  PENDING: { label: "Pendiente", bg: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
  EVIDENCE_REQUESTED: { label: "Esperando evidencia", bg: "rgba(138,81,0,0.12)", color: "#8a5100" },
  RESOLVED_NO_ACTION: { label: "Cerrado sin acción", bg: "rgba(12,174,83,0.12)", color: "#0CAE53" },
  RESOLVED_SUSPENDED: { label: "Suspendido por fraude", bg: "rgba(35,47,62,0.1)", color: "#232F3E" },
  DISMISSED: { label: "Descartado", bg: "rgba(35,47,62,0.1)", color: "#232F3E" },
};

function targetInfo(r) {
  if (r.product) return { label: `Producto: ${r.product.name}`, sub: r.product.vendor?.companyName, href: r.product.vendor ? `/producto/${r.product.vendor.slug}/${r.product.slug}` : null };
  if (r.vendor) return { label: `Tienda: ${r.vendor.companyName}`, sub: null, href: `/tienda/${r.vendor.slug}` };
  if (r.customerListing) return { label: `Venta rápida: ${r.customerListing.name}`, sub: r.customerListing.owner?.fullName, href: `/ventas-rapidas/${r.customerListing.id}` };
  return { label: "Objetivo eliminado", sub: null, href: null };
}

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

// Feature B (pedido explícito): cola de reportes de fraude — calco del
// patrón de AdminSuspendedVendors.jsx (misma grilla con overflow-x-auto +
// min-w). No reimplementa las acciones de moderación en sí (eso ya existe
// en AdminProducts.jsx/AdminVendors.jsx/AdminCustomerListings.jsx) — acá
// vive el ciclo del reporte: pedir evidencia, cerrar sin acción, confirmar
// fraude (aplica la consecuencia mínima del lado del servidor).
export default function AdminFraudReports() {
  const queryClient = useQueryClient();
  const [statusFilter, setStatusFilter] = useState("");
  const [evidenceView, setEvidenceView] = useState(null);
  const [dismissTarget, setDismissTarget] = useState(null);
  const [dismissNote, setDismissNote] = useState("");
  const [resolveTarget, setResolveTarget] = useState(null);
  const [resolveNote, setResolveNote] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-fraud-reports", statusFilter],
    queryFn: async () => (await api.get("/admin/reports", { params: statusFilter ? { status: statusFilter } : undefined })).data.reports,
  });

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-fraud-reports"] });
    queryClient.invalidateQueries({ queryKey: ["admin-fraud-reports-count"] });
  };

  const requestEvidence = useMutation({
    mutationFn: async (id) => (await api.post(`/admin/reports/${id}/request-evidence`)).data,
    onSuccess: () => { toast.success("Evidencia solicitada — se le avisó al reportado."); invalidate(); },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo pedir evidencia."),
  });

  const dismiss = useMutation({
    mutationFn: async ({ id, resolutionNote }) => (await api.post(`/admin/reports/${id}/dismiss`, { resolutionNote })).data,
    onSuccess: () => {
      toast.success("Reporte cerrado sin acción.");
      setDismissTarget(null);
      setDismissNote("");
      invalidate();
    },
    onError: (err) => { toast.error(err.response?.data?.error ?? "No se pudo cerrar el reporte."); setDismissTarget(null); },
  });

  const resolve = useMutation({
    mutationFn: async ({ id, resolutionNote }) => (await api.post(`/admin/reports/${id}/resolve`, { resolutionNote })).data,
    onSuccess: () => {
      toast.success("Fraude confirmado — se aplicó la suspensión.");
      setResolveTarget(null);
      setResolveNote("");
      invalidate();
    },
    onError: (err) => { toast.error(err.response?.data?.error ?? "No se pudo resolver el reporte."); setResolveTarget(null); },
  });

  const reports = data ?? [];
  const isTerminal = (s) => ["RESOLVED_NO_ACTION", "RESOLVED_SUSPENDED", "DISMISSED"].includes(s);

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={ShieldAlert} tone="orange" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Reportes de fraude</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">
        Reportes de clientes sobre productos, tiendas o anuncios de venta rápida. Pide evidencia, cierra sin acción, o confirma el fraude.
      </p>

      <div className="mb-4 flex flex-wrap gap-2">
        {[
          ["", "Todos"],
          ["PENDING", "Pendientes"],
          ["EVIDENCE_REQUESTED", "Esperando evidencia"],
          ["RESOLVED_SUSPENDED", "Suspendidos"],
          ["RESOLVED_NO_ACTION", "Sin acción"],
          ["DISMISSED", "Descartados"],
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
        <div className="grid grid-cols-[1.8fr_1.2fr_1.3fr_1.6fr_1.3fr_1.6fr] gap-3 bg-surface-container-low px-[22px] py-3.5 text-[11.5px] font-bold uppercase tracking-wide text-outline min-w-[900px]">
          <span>Objetivo</span><span>Reportante</span><span>Estado</span><span>Mensaje</span><span>Fecha</span><span className="text-right">Acción</span>
        </div>
        {isLoading && <p className="p-5 text-body-md text-on-surface-variant">Cargando...</p>}
        {!isLoading && reports.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">No hay reportes acá.</p>}
        {reports.map((r) => {
          const target = targetInfo(r);
          const status = STATUS_LABEL[r.status];
          return (
            <div key={r.id} className="grid min-w-[900px] grid-cols-[1.8fr_1.2fr_1.3fr_1.6fr_1.3fr_1.6fr] items-center gap-3 border-t border-surface-container px-[22px] py-3.5">
              <div>
                {target.href ? (
                  <Link to={target.href} target="_blank" className="text-[13px] font-semibold text-tertiary-accent hover:underline">{target.label}</Link>
                ) : (
                  <span className="text-[13px] font-semibold text-on-surface">{target.label}</span>
                )}
                {target.sub && <div className="text-[11.5px] text-outline">{target.sub}</div>}
              </div>
              <div>
                <span className="text-[12.5px] font-semibold text-on-surface">{r.reporter?.fullName ?? "—"}</span>
                <div className="text-[11px] text-outline">{r.reporter?.email}</div>
              </div>
              <span className="w-fit rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: status.bg, color: status.color }}>
                {status.label}
                {r.status === "EVIDENCE_REQUESTED" && r.evidenceSentAt && " · respondió"}
              </span>
              <p className="line-clamp-2 text-[12.5px] text-on-surface-variant">{r.message}</p>
              <span className="text-[12px] text-outline">{fmtDate(r.createdAt)}</span>
              <div className="flex flex-wrap justify-end gap-1.5">
                <a href={imgUrl(r.screenshotUrl)} target="_blank" rel="noreferrer" className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant">
                  Captura
                </a>
                {r.evidenceSentAt && (
                  <button onClick={() => setEvidenceView(r)} className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant">
                    Ver evidencia
                  </button>
                )}
                {!isTerminal(r.status) && (
                  <>
                    {r.status === "PENDING" && (
                      <button
                        onClick={() => requestEvidence.mutate(r.id)}
                        disabled={requestEvidence.isPending}
                        className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant disabled:opacity-50"
                      >
                        Pedir evidencia
                      </button>
                    )}
                    <button
                      onClick={() => { setDismissTarget(r); setDismissNote(""); }}
                      className="rounded-[7px] bg-verified-dark px-2.5 py-1.5 text-[12px] font-semibold text-white"
                    >
                      Sin acción
                    </button>
                    <button
                      onClick={() => { setResolveTarget(r); setResolveNote(""); }}
                      className="rounded-[7px] bg-error px-2.5 py-1.5 text-[12px] font-semibold text-white"
                    >
                      Confirmar fraude
                    </button>
                  </>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmModal
        open={!!evidenceView}
        title="Evidencia enviada"
        message={evidenceView?.evidenceMessage ?? ""}
        confirmLabel="Cerrar"
        onConfirm={() => setEvidenceView(null)}
        onCancel={() => setEvidenceView(null)}
      >
        {evidenceView?.evidenceImages?.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {evidenceView.evidenceImages.map((url) => (
              <a key={url} href={imgUrl(url)} target="_blank" rel="noreferrer">
                <img src={imgUrl(url)} alt="Evidencia" className="h-20 w-20 rounded-lg object-cover" />
              </a>
            ))}
          </div>
        )}
      </ConfirmModal>

      <ConfirmModal
        open={!!dismissTarget}
        title="¿Cerrar este reporte sin ninguna acción?"
        message="El producto/tienda/anuncio sigue funcionando con normalidad. Se le avisa al reportado que el caso se cerró."
        confirmLabel={dismiss.isPending ? "Cerrando..." : "Sí, cerrar sin acción"}
        onConfirm={() => dismiss.mutate({ id: dismissTarget.id, resolutionNote: dismissNote.trim() || undefined })}
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
        open={!!resolveTarget}
        title="¿Confirmar fraude y suspender?"
        message="Se suspende el producto/tienda/anuncio reportado y se avisa al dueño. Nada se borra — es reversible a mano después si hace falta."
        confirmLabel={resolve.isPending ? "Aplicando..." : "Sí, confirmar y suspender"}
        confirmDisabled={resolveNote.trim().length < 5 || resolve.isPending}
        danger
        onConfirm={() => resolve.mutate({ id: resolveTarget.id, resolutionNote: resolveNote.trim() })}
        onCancel={() => setResolveTarget(null)}
      >
        <textarea
          value={resolveNote}
          onChange={(e) => setResolveNote(e.target.value)}
          placeholder="Motivo de la suspensión (obligatorio, mínimo 5 caracteres)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>
    </div>
  );
}
