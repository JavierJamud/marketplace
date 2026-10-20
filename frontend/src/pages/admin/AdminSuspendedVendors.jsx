import { useState } from "react";
import { Link, Navigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { NotifyVendorCheckbox } from "../../components/admin/NotifyVendorCheckbox.jsx";
import { notifyVendorConfig } from "../../lib/notifyVendor.js";
import { CARD } from "../../components/dashboard/DashboardCard.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

// Tiendas bloqueadas a mano por un admin o suspendidas solas por 90 días sin entrar al panel. Antes era una página aparte
// del menú; ahora es el filtro "Suspendidas" de Tiendas (AdminVendors.jsx), que muestra esta lista.
function fmtDate(iso) {
  if (!iso) return "Sin dato";
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

export function useSuspendedVendors() {
  return useQuery({
    queryKey: ["admin-suspended-vendors"],
    queryFn: async () => (await api.get("/admin/vendors/suspended")).data.vendors,
  });
}

export function SuspendedVendorsList() {
  const queryClient = useQueryClient();
  const [reactivating, setReactivating] = useState(null);
  const [reason, setReason] = useState("");
  const [notifyVendor, setNotifyVendor] = useState(false);
  const { data, isLoading, isError, refetch } = useSuspendedVendors();

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["admin-suspended-vendors"] });
    queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
  };

  const reactivate = useMutation({
    mutationFn: async ({ id, reason }) => (await api.post(`/admin/vendors/${id}/reactivate`, { reason }, notifyVendorConfig(notifyVendor))).data,
    onSuccess: () => {
      toast.success("Tienda reactivada");
      invalidate();
      setReactivating(null);
      setReason("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo reactivar la tienda."),
  });

  const unblock = useMutation({
    mutationFn: async (id) => (await api.patch(`/admin/vendors/${id}`, { isBlocked: false })).data,
    onSuccess: () => {
      toast.success("Tienda desbloqueada");
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo desbloquear la tienda."),
  });

  const rows = data ?? [];

  return (
    <>
      <p className="mb-3 text-[12.5px] text-outline">Bloqueadas a mano por un admin o suspendidas solas por 90 días sin entrar al panel. No se ven en el sitio hasta desbloquearlas o reactivarlas.</p>
      <div className={CARD}>
        {isLoading && <ListSkeleton />}
        {isError && (
          <div className="flex flex-col items-center gap-2 p-6 text-center">
            <p className="text-body-md text-error">No se pudo cargar la lista.</p>
            <button type="button" onClick={() => refetch()} className="min-h-10 rounded-lg border border-outline-variant px-3 text-[13px] font-semibold">Reintentar</button>
          </div>
        )}
        {!isLoading && !isError && rows.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">No hay tiendas suspendidas ahora mismo.</p>}
        {rows.map((v) => {
          const isBlocked = v.isBlocked;
          return (
            <div key={v.id} className="flex flex-col gap-2 border-b border-surface-container px-4 py-3 last:border-b-0 md:flex-row md:items-center md:gap-4">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <span className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white" style={{ background: v.color ?? "#232F3E" }} aria-hidden="true">
                  {v.companyName[0]}
                </span>
                <div className="min-w-0">
                  <Link to={`/admin/tiendas/${v.id}`} className="block truncate text-[13.5px] font-semibold text-on-surface hover:underline">
                    {v.companyName}
                  </Link>
                  <div className="text-[11.5px] text-outline">
                    <span className={`mr-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-bold ${isBlocked ? "bg-error/10 text-error" : "bg-secondary/10 text-secondary"}`}>{isBlocked ? "Bloqueada" : "Suspendida"}</span>
                    desde {fmtDate(isBlocked ? v.blockedAt : v.suspendedAt)} · entró por última vez {fmtDate(v.user?.lastLoginAt)}
                  </div>
                </div>
              </div>
              <p className="text-[12.5px] text-on-surface-variant md:max-w-[34%]">{(isBlocked ? v.blockReason : v.suspensionReason) ?? "Sin motivo registrado"}</p>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Link to={`/admin/tiendas/${v.id}`} className="flex min-h-10 items-center rounded-lg bg-surface-container px-3 text-[12.5px] font-semibold text-on-surface">
                  Gestionar
                </Link>
                {isBlocked && (
                  <button type="button" onClick={() => unblock.mutate(v.id)} disabled={unblock.isPending} className="min-h-10 rounded-lg bg-verified-dark px-3 text-[12.5px] font-semibold text-white disabled:opacity-50">
                    Desbloquear
                  </button>
                )}
                {v.status === "SUSPENDED" && (
                  <button
                    type="button"
                    onClick={() => {
                      setReactivating(v);
                      setReason("");
                      setNotifyVendor(false);
                    }}
                    className="min-h-10 rounded-lg bg-verified-dark px-3 text-[12.5px] font-semibold text-white"
                  >
                    Reactivar
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>

      <ConfirmModal
        open={!!reactivating}
        title={`¿Reactivar "${reactivating?.companyName}"?`}
        message="Vuelve a verse en todo el sitio y su dueño puede volver a entrar al panel. Se le avisa por correo con el motivo que escribas."
        confirmLabel={reactivate.isPending ? "Reactivando..." : "Sí, reactivar"}
        confirmDisabled={reason.trim().length < 5 || reactivate.isPending}
        onConfirm={() => reactivate.mutate({ id: reactivating.id, reason: reason.trim() })}
        onCancel={() => setReactivating(null)}
      >
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo de la reactivación (obligatorio)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
        <NotifyVendorCheckbox checked={notifyVendor} onChange={setNotifyVendor} />
      </ConfirmModal>
    </>
  );
}

// La dirección vieja sigue funcionando (marcadores, enlaces del asistente): lleva al filtro nuevo.
export default function AdminSuspendedVendors() {
  return <Navigate to="/admin/tiendas?status=suspended" replace />;
}
