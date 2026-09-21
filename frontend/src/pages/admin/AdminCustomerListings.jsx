import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Link } from "react-router-dom";
import toast from "../../lib/toast.jsx";
import { Zap } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";

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

  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Zap} tone="orange" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Venta rápida</h1>
      </div>
      <p className="mb-4 text-[13.5px] text-outline">
        Clientes sin tienda con anuncios de venta rápida publicados, agrupados por dueño. Vencen solos a los 30 días.
      </p>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}
      {!isLoading && owners.length === 0 && (
        <p className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-5 text-body-md text-on-surface-variant">
          Ningún cliente tiene anuncios de venta rápida por ahora.
        </p>
      )}

      <div className="flex flex-col gap-4">
        {owners.map((owner) => (
          <div key={owner.id} className="overflow-x-auto rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
            <div className="flex flex-wrap items-center justify-between gap-2 bg-surface-container-low px-[22px] py-3">
              <div>
                <span className="text-[14px] font-bold text-on-surface">{owner.fullName ?? owner.email}</span>
                <span className="ml-2 text-[12px] text-outline">{owner.email} · {owner.phone}</span>
              </div>
              <span className="text-[12px] font-semibold text-outline">{owner.customerListings.length}/5 anuncios</span>
            </div>
            <div className="grid grid-cols-[1.6fr_1fr_1fr_1fr_1.2fr] gap-3 px-[22px] py-2.5 text-[11px] font-bold uppercase tracking-wide text-outline min-w-[700px]">
              <span>Producto</span><span>Precio</span><span>Estado</span><span>Vence</span><span className="text-right">Acción</span>
            </div>
            {owner.customerListings.map((l) => (
              <div key={l.id} className="grid min-w-[700px] grid-cols-[1.6fr_1fr_1fr_1fr_1.2fr] items-center gap-3 border-t border-surface-container px-[22px] py-3">
                <span className="text-[13px] font-semibold text-on-surface">{l.name}</span>
                <span className="text-[13px] text-on-surface-variant">{formatPrice(l.price, l.currency)}</span>
                <span
                  className="w-fit rounded-full px-2.5 py-1 text-[11px] font-bold"
                  style={
                    l.isSold
                      ? { background: "rgba(35,47,62,0.1)", color: "#232F3E" }
                      : l.isActive
                        ? { background: "rgba(12,174,83,0.12)", color: "#0CAE53" }
                        : { background: "rgba(186,26,26,0.12)", color: "#ba1a1a" }
                  }
                >
                  {l.isSold ? "Vendido" : l.isActive ? "Activo" : "Suspendido/sin foto"}
                </span>
                <span className="text-[12.5px] text-on-surface-variant">{fmtDate(l.expiresAt)}</span>
                <div className="flex flex-wrap justify-end gap-1.5">
                  <Link to={`/ventas-rapidas/${l.id}`} target="_blank" className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant">
                    Ver
                  </Link>
                  <button
                    onClick={() => toggleActive.mutate({ id: l.id, isActive: !l.isActive })}
                    disabled={toggleActive.isPending}
                    className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant disabled:opacity-50"
                  >
                    {l.isActive ? "Suspender" : "Reactivar"}
                  </button>
                  <button
                    onClick={() => setDeleteTarget(l)}
                    className="rounded-[7px] bg-error px-2.5 py-1.5 text-[12px] font-semibold text-white"
                  >
                    Eliminar
                  </button>
                </div>
              </div>
            ))}
          </div>
        ))}
      </div>

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
