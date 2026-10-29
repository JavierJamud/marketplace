import { useState } from "react";
import { useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { ShieldCheck, MessageSquare, Flag, Star } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { canWriteSection } from "../../lib/vendorSections.js";
import { StarRating } from "../../components/ui/StarRating.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

// Bloque 69 (pedido explícito): reportar oculta la reseña de inmediato — el
// vendedor sigue viéndola acá (listMyReviews ya no filtra isHidden, ver el
// controller) para tener feedback real del estado, pero atenuada. Una vez
// reportada, no se puede reportar de nuevo hasta que el admin la resuelva
// (y si la mantiene, queda sellada para siempre — ver assertReportable en
// reviews.controller.js).
const REPORT_STATUS_META = {
  REPORTED: { label: "Reportado, esperando revisión", className: "bg-tertiary-accent/10 text-tertiary-accent" },
  KEPT: { label: "El admin decidió mantenerlo", className: "bg-verified/10 text-verified-dark" },
  SUSPENDED: { label: "Suspendido por el admin", className: "bg-error/10 text-error" },
};

// El vendedor solo puede responder — nunca ocultar ni borrar un comentario
// (eso es exclusivo del admin, ver AdminReviews.jsx). Con `canWrite` en false (personal de solo lectura en Reseñas) solo se
// muestra la respuesta ya publicada: responder pide requireVendorWrite("resenas") y el servidor devolvía 403.
function ReviewReplyForm({ review, onReply, pending, canWrite }) {
  const [editing, setEditing] = useState(!review.vendorReply);
  const [text, setText] = useState(review.vendorReply ?? "");

  if (!canWrite && !review.vendorReply) return null;

  if (!editing || !canWrite) {
    return (
      <div className="mt-3 rounded-md bg-surface-container p-3">
        <div className="mb-1 flex items-center justify-between">
          <span className="text-[12px] font-bold text-tertiary-accent">{canWrite ? "Tu respuesta" : "Respuesta de la tienda"}</span>
          {canWrite && (
            <button onClick={() => setEditing(true)} className="text-[11.5px] font-semibold text-tertiary-accent hover:underline">
              Editar
            </button>
          )}
        </div>
        <p className="text-[13px] leading-5 text-on-surface-variant">{review.vendorReply}</p>
      </div>
    );
  }

  return (
    <div className="mt-3 flex gap-2.5">
      <input
        value={text}
        onChange={(e) => setText(e.target.value)}
        placeholder="Escribe una respuesta pública..."
        className="h-10 min-w-0 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none"
      />
      <button
        onClick={() => text.trim() && onReply(text.trim(), () => setEditing(false))}
        disabled={!text.trim() || pending}
        className="flex-shrink-0 rounded bg-primary-container px-4 text-[12.5px] font-bold text-white disabled:opacity-50"
      >
        {pending ? "Enviando..." : review.vendorReply ? "Guardar" : "Responder"}
      </button>
    </div>
  );
}

export default function VendorReviews() {
  const { siteName } = usePlatformSettings();
  const queryClient = useQueryClient();
  const [reportTarget, setReportTarget] = useState(null);
  const [reportReason, setReportReason] = useState("");
  const { staffSectionPermissions } = useOutletContext() ?? {};
  const canWrite = canWriteSection(staffSectionPermissions ?? null, "resenas");

  const { data: reviews, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["vendor-reviews"],
    queryFn: async () => (await api.get("/vendors/me/reviews")).data.reviews,
  });

  const reply = useMutation({
    mutationFn: async ({ id, reply }) => (await api.patch(`/vendors/me/reviews/${id}/reply`, { reply })).data,
    onSuccess: (_data, variables) => {
      toast.success("Respuesta publicada.");
      queryClient.invalidateQueries({ queryKey: ["vendor-reviews"] });
      variables.onDone?.();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo publicar la respuesta."),
  });

  // Bloque 69 (pedido explícito): reportar un comentario de la propia
  // tienda — el admin se entera de inmediato por correo (ver
  // notifyAdminActionNeeded en reviews.controller.js).
  const reportReview = useMutation({
    mutationFn: async () => (await api.post(`/reviews/${reportTarget.id}/report`, { reason: reportReason.trim() || undefined })).data,
    onSuccess: () => {
      toast.success("Comentario reportado. El equipo lo va a revisar.");
      setReportTarget(null);
      setReportReason("");
      queryClient.invalidateQueries({ queryKey: ["vendor-reviews"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo reportar el comentario.");
      setReportTarget(null);
      setReportReason("");
    },
  });

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Star} tone="orange" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Reseñas</h1>
      </div>
      <p className="mb-[26px] text-[13.5px] text-outline">
        {canWrite
          ? `Comentarios y calificaciones que dejaron tus clientes. Puedes responder públicamente o reportar uno que te parezca abusivo o falso. No puedes ocultarlo ni borrarlo directamente: eso lo decide el equipo de ${siteName} al revisar el reporte.`
          : "Comentarios y calificaciones que dejaron tus clientes. Tienes acceso de solo lectura: puedes verlos, pero no responder ni reportar. Si lo necesitas, pídele permiso a tu administrador."}
      </p>

      {isLoading && <ListSkeleton />}

      {/* Antes un fallo de carga caía en "Todavía no tienes reseñas", como si la tienda no tuviera ninguna. */}
      {isError && !reviews && (
        <div role="alert" className="flex max-w-[640px] flex-col items-center gap-3 rounded-2xl border border-error/30 bg-error/[0.06] px-4 py-10 text-center">
          <p className="text-body-md text-on-surface">No se pudieron cargar las reseñas.</p>
          <button
            type="button"
            onClick={() => refetch()}
            disabled={isFetching}
            className="min-h-11 rounded-xl border border-outline px-4 text-[13px] font-bold text-on-surface hover:bg-surface-container disabled:opacity-50"
          >
            {isFetching ? "Cargando..." : "Reintentar"}
          </button>
        </div>
      )}

      {!isLoading && reviews?.length === 0 && (
        <div className="max-w-[640px] rounded-2xl border border-surface-container-high bg-surface-container-lowest py-16 text-center text-body-md text-on-surface-variant">
          <MessageSquare className="mx-auto mb-3 h-8 w-8 text-outline-variant" />
          Todavía no tienes reseñas.
        </div>
      )}

      <div className="flex max-w-[640px] flex-col gap-3.5">
        {reviews?.map((r) => {
          const reportMeta = r.reportStatus ? REPORT_STATUS_META[r.reportStatus] : null;
          return (
            <div
              key={r.id}
              className="rounded-md border border-surface-container-high bg-surface-container-lowest p-4"
              style={{ opacity: r.isHidden ? 0.6 : 1 }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2.5">
                <div>
                  <div className="flex flex-wrap items-center gap-1.5">
                    <span className="text-label-md font-bold text-on-surface">{r.authorName}</span>
                    {/* Mismo texto que ve el público en la tienda (ReviewsList.jsx): toda reseña exige sesión de cliente, y
                        "Compra verificada" solo sale si compró en la tienda antes de comentar (isVerifiedPurchase). Antes
                        aquí decía "Cliente verificado" en todas y la tienda no podía distinguir las de compras reales. */}
                    <span className="flex items-center gap-1 rounded-full bg-verified/10 px-2 py-0.5 text-[10.5px] font-bold text-verified-dark">
                      <ShieldCheck className="h-3 w-3" aria-hidden="true" /> {r.isVerifiedPurchase ? "Compra verificada" : "Cliente verificado"}
                    </span>
                    {r.product ? (
                      <span className="rounded-full bg-secondary-container/25 px-2 py-0.5 text-[10.5px] font-bold text-on-secondary-container">Reseña del producto · {r.product.name}</span>
                    ) : (
                      <span className="rounded-full bg-tertiary-accent/10 px-2 py-0.5 text-[10.5px] font-bold text-tertiary-accent">Reseña de la tienda</span>
                    )}
                    {reportMeta && (
                      <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${reportMeta.className}`}>{reportMeta.label}</span>
                    )}
                  </div>
                  <div className="text-[11.5px] text-outline">{fmtDate(r.createdAt)}</div>
                </div>
                {r.rating && <StarRating value={r.rating} size="h-3.5 w-3.5" />}
              </div>
              <p className="text-[13.5px] leading-5 text-on-surface-variant">{r.comment}</p>

              {r.images?.length > 0 && (
                <div className="mt-2.5 flex flex-wrap gap-2">
                  {/* Bloque 195 (bug real encontrado en auditoría — key
                      inestable: usaba el índice del array en vez de la URL,
                      que ya es única por foto, mismo criterio que
                      VendorFraudReports.jsx para sus evidenceImages): con
                      index como key, reordenar/quitar fotos podía reusar mal
                      el DOM de otra foto entre renders. */}
                  {r.images.map((img) => (
                    <a key={img} href={`${api.defaults.baseURL}${img}`} target="_blank" rel="noreferrer" className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-surface-container-high">
                      <img src={`${api.defaults.baseURL}${img}`} alt="" className="h-full w-full object-cover" />
                    </a>
                  ))}
                </div>
              )}

              {r.adminReply && (
                <div className="mt-3 rounded-md bg-surface-container p-3">
                  <div className="mb-1 text-[12px] font-bold text-tertiary-accent">Respuesta de la plataforma</div>
                  <p className="text-[13px] leading-5 text-on-surface-variant">{r.adminReply}</p>
                </div>
              )}
              <ReviewReplyForm
                review={r}
                canWrite={canWrite}
                pending={reply.isPending}
                onReply={(text, onDone) => reply.mutate({ id: r.id, reply: text, onDone })}
              />

              {/* Reportar también pide permiso de escritura en Reseñas (reportReview, reviews.controller.js). */}
              {canWrite && !r.reportStatus && (
                <button
                  onClick={() => setReportTarget(r)}
                  className="mt-2.5 flex items-center gap-1.5 text-[11.5px] font-semibold text-error hover:underline"
                >
                  <Flag className="h-3 w-3" /> Reportar
                </button>
              )}
            </div>
          );
        })}
      </div>

      <ConfirmModal
        open={!!reportTarget}
        title="¿Reportar este comentario?"
        message={`El equipo de ${siteName} lo revisa antes de decidir. Mientras tanto deja de mostrarse en tu tienda.`}
        confirmLabel={reportReview.isPending ? "Reportando..." : "Reportar"}
        danger
        onConfirm={() => reportReview.mutate()}
        onCancel={() => {
          setReportTarget(null);
          setReportReason("");
        }}
      >
        <textarea
          value={reportReason}
          onChange={(e) => setReportReason(e.target.value)}
          placeholder="Motivo (opcional)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>
    </div>
  );
}
