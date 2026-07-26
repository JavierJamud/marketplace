import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { ShieldCheck, EyeOff, Eye, Trash2, Store, Package } from "lucide-react";
import { api } from "../../lib/api.js";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { StarRating } from "../../components/ui/StarRating.jsx";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
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
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Comentarios</h1>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Todos los comentarios y reseñas del sitio. Ocultar es reversible (deja de verse en la tienda y en el panel del vendedor, pero
        puedes volver a mostrarlo); eliminar es definitivo.
      </p>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
      {!isLoading && !reviews?.length && <p className="text-body-md text-on-surface-variant">Todavía no hay comentarios en el sitio.</p>}

      <div className="flex flex-col gap-3.5">
        {reviews?.map((r) => (
          <div
            key={r.id}
            className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5"
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

            <div className="flex gap-2.5 border-t border-surface-container pt-3">
              <button
                onClick={() => toggleHidden.mutate({ id: r.id, isHidden: !r.isHidden })}
                disabled={toggleHidden.isPending}
                className="flex items-center gap-1.5 rounded-md border border-outline-variant px-3 py-1.5 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-50"
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
