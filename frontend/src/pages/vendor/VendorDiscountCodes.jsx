import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Percent, Plus, Pencil, Trash2, Power } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { DiscountCodeFormModal } from "../../components/vendor/DiscountCodeFormModal.jsx";

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

function valueLabel(c) {
  return c.type === "PERCENTAGE" ? `${Number(c.value)}%` : `${Number(c.value).toLocaleString("es-CU")} CUP`;
}

function vigenciaLabel(c) {
  if (!c.expiresAt) return "Sin vencimiento";
  const expired = new Date(c.expiresAt) < new Date();
  return `${expired ? "Venció" : "Vence"} el ${fmtDate(c.expiresAt)}`;
}

export default function VendorDiscountCodes() {
  const queryClient = useQueryClient();
  const [formTarget, setFormTarget] = useState(null); // null = cerrado, {} = crear, code = editar
  const [deleteTarget, setDeleteTarget] = useState(null);

  const { data: discountCodes, isLoading } = useQuery({
    queryKey: ["my-discount-codes"],
    queryFn: async () => (await api.get("/discount-codes/me/list")).data.discountCodes,
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }) => (await api.patch(`/discount-codes/${id}`, { active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["my-discount-codes"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el código."),
  });

  const remove = useMutation({
    mutationFn: async (id) => (await api.delete(`/discount-codes/${id}`)).data,
    onSuccess: () => {
      toast.success("Código eliminado.");
      setDeleteTarget(null);
      queryClient.invalidateQueries({ queryKey: ["my-discount-codes"] });
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo eliminar el código.");
      setDeleteTarget(null);
    },
  });

  return (
    <div>
      <div className="mb-1 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-[25px] font-bold text-on-surface">Códigos de descuento</h1>
        <Button className="rounded-xl font-bold" onClick={() => setFormTarget({})}>
          <Plus className="mr-1 h-4 w-4" /> Crear código
        </Button>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Códigos que tus clientes pueden aplicar en el carrito para llevarse un descuento. Un código ya usado no se puede
        editar ni eliminar — solo activar o desactivar.
      </p>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      {!isLoading && !discountCodes?.length && (
        <EmptyState
          icon={Percent}
          title="Todavía no creaste ningún código"
          description="Crea uno con porcentaje o monto fijo en CUP, con o sin límite de usos ni vencimiento."
        />
      )}

      {discountCodes?.length > 0 && (
        <div className="overflow-x-auto rounded-2xl border border-surface-container-high bg-surface-container-lowest">
          <table className="w-full text-left text-[13px]">
            <thead>
              <tr className="border-b border-surface-container-high text-[11.5px] font-bold uppercase tracking-wide text-outline">
                <th className="px-4 py-3">Código</th>
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
                  <td className="px-4 py-3 text-on-surface-variant">{valueLabel(c)}</td>
                  <td className="px-4 py-3 text-on-surface-variant">{vigenciaLabel(c)}</td>
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
                        title={c.active ? "Desactivar" : "Activar"}
                        className="flex items-center gap-1 text-[12px] font-semibold text-tertiary-accent hover:underline disabled:opacity-50"
                      >
                        <Power className="h-3.5 w-3.5" /> {c.active ? "Desactivar" : "Activar"}
                      </button>
                      {c.usesCount === 0 && (
                        <>
                          <button
                            onClick={() => setFormTarget(c)}
                            className="flex items-center gap-1 text-[12px] font-semibold text-tertiary-accent hover:underline"
                          >
                            <Pencil className="h-3.5 w-3.5" /> Editar
                          </button>
                          <button
                            onClick={() => setDeleteTarget(c)}
                            className="flex items-center gap-1 text-[12px] font-semibold text-error hover:underline"
                          >
                            <Trash2 className="h-3.5 w-3.5" /> Eliminar
                          </button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {formTarget && (
        <DiscountCodeFormModal
          code={formTarget.id ? formTarget : null}
          onClose={() => setFormTarget(null)}
          onSaved={() => {
            setFormTarget(null);
            queryClient.invalidateQueries({ queryKey: ["my-discount-codes"] });
          }}
        />
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
