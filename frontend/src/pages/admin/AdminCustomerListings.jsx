import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "../../lib/toast.jsx";
import { Zap, History, ImageOff, X } from "lucide-react";
import { imgUrl, thumbUrl } from "../../lib/imgUrl.js";
import { currencyCodesFor, currencyOption } from "../../lib/catalog.js";
import { Button } from "../../components/ui/Button.jsx";
import { UserHistoryModal } from "../../components/admin/UserHistoryModal.jsx";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

const CONDITION = [
  { value: "", label: "Sin indicar" },
  { value: "NEW", label: "Nuevo" },
  { value: "USED", label: "Usado" },
  { value: "REFURBISHED", label: "Reacondicionado" },
];
const field = "h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none focus:border-tertiary-accent";
const label = "mb-1 block text-[12.5px] font-bold text-on-surface";

// Miniatura del anuncio: la chica si existe, si no la grande, y un recuadro gris si no tiene fotos.
function ListingThumb({ images, className = "h-12 w-12" }) {
  const [src, setSrc] = useState(() => thumbUrl(images?.[0]));
  if (!images?.length || !src) {
    return (
      <span className={`flex flex-shrink-0 items-center justify-center rounded-lg bg-surface-container text-outline ${className}`} aria-hidden="true">
        <ImageOff className="h-4 w-4" />
      </span>
    );
  }
  return <img src={src} alt="" loading="lazy" onError={() => setSrc(imgUrl(images[0]))} className={`flex-shrink-0 rounded-lg object-cover ${className}`} />;
}

