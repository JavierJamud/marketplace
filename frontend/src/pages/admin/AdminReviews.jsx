import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { ShieldCheck, EyeOff, Eye, Trash2, Store, Package, Flag, Check, Ban, Clock, UserX, Star } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { StarRating } from "../../components/ui/StarRating.jsx";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

// Bloque 69 (pedido explícito): estado del reporte, si tiene uno — REPORTED
// es la única fase con acciones reales (Mantener/Suspender); KEPT/SUSPENDED
// son solo informativas acá (la decisión ya se tomó, ver resolveReport).
const REPORT_STATUS_META = {
  REPORTED: { label: "Reportado — esperando tu decisión", className: "bg-tertiary-accent/10 text-tertiary-accent" },
  KEPT: { label: "Mantenido (ya no se puede reportar de nuevo)", className: "bg-verified/10 text-verified-dark" },
  SUSPENDED: { label: "Suspendido", className: "bg-error/10 text-error" },
};

// Bloque 118 (pedido explícito — "poder cambiar esos valores de comentarios
// por tienda y por producto y por día, y poder deshabilitar que los
// vendedores comenten"): mismo patrón que OfferPolicyCard en AdminOffers.jsx
// — una tarjeta de configuración embebida arriba del listado, no una
// sección aparte del menú (esta pantalla ya es "todo lo de comentarios").
function ReviewPolicyCard() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const [dedupHours, setDedupHours] = useState("");
  const [maxPerProduct, setMaxPerProduct] = useState("");
  const [maxPerStore, setMaxPerStore] = useState("");
  const [vendorsCanReview, setVendorsCanReview] = useState(true);

  useEffect(() => {
    if (settings) {
      setDedupHours(String(settings.reviewDedupHours));
      setMaxPerProduct(String(settings.maxReviewsPerProductPerPeriod));
      setMaxPerStore(String(settings.maxReviewsPerStorePerPeriod));
      setVendorsCanReview(settings.vendorsCanReview);
    }
  }, [settings]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch("/admin/settings/review-policy", {
          reviewDedupHours: Number(dedupHours),
          maxReviewsPerProductPerPeriod: Number(maxPerProduct),
          maxReviewsPerStorePerPeriod: Number(maxPerStore),
          vendorsCanReview,
        })
      ).data,
    onSuccess: () => {
      toast.success("Política de comentarios actualizada.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la política."),
  });

  const dirty =
    settings &&
    dedupHours !== "" &&
    maxPerProduct !== "" &&
    maxPerStore !== "" &&
    (Number(dedupHours) !== settings.reviewDedupHours ||
      Number(maxPerProduct) !== settings.maxReviewsPerProductPerPeriod ||
      Number(maxPerStore) !== settings.maxReviewsPerStorePerPeriod ||
      vendorsCanReview !== settings.vendorsCanReview);

  return (
    <div className="mb-[18px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <div className="mb-3 flex items-center gap-2 text-[14px] font-bold text-on-surface">
        <Clock className="h-4 w-4 text-tertiary-accent" /> Política de comentarios y reseñas
      </div>
      <p className="mb-3.5 text-[11.5px] text-outline">
        Cuántos comentarios/reseñas puede dejar una misma cuenta dentro de la ventana de tiempo de abajo — el tope de
        producto y el de tienda son independientes: dejar una reseña en un producto no gasta el cupo de otro producto
        ni el de la reseña general de la tienda.
      </p>
      <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-3">
        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">Ventana de tiempo (horas)</span>
          <input
            type="number"
            min={1}
            max={720}
            value={dedupHours}
            onChange={(e) => setDedupHours(e.target.value)}
            className="h-10 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none"
          />
          <p className="mt-1 text-[11px] text-outline">24 = "por día" (el default de siempre).</p>
        </div>
        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">Máximo por producto, en esa ventana</span>
          <input
            type="number"
            min={1}
            max={100}
            value={maxPerProduct}
            onChange={(e) => setMaxPerProduct(e.target.value)}
            className="h-10 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none"
          />
          <p className="mt-1 text-[11px] text-outline">Por cuenta, por cada producto puntual (Product.jsx).</p>
        </div>
        <div>
          <span className="mb-1 block text-label-md text-on-surface-variant">Máximo por tienda, en esa ventana</span>
          <input
            type="number"
            min={1}
            max={100}
            value={maxPerStore}
            onChange={(e) => setMaxPerStore(e.target.value)}
            className="h-10 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none"
          />
          <p className="mt-1 text-[11px] text-outline">Por cuenta, para el comentario general de la tienda (Store.jsx, sin producto).</p>
        </div>
      </div>

      <div className="mt-4 flex items-start gap-2.5 border-t border-surface-container-high pt-4">
        <input
          type="checkbox"
          id="vendorsCanReview"
          checked={!vendorsCanReview}
          onChange={(e) => setVendorsCanReview(!e.target.checked)}
          className="mt-0.5 h-4 w-4 flex-shrink-0"
        />
        <label htmlFor="vendorsCanReview" className="cursor-pointer">
          <span className="flex items-center gap-1.5 text-[13px] font-bold text-on-surface">
            <UserX className="h-3.5 w-3.5" /> Las cuentas de vendedor no pueden comentar ni reseñar
          </span>
          <p className="text-[11.5px] text-outline">
            Bloquea a cualquier cuenta con rol Vendedor de dejar un comentario o reseña en cualquier tienda o
            producto (incluida su propia tienda) — los clientes no se ven afectados por este interruptor.
          </p>
        </label>
      </div>

      {dirty && (
        <Button className="mt-3.5" size="sm" disabled={save.isPending} onClick={() => save.mutate()}>
          {save.isPending ? "Guardando..." : "Guardar política"}
        </Button>
      )}
    </div>
  );
}

