import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Percent, Power, Trash2 } from "lucide-react";
import { api } from "../../lib/api.js";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

function valueLabel(c) {
  return c.type === "PERCENTAGE" ? `${Number(c.value)}%` : `${Number(c.value).toLocaleString("es-CU")} CUP`;
}

// Auditoría de seguridad: antes NO había ninguna supervisión de admin sobre
// los códigos de descuento de los vendedores (Bloque 52) — la única forma de
// desactivar uno abusivo era entrar a Prisma Studio a mano. Mismas reglas que
// VendorDiscountCodes.jsx (activar/desactivar siempre permitido; eliminar
// solo si nunca se usó), acá sobre CUALQUIER vendedor.
export default function AdminDiscountCodes() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: discountCodes, isLoading } = useQuery({
    queryKey: ["admin-discount-codes"],
    queryFn: async () => (await api.get("/admin/discount-codes")).data.discountCodes,
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }) => (await api.patch(`/admin/discount-codes/${id}/active`, { active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-discount-codes"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el código."),
  });

  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/admin/discount-codes/${id}`)).data,
    onSuccess: () => {
      toast.success("Código eliminado.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["admin-discount-codes"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar el código.");
      setDeleteTarget(null);
    },
  });

  return (
    <div className="max-w-[900px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Códigos de descuento</h1>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Códigos de descuento de todos los vendedores. Puedes desactivar uno abusivo, o eliminarlo si nunca se usó.
      </p>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      {!isLoading && !discountCodes?.length && (
        <EmptyState icon={Percent} title="Todavía no hay códigos de descuento" description="Los códigos que creen los vendedores van a aparecer acá." />
      )}

      {discountCodes?.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-surface-container-high bg-surface-container-lowest">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-surface-container-high text-[11.5px] font-bold uppercase tracking-wide text-outline">
                <th className="px-4 py-3">Código</th>
                <th className="px-4 py-3">Tienda</th>
                <th className="px-4 py-3">Tipo</th>
                <th className="px-4 py-3">Vigencia</th>
                <th className="px-4 py-3">Usos</th>
                <th className="px-4 py-3">Estado</th>
                <th className="px-4 py-3">Acciones</th>
              </tr>
            </thead>
            <tbody>
              {discountCodes.map((c) => (
                <tr key={c.id} className="border-b border-surface-container last:border-b-0">
                  <td className="px-4 py-3 font-mono font-bold text-on-surface">{c.code}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{c.vendor?.companyName}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{valueLabel(c)}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{c.expiresAt ? `Vence el ${fmtDate(c.expiresAt)}` : "Sin vencimiento"}</td>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {c.usesCount}
                    {c.maxUses != null ? ` / ${c.maxUses}` : " / ∞"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                        c.active ? "bg-verified/10 text-verified-dark" : "bg-surface-container-high text-outline"
                      }`}
                    >
                      {c.active ? "Activo" : "Inactivo"}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => toggleActive.mutate({ id: c.id, active: !c.active })}
                        disabled={toggleActive.isPending}
                        className="flex items-center gap-1 text-[12px] font-semibold text-tertiary-accent hover:underline disabled:opacity-50"
                      >
                        <Power className="h-3.5 w-3.5" /> {c.active ? "Desactivar" : "Activar"}
                      </button>
                      {c.usesCount === 0 && (
                        <button
                          onClick={() => setDeleteTarget(c)}
                          className="flex items-center gap-1 text-[12px] font-semibold text-error hover:underline"
                        >
                          <Trash2 className="h-3.5 w-3.5" /> Eliminar
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <ConfirmModal
        open={!!deleteTarget}
        title="¿Eliminar este código?"
        message="Se borra por completo. Solo se puede eliminar un código que nunca fue usado."
        confirmLabel={remove.isPending ? "Eliminando..." : "Eliminar"}
        danger
        confirmDisabled={remove.isPending}
        onConfirm={() => remove.mutate(deleteTarget.id)}
        onCancel={() => setDeleteTarget(null)}
      />
    </div>
  );
}
