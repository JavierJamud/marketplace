import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "../../lib/toast.jsx";
import { Zap, History } from "lucide-react";
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

// Pedido explícito: el admin debe poder ver qué clientes SIN tienda tienen
// productos de venta rápida en venta — agrupado por dueño, no una lista
// suelta de anuncios (calco del patrón de AdminSuspendedVendors.jsx).
export default function AdminCustomerListings() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [historyUserId, setHistoryUserId] = useState(null);

  const { data, isLoading } = useQuery({
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
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Venta rápida</h1>
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
      {!isLoading && owners.length === 0 && (
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
            <div className="hidden grid-cols-[1.6fr_1fr_1fr_1fr_1.2fr] gap-3 px-[22px] py-2.5 text-[11px] font-bold uppercase tracking-wide text-outline md:grid">
              <span>Producto</span><span>Precio</span><span>Para el público</span><span>Se borra</span><span className="text-right">Acción</span>
            </div>
            {owner.customerListings.map((l) => (
              <div key={l.id} className="flex flex-col gap-2 border-t border-surface-container px-4 py-3 md:grid md:grid-cols-[1.6fr_1fr_1fr_1fr_1.2fr] md:items-center md:gap-3 md:px-[22px]">
                <div className="flex items-baseline justify-between gap-3 md:contents">
                  <span className="min-w-0 text-[13px] font-semibold text-on-surface">{l.name}</span>
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
      <ConfirmModal
        open={!!deleteTarget}
        title={`¿Eliminar "${deleteTarget?.name}"?`}
        message="Se elimina para siempre, junto con sus fotos. El cliente no puede deshacer esto — avisale si corresponde."
        confirmLabel={remove.isPending ? "Eliminando..." : "Sí, eliminar"}
        danger
        onConfirm={() => remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