// Bloque 22: única pantalla que puede ocultar o borrar un comentario — el
// vendedor (VendorReviews.jsx) solo puede responder, nunca tocar esto.
export default function AdminReviews() {
  const queryClient = useQueryClient();
  const [confirmDelete, setConfirmDelete] = useState(null);

  const { data: reviews, isLoading } = useQuery({
    queryKey: ["admin-reviews"],
    queryFn: async () => (await api.get("/admin/reviews")).data.reviews,
  });

  const toggleHidden = useMutation({
    mutationFn: async ({ id, isHidden }) => (await api.patch(`/admin/reviews/${id}/hidden`, { isHidden })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-reviews"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar."),
  });

  // Bloque 69 (pedido explícito): resuelve un reporte pendiente — "mantener"
  // vuelve a mostrarlo y lo sella contra nuevos reportes; "suspender" lo deja
  // oculto (desde ahí, solo "Eliminar" de abajo, ya existente).
  const resolveReport = useMutation({
    mutationFn: async ({ id, decision }) => (await api.patch(`/admin/reviews/${id}/resolve-report`, { decision })).data,
    onSuccess: (_data, { decision }) => {
      toast.success(decision === "keep" ? "Comentario mantenido — vuelve a ser visible." : "Comentario suspendido.");
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo resolver el reporte."),
  });

  const deleteReview = useMutation({
    mutationFn: async (id) => (await api.delete(`/admin/reviews/${id}`)).data,
    onSuccess: () => {
      toast.success("Comentario eliminado.");
      setConfirmDelete(null);
      queryClient.invalidateQueries({ queryKey: ["admin-reviews"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo eliminar."),
  });

  return (
    <div className="max-w-[860px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Star} tone="orange" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Comentarios</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Todos los comentarios y reseñas del sitio. Ocultar es reversible (deja de verse en la tienda y en el panel del vendedor, pero
        puedes volver a mostrarlo); eliminar es definitivo. Los reportados por un vendedor o un cliente se ocultan solos apenas se
        reportan — resuélvelos abajo antes de que el comentario vuelva a mostrarse.
      </p>

      <ReviewPolicyCard />

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
      {!isLoading && !reviews?.length && <p className="text-body-md text-on-surface-variant">Todavía no hay comentarios en el sitio.</p>}

      <div className="flex flex-col gap-3.5">
        {reviews?.map((r) => (
          <div
            key={r.id}
            className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-5"
            style={{ opacity: r.isHidden ? 0.6 : 1 }}
          >
            <div className="mb-2.5 flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="flex flex-wrap items-center gap-1.5">
                  <span className="text-label-md font-bold text-on-surface">{r.authorName}</span>
                  {r.isVerifiedPurchase && (
                    <span className="flex items-center gap-1 rounded-full bg-verified/10 px-2 py-0.5 text-[10.5px] font-bold text-verified-dark">
                      <ShieldCheck className="h-3 w-3" /> Compra verificada
                    </span>
                  )}
                  {r.isHidden && (
                    <span className="rounded-full bg-surface-container-high px-2 py-0.5 text-[10.5px] font-bold text-outline">Oculto</span>
                  )}
                  {r.reportStatus && (
                    <span className={`rounded-full px-2 py-0.5 text-[10.5px] font-bold ${REPORT_STATUS_META[r.reportStatus].className}`}>
                      <Flag className="mr-1 inline h-2.5 w-2.5" /> {REPORT_STATUS_META[r.reportStatus].label}
                    </span>
                  )}
                </div>
                <div className="mt-0.5 flex items-center gap-2 text-[11.5px] text-outline">
                  {r.vendor && (
                    <span className="flex items-center gap-1">
                      <Store className="h-3 w-3" /> {r.vendor.companyName}
                    </span>
                  )}
                  {r.product && (
                    <span className="flex items-center gap-1">
                      <Package className="h-3 w-3" /> {r.product.name}
                    </span>
                  )}
                  <span>{fmtDate(r.createdAt)}</span>
                </div>
              </div>
              {r.rating && <StarRating value={r.rating} size="h-3.5 w-3.5" />}
            </div>

            <p className="mb-3 text-[13.5px] leading-5 text-on-surface-variant">{r.comment}</p>

            {r.images?.length > 0 && (
              <div className="mb-3 flex flex-wrap gap-2">
                {r.images.map((img, i) => (
                  <a key={i} href={`${api.defaults.baseURL}${img}`} target="_blank" rel="noreferrer" className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-lg border border-surface-container-high">
                    <img src={`${api.defaults.baseURL}${img}`} alt="" className="h-full w-full object-cover" />
                  </a>
                ))}
              </div>
            )}

            {r.vendorReply && (
              <div className="mb-3 rounded-md bg-surface-container p-3">
                <div className="mb-1 text-[12px] font-bold text-tertiary-accent">Respuesta de {r.vendor?.companyName}</div>
                <p className="text-[13px] leading-5 text-on-surface-variant">{r.vendorReply}</p>
              </div>
            )}

            {r.reportStatus === "REPORTED" && (
              <div className="mb-3 rounded-md border border-tertiary-accent/25 bg-tertiary-accent/[0.06] p-3">
                <div className="mb-1 flex items-center gap-1.5 text-[12px] font-bold text-tertiary-accent">
                  <Flag className="h-3 w-3" /> Reportado por {r.reportedBy?.role === "VENDOR" ? "el vendedor de la tienda" : "un cliente"}
                  {r.reportedBy?.fullName ? ` (${r.reportedBy.fullName})` : ""}
                </div>
                {r.reportReason && <p className="mb-2.5 text-[13px] leading-5 text-on-surface-variant">Motivo: "{r.reportReason}"</p>}
                <div className="flex gap-2.5">
                  <button
                    onClick={() => resolveReport.mutate({ id: r.id, decision: "keep" })}
                    disabled={resolveReport.isPending}
                    className="flex items-center gap-1.5 rounded-md bg-verified px-3 py-1.5 text-[12.5px] font-bold text-white disabled:opacity-50"
                  >
                    <Check className="h-3.5 w-3.5" /> Mantener
                  </button>
                  <button
                    onClick={() => resolveReport.mutate({ id: r.id, decision: "suspend" })}
                    disabled={resolveReport.isPending}
                    className="flex items-center gap-1.5 rounded-md border border-error/30 bg-error/5 px-3 py-1.5 text-[12.5px] font-bold text-error disabled:opacity-50"
                  >
                    <Ban className="h-3.5 w-3.5" /> Suspender
                  </button>
                </div>
              </div>
            )}

            <div className="flex gap-2.5 border-t border-surface-container pt-3">
              <button
                onClick={() => toggleHidden.mutate({ id: r.id, isHidden: !r.isHidden })}
                disabled={toggleHidden.isPending}
                className="flex items-center gap-1.5 rounded-full border border-outline-variant px-3 py-1.5 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-50"
              >
                {r.isHidden ? <Eye className="h-3.5 w-3.5" /> : <EyeOff className="h-3.5 w-3.5" />}
                {r.isHidden ? "Mostrar" : "Ocultar"}
              </button>
              <button
                onClick={() => setConfirmDelete(r)}
                className="flex items-center gap-1.5 rounded-md border border-error/30 bg-error/5 px-3 py-1.5 text-[12.5px] font-bold text-error"
              >
                <Trash2 className="h-3.5 w-3.5" /> Eliminar
              </button>
            </div>
          </div>
        ))}
      </div>

      {confirmDelete && (
        <ConfirmDeleteModal
          title="¿Eliminar este comentario?"
          description="Se borra por completo, junto con la respuesta del vendedor si tenía una."
          pending={deleteReview.isPending}
          onConfirm={() => deleteReview.mutate(confirmDelete.id)}
          onCancel={() => setConfirmDelete(null)}
        />
      )}
    </div>
  );
}
