import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Gift, Power, ShieldAlert } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

function discountLabel(code) {
  if (!code) return "";
  return code.type === "PERCENTAGE" ? `-${Number(code.value)}%` : `-${Number(code.value).toLocaleString("es-CU")} ${code.currency ?? "CUP"}`;
}

// Bloque 52: "cuántas ofertas activas puede tener cada tienda" pasó a ser un
// límite POR PLAN (PlanConfig.maxActiveStoreOffers, antes un único valor
// global en SiteSettings) — se edita en Suscripciones → "Configuración de
// planes", junto con el resto de los límites de cada plan.

// Auditoría de seguridad: antes NO había ninguna supervisión de admin sobre
// las ofertas de tienda de los vendedores (Bloque 52, distintas de las
// ofertas del Home que sí modera AdminOffers.jsx) — la única forma de
// suspender una era entrar a Prisma Studio. Suspender marca suspendedAt
// además de apagarla: antes solo apagaba `active` y la tienda la volvía a
// encender al minuto. Quitar la suspensión la deja apagada; la tienda decide
// si la publica otra vez (con su plan y su tope).
export default function AdminStoreOffers() {
  const queryClient = useQueryClient();
  const [suspending, setSuspending] = useState(null);
  const [reason, setReason] = useState("");

  const { data: storeOffers, isLoading } = useQuery({
    queryKey: ["admin-store-offers"],
    queryFn: async () => (await api.get("/admin/store-offers")).data.storeOffers,
  });

  const setSuspended = useMutation({
    mutationFn: async ({ id, active, reason }) => (await api.patch(`/admin/store-offers/${id}/active`, { active, reason })).data,
    onSuccess: (_data, vars) => {
      toast.success(vars.active ? "Suspensión quitada. La tienda puede volver a publicarla." : "Oferta suspendida. La tienda no puede reactivarla.");
      closeSuspend();
      queryClient.invalidateQueries({ queryKey: ["admin-store-offers"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar la oferta."),
  });

  function closeSuspend() {
    setSuspending(null);
    setReason("");
  }

  return (
    <div className="max-w-[960px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Gift} tone="orange" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Ofertas de tienda</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Ofertas dentro de la tienda de cada vendedor (distintas de la sección "Ofertas" del Home). Puedes suspender cualquiera
        que incumpla políticas: deja de verse y la tienda no puede reactivarla hasta que quites la suspensión.
      </p>

      {isLoading && <ListSkeleton />}

      {!isLoading && !storeOffers?.length && (
        <EmptyState icon={Gift} title="Todavía no hay ofertas de tienda" description="Las ofertas que publiquen los vendedores van a aparecer aquí." />
      )}

      {storeOffers?.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {storeOffers.map((o) => {
            const suspended = !!o.suspendedAt;
            return (
              <div key={o.id} className="overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest shadow-sm">
                <div className="p-3.5">
                  <div className="mb-2 flex flex-wrap items-center gap-1.5">
                    <span
                      className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                        suspended ? "bg-error/10 text-error" : o.active ? "bg-verified/10 text-verified-dark" : "bg-surface-container text-outline"
                      }`}
                    >
                      {suspended ? "Suspendida" : o.active ? "Activa" : "Inactiva"}
                    </span>
                    {o.discountCode && (
                      <span className="rounded-full bg-error/10 px-2.5 py-1 text-[10.5px] font-bold text-error">
                        {o.discountCode.code} · {discountLabel(o.discountCode)}
                      </span>
                    )}
                  </div>
                  <div className="mb-0.5 truncate text-[11.5px] font-bold text-tertiary-accent">{o.vendor?.companyName}</div>
                  <div className="mb-2 truncate text-[13.5px] font-semibold text-on-surface">{o.title}</div>
                  {suspended && o.suspendedReason && (
                    <p className="mb-2 flex items-start gap-1.5 text-[11.5px] text-error">
                      <ShieldAlert className="mt-0.5 h-3 w-3 flex-shrink-0" />
                      <span>Motivo: {o.suspendedReason}</span>
                    </p>
                  )}
                  <button
                    onClick={() => (suspended ? setSuspended.mutate({ id: o.id, active: true }) : setSuspending(o))}
                    disabled={setSuspended.isPending}
                    className="flex min-h-[44px] items-center gap-1.5 text-[12px] font-semibold text-error hover:underline disabled:opacity-50"
                  >
                    <Power className="h-3.5 w-3.5" /> {suspended ? "Quitar suspensión" : "Suspender"}
                  </button>
                </div>
              </div>
            );
          })}
        </div>
      )}

      <ConfirmModal
        open={!!suspending}
        title={`¿Suspender "${suspending?.title ?? ""}"?`}
        message="Deja de verse en la tienda y la tienda no puede reactivarla hasta que quites la suspensión."
        confirmLabel={setSuspended.isPending ? "Suspendiendo..." : "Sí, suspender"}
        danger
        confirmDisabled={setSuspended.isPending}
        onConfirm={() => setSuspended.mutate({ id: suspending.id, active: false, reason: reason.trim() || null })}
        onCancel={closeSuspend}
      >
        <label htmlFor="so-reason" className="mb-1.5 block text-label-md text-on-surface-variant">
          Motivo para la tienda (opcional)
        </label>
        <textarea
          id="so-reason"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          maxLength={300}
          rows={3}
          placeholder="Ej.: el descuento anunciado no coincide con el código."
          className="w-full rounded-xl border border-outline-variant bg-surface-container-lowest p-3 text-[13.5px] outline-none focus:border-tertiary-accent"
        />
      </ConfirmModal>
    </div>
  );
}
