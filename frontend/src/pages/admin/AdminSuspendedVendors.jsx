import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { api } from "../../lib/api.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

function fmtDate(iso) {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

// Bloque 62: separada de AdminVendors.jsx a propósito — acá lo que importa
// es la razón/fecha de la suspensión automática (vendorLifecycle.job.js) y
// la reactivación exige un motivo (auditoría real vía VendorStatusLog), a
// diferencia del bloqueo manual de AdminVendors.jsx que es reversible con un
// clic sin explicación.
export default function AdminSuspendedVendors() {
  const queryClient = useQueryClient();
  const [reactivating, setReactivating] = useState(null);
  const [reason, setReason] = useState("");

  const { data, isLoading } = useQuery({
    queryKey: ["admin-suspended-vendors"],
    queryFn: async () => (await api.get("/admin/vendors/suspended")).data.vendors,
  });

  const reactivate = useMutation({
    mutationFn: async ({ id, reason }) => (await api.post(`/admin/vendors/${id}/reactivate`, { reason })).data,
    onSuccess: () => {
      toast.success("Tienda reactivada — se le avisó por correo.");
      queryClient.invalidateQueries({ queryKey: ["admin-suspended-vendors"] });
      queryClient.invalidateQueries({ queryKey: ["admin-vendors"] });
      setReactivating(null);
      setReason("");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo reactivar la tienda."),
  });

  const rows = data ?? [];

  return (
    <div>
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Tiendas suspendidas</h1>
      <p className="mb-4 text-[13.5px] text-outline">
        Suspendidas automáticamente por 90 días sin acceso al panel de vendedor. Ocultas de todo el sitio hasta reactivarlas.
      </p>

      <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        <div className="grid grid-cols-[2fr_1.3fr_1.3fr_2.2fr_1fr] gap-3 bg-surface-container-low px-[22px] py-3.5 text-[11.5px] font-bold uppercase tracking-wide text-outline">
          <span>Tienda</span><span>Suspendida el</span><span>Último acceso</span><span>Motivo</span><span className="text-right">Acción</span>
        </div>
        {isLoading && <p className="p-5 text-body-md text-on-surface-variant">Cargando...</p>}
        {!isLoading && rows.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">No hay tiendas suspendidas ahora mismo.</p>}
        {rows.map((v) => (
          <div key={v.id} className="grid grid-cols-[2fr_1.3fr_1.3fr_2.2fr_1fr] items-center gap-3 border-t border-surface-container px-[22px] py-3.5">
            <div className="flex items-center gap-2.5">
              <span
                className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white"
                style={{ background: v.color ?? "#232F3E" }}
              >
                {v.companyName[0]}
              </span>
              <div>
                <span className="text-[13.5px] font-semibold text-on-surface">{v.companyName}</span>
                <div className="text-[11.5px] text-outline">{v.locations?.[0]?.province?.name ?? "—"}</div>
              </div>
            </div>
            <span className="text-[13px] text-on-surface-variant">{fmtDate(v.suspendedAt)}</span>
            <span className="text-[13px] text-on-surface-variant">{fmtDate(v.user?.lastLoginAt)}</span>
            <span className="text-[12.5px] text-on-surface-variant">{v.suspensionReason ?? "—"}</span>
            <div className="flex flex-wrap justify-end gap-1.5">
              <Link to={`/tienda/${v.slug}`} target="_blank" className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant">
                Ver
              </Link>
              <button
                onClick={() => { setReactivating(v); setReason(""); }}
                className="rounded-[7px] bg-verified-dark px-2.5 py-1.5 text-[12px] font-semibold text-white"
              >
                Reactivar
              </button>
            </div>
          </div>
        ))}
      </div>

      <ConfirmModal
        open={!!reactivating}
        title={`¿Reactivar "${reactivating?.companyName}"?`}
        message="Vuelve a ser visible en todo el sitio y su dueño puede volver a entrar al panel de vendedor. Se le avisa por correo con el motivo que escribas abajo."
        confirmLabel={reactivate.isPending ? "Reactivando..." : "Sí, reactivar"}
        confirmDisabled={reason.trim().length < 5 || reactivate.isPending}
        onConfirm={() => reactivate.mutate({ id: reactivating.id, reason: reason.trim() })}
        onCancel={() => setReactivating(null)}
      >
        <textarea
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Motivo de la reactivación (obligatorio, se envía al vendedor)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>
    </div>
  );
}
