import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Percent, Power, Trash2 } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

function fmtDate(iso) {
  if (!iso) return null;
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

// El monto fijo va en la moneda del código (DiscountCode.currency): un código en USD solo descuenta productos en USD, así
// que mostrarlo en CUP era un dato falso. Mismo criterio que AdminStoreOffers.jsx.
function valueLabel(c) {
  return c.type === "PERCENTAGE" ? `${Number(c.value)}%` : `${Number(c.value).toLocaleString("es-CU")} ${c.currency ?? "CUP"}`;
}

// Vigencia en una línea: un código que todavía no empieza no se aplica en el carrito aunque esté activo, así que la fecha
// de inicio se ve cuando es futura. Uno vencido dice "Venció" (no "Vence", que se leía como vigente).
function validityLabel(c, now = Date.now()) {
  const parts = [];
  if (c.startsAt && new Date(c.startsAt).getTime() > now) parts.push(`Empieza el ${fmtDate(c.startsAt)}`);
  if (c.expiresAt) parts.push(`${new Date(c.expiresAt).getTime() <= now ? "Venció" : "Vence"} el ${fmtDate(c.expiresAt)}`);
  return parts.length ? parts.join(" · ") : "Sin vencimiento";
}

// Auditoría de seguridad: antes NO había ninguna supervisión de admin sobre
// los códigos de descuento de los vendedores (Bloque 52) — la única forma de
// desactivar uno abusivo era entrar a Prisma Studio a mano. Eliminar sigue la
// regla de la tienda (solo si nunca se usó). Para apagar, el admin suspende:
// antes solo desactivaba y la tienda lo volvía a activar al minuto. Quitar la
// suspensión lo deja desactivado y la tienda decide si lo activa otra vez.
export default function AdminDiscountCodes() {
  const queryClient = useQueryClient();
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [suspending, setSuspending] = useState(null);
  const [reason, setReason] = useState("");

  const { data: discountCodes, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ["admin-discount-codes"],
    queryFn: async () => (await api.get("/admin/discount-codes")).data.discountCodes,
  });

  const setSuspended = useMutation({
    mutationFn: async ({ id, active, reason }) => (await api.patch(`/admin/discount-codes/${id}/active`, { active, reason })).data,
    onSuccess: (_data, vars) => {
      toast.success(vars.active ? "Suspensión quitada. La tienda puede volver a activarlo." : "Código suspendido. La tienda no puede reactivarlo.");
      closeSuspend();
      queryClient.invalidateQueries({ queryKey: ["admin-discount-codes"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar el código."),
  });

  function closeSuspend() {
    setSuspending(null);
    setReason("");
  }

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
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Percent} tone="orange" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Códigos de descuento</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Códigos de descuento de todos los vendedores. Puedes suspender uno abusivo (la tienda no puede reactivarlo hasta que
        quites la suspensión), o eliminarlo si nunca se usó.
      </p>

      {isLoading && <ListSkeleton />}

      {isError && !discountCodes && (
        <div className="flex flex-wrap items-center gap-3 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
          <p className="text-[13px] text-error">No se pudieron cargar los códigos de descuento.</p>
          <button
            onClick={() => refetch()}
            disabled={isFetching}
            className="min-h-11 rounded-lg border border-outline-variant px-4 text-[13px] font-semibold text-on-surface hover:bg-surface-container disabled:opacity-50"
          >
            {isFetching ? "Reintentando..." : "Reintentar"}
          </button>
        </div>
      )}

      {!isLoading && !isError && !discountCodes?.length && (
        <EmptyState icon={Percent} title="Todavía no hay códigos de descuento" description="Los códigos que creen los vendedores van a aparecer aquí." />
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
                  <td className="px-4 py-3 text-on-surface-variant">{validityLabel(c)}</td>
                  <td className="px-4 py-3 text-on-surface-variant">
                    {c.usesCount}
                    {c.maxUses != null ? ` / ${c.maxUses}` : " / ∞"}
                  </td>
                  <td className="px-4 py-3">
                    <span
                      className={`whitespace-nowrap rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                        c.suspendedAt ? "bg-error/10 text-error" : c.active ? "bg-verified/10 text-verified-dark" : "bg-surface-container-high text-outline"
                      }`}
                    >
                      {c.suspendedAt ? "Suspendido" : c.active ? "Activo" : "Inactivo"}
                    </span>
                    {c.suspendedAt && c.suspendedReason && <p className="mt-1.5 max-w-[220px] text-[11.5px] text-error">Motivo: {c.suspendedReason}</p>}
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-3">
                      <button
                        onClick={() => (c.suspendedAt ? setSuspended.mutate({ id: c.id, active: true }) : setSuspending(c))}
                        disabled={setSuspended.isPending}
                        className="flex min-h-11 items-center gap-1 whitespace-nowrap text-[12px] font-semibold text-tertiary-accent hover:underline disabled:opacity-50"
                      >
                        <Power className="h-3.5 w-3.5" /> {c.suspendedAt ? "Quitar suspensión" : "Suspender"}
                      </button>
                      {c.usesCount === 0 && (
                        <button
                          onClick={() => setDeleteTarget(c)}
                          className="flex min-h-11 items-center gap-1 text-[12px] font-semibold text-error hover:underline"
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
        open={!!suspending}
        title={`¿Suspender el código ${suspending?.code ?? ""}?`}
        message="Deja de aplicarse en el carrito y la tienda no puede reactivarlo hasta que quites la suspensión."
        confirmLabel={setSuspended.isPending ? "Suspendiendo..." : "Sí, suspender"}
        danger
        confirmDisabled={setSuspended.isPending}
        onConfirm={() => setSuspended.mutate({ id: suspending.id, active: false, reason: reason.trim() || null })}
        onCancel={closeSuspend}
      >
        <label htmlFor="dc-reason" className="mb-1.5 block text-label-md text-on-surface-variant">
          Motivo para la tienda (opcional)
        </label>
        <textarea
          id="dc-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder="Ej.: el código se está compartiendo en otras webs."
          className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-[13.5px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>

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
