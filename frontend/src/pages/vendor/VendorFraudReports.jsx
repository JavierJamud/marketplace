import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { api, getErrorMessage } from "../../lib/api.js";
import { ShieldAlert, Camera, CheckCircle2, Clock } from "lucide-react";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

function targetLabel(r) {
  if (r.product) return `Producto: ${r.product.name}`;
  if (r.vendor) return `Tu tienda: ${r.vendor.companyName}`;
  if (r.customerListing) return `Anuncio: ${r.customerListing.name}`;
  return "Objetivo eliminado";
}

const STATUS_META = {
  PENDING: { label: "Un cliente te reportó — el admin lo está revisando", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)" },
  EVIDENCE_REQUESTED: { label: "Necesitamos que respondas", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)" },
  RESOLVED_NO_ACTION: { label: "Cerrado — sin ninguna acción contra vos", color: "#0CAE53", bg: "rgba(12,174,83,0.1)" },
  RESOLVED_SUSPENDED: { label: "Suspendido por fraude", color: "#232F3E", bg: "rgba(35,47,62,0.1)" },
  DISMISSED: { label: "Descartado — no pasó nada", color: "#0CAE53", bg: "rgba(12,174,83,0.1)" },
};

// Feature B (pedido explícito): "el reportado puede responder con evidencia
// antes de que se tome una decisión". Patrón calcado de VendorReviews.jsx
// (lista + acción inline por fila), pero el objetivo puede ser SU tienda,
// UNO de sus productos, o (si esta misma página se reusa desde el banner
// de CustomerPanel.jsx) un CustomerListing — mismo GET /reports/me/list
// para las 2 superficies.
export default function VendorFraudReports() {
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState({});

  const { data, isLoading } = useQuery({
    queryKey: ["my-fraud-reports"],
    queryFn: async () => (await api.get("/reports/me/list")).data.reports,
  });

  const submitEvidence = useMutation({
    mutationFn: async ({ id, message, files }) => {
      const form = new FormData();
      form.append("evidenceMessage", message);
      files.forEach((f) => form.append("evidence", f));
      return (await api.post(`/reports/${id}/evidence`, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: (_, { id }) => {
      toast.success("Respuesta enviada — el admin la va a revisar.");
      setDrafts((prev) => { const next = { ...prev }; delete next[id]; return next; });
      queryClient.invalidateQueries({ queryKey: ["my-fraud-reports"] });
    },
    onError: async (err) => toast.error(await getErrorMessage(err, "No se pudo enviar tu respuesta.")),
  });

  const reports = data ?? [];

  function updateDraft(id, patch) {
    setDrafts((prev) => ({ ...prev, [id]: { message: "", files: [], ...prev[id], ...patch } }));
  }

  return (
    <div>
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Reportes de fraude</h1>
      <p className="mb-5 text-[13.5px] text-outline">
        Si un cliente reportó tu tienda o un producto, lo ves acá. Respondé con una explicación (y una foto si tenés) antes de que se venza el plazo.
      </p>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
      {!isLoading && reports.length === 0 && (
        <div className="flex flex-col items-center gap-2 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-10 text-center">
          <ShieldAlert className="h-8 w-8 text-outline" />
          <p className="text-body-md text-on-surface-variant">Nadie te reportó — todo en orden.</p>
        </div>
      )}

      <div className="flex flex-col gap-4">
        {reports.map((r) => {
          const status = STATUS_META[r.status];
          const needsResponse = r.status === "EVIDENCE_REQUESTED" && !r.evidenceSentAt;
          const draft = drafts[r.id] ?? { message: "", files: [] };

          return (
            <div key={r.id} className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
              <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                <span className="text-[14px] font-bold text-on-surface">{targetLabel(r)}</span>
                <span className="rounded-full px-2.5 py-1 text-[11px] font-bold" style={{ background: status.bg, color: status.color }}>
                  {status.label}
                </span>
              </div>
              <p className="mb-2 text-[13px] text-on-surface-variant">
                Reportado el {fmtDate(r.createdAt)}: "{r.message}"
              </p>
              <a href={imgUrl(r.screenshotUrl)} target="_blank" rel="noreferrer" className="mb-3 inline-block text-[12px] font-semibold text-tertiary-accent hover:underline">
                Ver la captura que mandó el cliente
              </a>

              {r.status === "EVIDENCE_REQUESTED" && r.evidenceDueAt && !r.evidenceSentAt && (
                <p className="mb-3 flex items-center gap-1.5 text-[12.5px] font-semibold text-error">
                  <Clock className="h-3.5 w-3.5" /> Tenés hasta el {fmtDate(r.evidenceDueAt)} para responder.
                </p>
              )}

              {r.evidenceSentAt && (
                <div className="mb-3 rounded-lg bg-surface-container p-3">
                  <p className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-verified-dark">
                    <CheckCircle2 className="h-3.5 w-3.5" /> Ya respondiste ({fmtDate(r.evidenceSentAt)})
                  </p>
                  <p className="text-[13px] text-on-surface-variant">{r.evidenceMessage}</p>
                  {r.evidenceImages?.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-2">
                      {r.evidenceImages.map((url) => (
                        <a key={url} href={imgUrl(url)} target="_blank" rel="noreferrer">
                          <img src={imgUrl(url)} alt="Tu evidencia" className="h-16 w-16 rounded-md object-cover" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {r.resolutionNote && ["RESOLVED_NO_ACTION", "RESOLVED_SUSPENDED", "DISMISSED"].includes(r.status) && (
                <p className="mb-3 rounded-lg bg-surface-container p-3 text-[12.5px] text-on-surface-variant">
                  Nota del admin: {r.resolutionNote}
                </p>
              )}

              {needsResponse && (
                <div className="mt-2 border-t border-surface-container pt-3">
                  <textarea
                    value={draft.message}
                    onChange={(e) => updateDraft(r.id, { message: e.target.value })}
                    rows={3}
                    placeholder="Explicá qué pasó (mínimo 10 caracteres)..."
                    className="mb-2 w-full resize-none rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] text-on-surface outline-none focus:border-tertiary-accent"
                  />
                  <div className="flex flex-wrap items-center gap-2">
                    <label className="flex cursor-pointer items-center gap-1.5 rounded-lg border border-outline-variant px-3 py-2 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-variant/40">
                      <Camera className="h-3.5 w-3.5" />
                      {draft.files.length > 0 ? `${draft.files.length} foto(s)` : "Adjuntar captura (opcional)"}
                      <input
                        type="file"
                        accept="image/jpeg,image/jpg,image/png,image/webp"
                        multiple
                        className="hidden"
                        onChange={(e) => updateDraft(r.id, { files: Array.from(e.target.files ?? []).slice(0, 4) })}
                      />
                    </label>
                    <button
                      onClick={() => {
                        if (draft.message.trim().length < 10) return toast.error("Contanos qué pasó (mínimo 10 caracteres).");
                        submitEvidence.mutate({ id: r.id, message: draft.message.trim(), files: draft.files });
                      }}
                      disabled={submitEvidence.isPending}
                      className="rounded-lg bg-tertiary-accent px-4 py-2 text-[12.5px] font-bold text-white disabled:opacity-50"
                    >
                      {submitEvidence.isPending ? "Enviando..." : "Enviar respuesta"}
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