// Corregir un anuncio desde el admin (título, descripción, precio, estado y cantidad) y quitar fotos. El lugar y las fotos
// nuevas siguen siendo del dueño. Cada cambio pide el código de confirmación (CUSTOMER_CHANGE).
function EditListingModal({ listing, onClose, onSaved }) {
  const [form, setForm] = useState({
    name: listing.name,
    description: listing.description ?? "",
    price: String(listing.price),
    currency: listing.currency,
    condition: listing.condition ?? "",
    quantity: listing.quantity != null ? String(listing.quantity) : "",
  });
  const [images, setImages] = useState(listing.images ?? []);
  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  useEffect(() => {
    const onKey = (e) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  const save = useMutation({
    mutationFn: async () =>
      (
        await api.patch(`/admin/customer-listings/${listing.id}`, {
          name: form.name.trim(),
          description: form.description.trim(),
          price: Number(form.price),
          currency: form.currency,
          condition: form.condition || null,
          quantity: form.quantity === "" ? null : Number(form.quantity),
        })
      ).data,
    onSuccess: () => {
      toast.success("Anuncio actualizado.");
      onSaved();
      onClose();
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudo guardar el anuncio.");
    },
  });
  const removeImage = useMutation({
    mutationFn: async (url) => (await api.delete(`/admin/customer-listings/${listing.id}/images`, { data: { url } })).data,
    onSuccess: ({ listing: updated }) => {
      setImages(updated.images);
      onSaved();
      toast.success(updated.images.length ? "Foto quitada." : "Foto quitada. Sin fotos, el anuncio deja de mostrarse.");
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudo quitar la foto.");
    },
  });

  const price = Number(form.price);
  const errors = {
    name: form.name.trim().length < 2 ? "Escribe un título." : null,
    description: form.description.trim().length < 10 ? "La descripción necesita al menos 10 caracteres." : null,
    price: !(price > 0) ? "Escribe un precio mayor que 0." : null,
    quantity: form.quantity !== "" && !(Number.isInteger(Number(form.quantity)) && Number(form.quantity) >= 1) ? "La cantidad es un número entero desde 1." : null,
  };
  const invalid = Object.values(errors).some(Boolean);

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-inverse-surface/40 sm:items-center sm:p-4 p-4" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div role="dialog" aria-modal="true" aria-labelledby="edit-listing-title" className="modal-panel flex w-full max-w-lg flex-col rounded-t-2xl bg-surface-container-lowest sm:rounded-2xl">
        <div className="flex items-center justify-between gap-3 border-b border-surface-container-high px-5 py-3">
          <h2 id="edit-listing-title" className="text-[16px] font-extrabold text-on-surface">Editar anuncio</h2>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 items-center justify-center rounded-full text-outline hover:bg-surface-container">
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="flex-1 space-y-4 overflow-y-auto px-5 py-4">
          <div>
            <span className={label}>Fotos</span>
            {images.length === 0 ? (
              <p className="text-[12.5px] text-on-surface-variant">No tiene fotos. El dueño tiene que subir al menos una para que el anuncio se muestre.</p>
            ) : (
              <ul className="flex flex-wrap gap-3 pt-1">
                {images.map((url) => (
                  <li key={url} className="relative">
                    <img src={imgUrl(url)} alt="" className="h-20 w-20 rounded-lg object-cover" />
                    <button
                      type="button"
                      onClick={() => removeImage.mutate(url)}
                      disabled={removeImage.isPending}
                      aria-label="Quitar esta foto"
                      className="absolute -right-2 -top-2 flex h-8 w-8 items-center justify-center rounded-full bg-error text-white shadow disabled:opacity-50"
                    >
                      <X className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <div>
            <label htmlFor="el-name" className={label}>Título</label>
            <input id="el-name" value={form.name} onChange={set("name")} maxLength={80} className={field} />
            {errors.name && <p className="mt-1 text-[12px] text-error">{errors.name}</p>}
          </div>
          <div>
            <label htmlFor="el-desc" className={label}>Descripción</label>
            <textarea id="el-desc" value={form.description} onChange={set("description")} maxLength={1000} rows={4} className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-[13.5px] outline-none focus:border-tertiary-accent" />
            <p className={`mt-1 text-[12px] ${errors.description ? "text-error" : "text-outline"}`}>{errors.description ?? `${form.description.length} de 1000`}</p>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label htmlFor="el-price" className={label}>Precio</label>
              <input id="el-price" type="number" inputMode="decimal" min="0" step="any" value={form.price} onChange={set("price")} className={field} />
              {errors.price && <p className="mt-1 text-[12px] text-error">{errors.price}</p>}
            </div>
            <div>
              <label htmlFor="el-currency" className={label}>Moneda</label>
              <select id="el-currency" value={form.currency} onChange={set("currency")} className={field}>
                {currencyCodesFor(listing.currency).map((c) => (
                  <option key={c} value={c}>{currencyOption(c)}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="el-condition" className={label}>Estado del artículo</label>
              <select id="el-condition" value={form.condition} onChange={set("condition")} className={field}>
                {CONDITION.map((c) => (
                  <option key={c.value} value={c.value}>{c.label}</option>
                ))}
              </select>
            </div>
            <div>
              <label htmlFor="el-qty" className={label}>Cantidad</label>
              <input id="el-qty" type="number" inputMode="numeric" min="1" value={form.quantity} onChange={set("quantity")} placeholder="Sin indicar" className={field} />
              {errors.quantity && <p className="mt-1 text-[12px] text-error">{errors.quantity}</p>}
            </div>
          </div>
          <p className="text-[12px] text-outline">El lugar y las fotos nuevas los cambia el dueño desde su cuenta.</p>
        </div>
        <div className="flex gap-2 border-t border-surface-container-high px-5 py-3">
          <Button variant="outline" className="flex-1" onClick={onClose}>Cancelar</Button>
          <Button className="flex-1" disabled={invalid || save.isPending} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando..." : "Guardar cambios"}
          </Button>
        </div>
      </div>
    </div>,
    document.body
  );
}

// Pedido explícito: el admin debe poder ver qué clientes SIN tienda tienen
// productos de venta rápida en venta — agrupado por dueño, no una lista
// suelta de anuncios (calco del patrón de AdminSuspendedVendors.jsx).
export default function AdminCustomerListings() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [historyUserId, setHistoryUserId] = useState(null);
  const [editTarget, setEditTarget] = useState(null);

  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin-customer-listings"],
    queryFn: async () => (await api.get("/admin/customer-listings")).data.owners,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["admin-customer-listings"] });

  const toggleActive = useMutation({
    mutationFn: async ({ id, isActive }) => (await api.patch(`/admin/customer-listings/${id}`, { isActive })).data,
    onSuccess: (_, { isActive }) => {
      toast.success(isActive ? "Anuncio reactivado." : "Anuncio suspendido.");
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el anuncio."),
  });

  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/admin/customer-listings/${id}`)).data,
    onSuccess: () => {
      toast.success("Anuncio eliminado.");
      setDeleteTarget(null);
      invalidate();
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar el anuncio.");
      setDeleteTarget(null);
    },
  });

  const owners = data ?? [];
  // Plazos y tope reales de la configuración (antes "30 días" y "/5" fijos en el texto).
  const { data: settings } = useQuery({ queryKey: ["site-settings"], queryFn: async () => (await api.get("/settings")).data.settings, staleTime: 5 * 60 * 1000 });
  const visibleDays = settings?.listingPublicVisibilityDays;
  const expiryDays = settings?.listingExpiryDays;
  const maxListings = settings?.maxActiveListingsPerCustomer;
  const hiddenCount = owners.reduce((n, o) => n + o.customerListings.filter((l) => !l.visibility?.visible).length, 0);

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Zap} tone="orange" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Venta rápida</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">
        Clientes sin tienda con anuncios de venta rápida, agrupados por dueño.
        {visibleDays && expiryDays ? ` Se muestran al público ${visibleDays} días y se borran solos a los ${expiryDays}.` : ""}
      </p>
      {hiddenCount > 0 && (
        <p className="mb-4 rounded-xl border border-outline-variant bg-surface-container-low px-4 py-2.5 text-[12.5px] text-on-surface-variant">
          {hiddenCount === 1 ? "1 anuncio no lo ve el público" : `${hiddenCount} anuncios no los ve el público`}. En cada uno dice por qué.
        </p>
      )}

      {isLoading && <ListSkeleton />}
      {/* Sin esto, un fallo del servidor se leía como "ningún cliente tiene anuncios" y el admin no sabía que faltaban datos. */}
      {isError && !data && (
        <div className="flex flex-col items-center gap-3 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-6 text-center">
          <p className="text-body-md text-error">No se pudieron cargar los anuncios de venta rápida.</p>
          <Button variant="outline" onClick={() => refetch()} disabled={isFetching}>
            {isFetching ? "Reintentando..." : "Reintentar"}
          </Button>
        </div>
      )}
      {!isLoading && data && owners.length === 0 && (
        <p className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-5 text-body-md text-on-surface-variant">
          Ningún cliente tiene anuncios de venta rápida por ahora.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {owners.map((owner) => (
          <div key={owner.id} className="overflow-hidden rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-container-low px-[22px] py-3">
              <div className="min-w-0">
                <span className="text-[14px] font-bold text-on-surface">{owner.fullName ?? owner.email}</span>
                {/* Cuenta eliminada: su correo real (el de la cuenta pasa a deleted+...@zeudin.invalid). */}
                <span className="block break-all text-[12px] text-outline sm:ml-2 sm:inline">
                  {owner.deletedAt ? owner.deletedEmail ?? "Correo no guardado" : owner.email} · {owner.phone}
                </span>
                {(owner.deletedAt || owner.isSuspended) && (
                  <span className="mt-1 inline-block rounded-full bg-error/10 px-2 py-0.5 text-[11px] font-bold text-error sm:ml-2">
                    {owner.deletedAt ? "Cuenta eliminada" : "Cuenta bloqueada"}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setHistoryUserId(owner.id)}
                className="inline-flex min-h-11 items-center gap-1.5 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[12px] font-semibold text-on-surface hover:bg-surface-container md:min-h-9"
              >
                <History className="h-3.5 w-3.5" /> Ver historial
              </button>
              <span className="text-[12px] font-semibold text-outline">
                {owner.customerListings.length}
                {maxListings ? `/${maxListings}` : ""} anuncios
              </span>
              </div>
            </div>
            {/* En el celular cada anuncio es una tarjeta (antes era una tabla de 700px que escondía el estado y los botones). */}
            <div className="hidden grid-cols-[2fr_0.9fr_1fr_0.9fr_1.4fr] gap-3 px-[22px] py-2.5 text-[11px] font-bold uppercase tracking-wide text-outline md:grid">
              <span>Producto</span><span>Precio</span><span>Para el público</span><span>Se borra</span><span className="text-right">Acción</span>
            </div>
            {owner.customerListings.map((l) => (
              <div key={l.id} className="flex flex-col gap-2 border-t border-surface-container px-4 py-3 md:grid md:grid-cols-[2fr_0.9fr_1fr_0.9fr_1.4fr] md:items-center md:gap-3 md:px-[22px]">
                <div className="flex items-center justify-between gap-3 md:contents">
                  <span className="flex min-w-0 items-center gap-3">
                    <ListingThumb key={l.images?.[0] ?? "sin-foto"} images={l.images} />
                    <span className="min-w-0 text-[13px] font-semibold text-on-surface">{l.name}</span>
                  </span>
                  <span className="flex-shrink-0 text-[13px] text-on-surface-variant">{formatPrice(l.price, l.currency)}</span>
                </div>
                <div className="flex flex-wrap items-center gap-2 md:contents">
                {/* Lo mismo que filtra la página pública (backend lib/publicVisibility.js): "Visible" solo si de verdad se ve. */}
                <span className="min-w-0">
                  <span
                    className={`inline-block w-fit rounded-full px-2.5 py-1 text-[11px] font-bold ${
                      l.visibility?.visible ? "bg-verified/10 text-verified-dark" : "bg-error/10 text-error"
                    }`}
                  >
                    {l.visibility?.visible ? "Visible" : "Oculto"}
                  </span>
                  {l.visibility?.visible ? (
                    <span className="mt-0.5 block text-[11.5px] text-outline">Hasta el {fmtDate(l.publicVisibleUntil)}</span>
                  ) : (
                    <span className="mt-0.5 block text-[11.5px] text-on-surface-variant">{l.visibility?.hidden.join(" · ")}</span>
                  )}
                </span>
                <span className="text-[12.5px] text-on-surface-variant"><span className="md:hidden">Se borra: </span>{fmtDate(l.expiresAt)}</span>
                </div>
                <div className="flex flex-wrap gap-1.5 md:justify-end">
                  {/* La ficha pública solo existe si el anuncio se ve; si no, el enlace daría "no encontrado". */}
                  {l.visibility?.visible && (
                    <Link to={`/ventas-rapidas/${l.id}`} target="_blank" className="inline-flex min-h-11 items-center rounded-[7px] bg-surface-container px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant md:min-h-9">
                      Ver
                    </Link>
                  )}
                  <button onClick={() => setEditTarget(l)} className="min-h-11 rounded-[7px] bg-surface-container px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant md:min-h-9">
                    Editar
                  </button>
                  <button
                    onClick={() => toggleActive.mutate({ id: l.id, isActive: !l.isActive })}
                    disabled={toggleActive.isPending}
                    className="min-h-11 rounded-[7px] bg-surface-container px-3 py-1.5 text-[12px] font-semibold text-on-surface-variant disabled:opacity-50 md:min-h-9"
                  >
                    {l.isActive ? "Suspender" : "Reactivar"}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(l)}
                    className="min-h-11 rounded-[7px] bg-error px-3 py-1.5 text-[12px] font-semibold text-white md:min-h-9"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

      {historyUserId && <UserHistoryModal userId={historyUserId} onClose={() => setHistoryUserId(null)} />}
      {editTarget && <EditListingModal listing={editTarget} onClose={() => setEditTarget(null)} onSaved={invalidate} />}
      <ConfirmModal
        open={!!deleteTarget}
        title={`¿Eliminar "${deleteTarget?.name}"?`}
        message="Se elimina para siempre, junto con sus fotos. El cliente no puede deshacerlo; avísale si corresponde."
        confirmLabel={remove.isPending ? "Eliminando..." : "Sí, eliminar"}
        danger
        onConfirm={() => remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
