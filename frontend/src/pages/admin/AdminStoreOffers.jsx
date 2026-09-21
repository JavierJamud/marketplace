import { useEffect, useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Gift, Power, SlidersHorizontal } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { EmptyState } from "../../components/ui/EmptyState.jsx";

function discountLabel(code) {
  if (!code) return "";
  return code.type === "PERCENTAGE" ? `-${Number(code.value)}%` : `-${Number(code.value).toLocaleString("es-CU")} CUP`;
}

// Bloque 232 (pedido explícito — "quiero poder cambiar desde el panel de
// admin si los vendedores pueden tener una oferta activa en su tienda o
// pueden tener más de una... hablo de las ofertas de las tiendas, no de la
// página principal"): mismo criterio/estilo que OfferPolicyCard en
// AdminOffers.jsx (esa es la política de Offer/Home, esta es la de
// StoreOffer — modelos y secciones distintas, tarjeta propia acá).
function StoreOfferPolicyCard() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const [maxActive, setMaxActive] = useState("");

  useEffect(() => {
    if (settings) setMaxActive(String(settings.maxActiveStoreOffersPerVendor));
  }, [settings]);

  const save = useMutation({
    mutationFn: async () => (await api.patch("/admin/settings/store-offer-policy", { maxActiveStoreOffersPerVendor: Number(maxActive) })).data,
    onSuccess: () => {
      toast.success("Política de ofertas de tienda actualizada.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar la política."),
  });

  const dirty = settings && maxActive !== "" && Number(maxActive) !== settings.maxActiveStoreOffersPerVendor;

  return (
    <div className="mb-[18px] rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <div className="mb-3 flex items-center gap-2 text-[14px] font-bold text-on-surface">
        <SlidersHorizontal className="h-4 w-4 text-tertiary-accent" /> Cuántas ofertas activas puede tener cada tienda
      </div>
      <div className="max-w-[280px]">
        <span className="mb-1 block text-label-md text-on-surface-variant">Máximo de ofertas activas por tienda</span>
        <input
          type="number"
          min={1}
          max={20}
          value={maxActive}
          onChange={(e) => setMaxActive(e.target.value)}
          className="h-10 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none"
        />
      </div>
      <p className="mt-2 text-[11.5px] text-outline">
        En 1 (default), un vendedor tiene que desactivar su oferta actual antes de activar otra. Si lo subes, el vendedor
        ve "X/N activas" en su panel y puede tener varias corriendo a la vez.
      </p>
      {dirty && (
        <button
          onClick={() => save.mutate()}
          disabled={save.isPending}
          className="mt-3 rounded-xl bg-secondary-container px-4 py-2 text-[12.5px] font-bold text-on-secondary-container disabled:opacity-50"
        >
          {save.isPending ? "Guardando..." : "Guardar"}
        </button>
      )}
    </div>
  );
}

// Auditoría de seguridad: antes NO había ninguna supervisión de admin sobre
// las ofertas de tienda de los vendedores (Bloque 52, distintas de las
// ofertas del Home que sí modera AdminOffers.jsx) — la única forma de
// suspender una era entrar a Prisma Studio. Reusa el mismo campo `active`
// que ya usa el propio vendedor para retirar/reactivar la suya.
export default function AdminStoreOffers() {
  const queryClient = useQueryClient();

  const { data: storeOffers, isLoading } = useQuery({
    queryKey: ["admin-store-offers"],
    queryFn: async () => (await api.get("/admin/store-offers")).data.storeOffers,
  });

  const toggleActive = useMutation({
    mutationFn: async ({ id, active }) => (await api.patch(`/admin/store-offers/${id}/active`, { active })).data,
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ["admin-store-offers"] }),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo actualizar la oferta."),
  });

  return (
    <div className="max-w-[960px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Gift} tone="orange" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Ofertas de tienda</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Ofertas dentro de la tienda de cada vendedor (distintas de la sección "Ofertas" del Home) — puedes suspender
        cualquiera que incumpla políticas.
      </p>

      <StoreOfferPolicyCard />

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      {!isLoading && !storeOffers?.length && (
        <EmptyState icon={Gift} title="Todavía no hay ofertas de tienda" description="Las ofertas que publiquen los vendedores van a aparecer acá." />
      )}

      {storeOffers?.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {storeOffers.map((o) => (
            <div key={o.id} className="overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest shadow-sm">
              <div className="p-3.5">
                <div className="mb-2 flex items-center gap-1.5">
                  <span
                    className={`rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                      o.active ? "bg-verified/10 text-verified-dark" : "bg-surface-container text-outline"
                    }`}
                  >
                    {o.active ? "Activa" : "Inactiva"}
                  </span>
                  {o.discountCode && (
                    <span className="rounded-full bg-error/10 px-2.5 py-1 text-[10.5px] font-bold text-error">
                      {o.discountCode.code} · {discountLabel(o.discountCode)}
                    </span>
                  )}
                </div>
                <div className="mb-0.5 truncate text-[11.5px] font-bold text-tertiary-accent">{o.vendor?.companyName}</div>
                <div className="mb-3 truncate text-[13.5px] font-semibold text-on-surface">{o.title}</div>
                <button
                  onClick={() => toggleActive.mutate({ id: o.id, active: !o.active })}
                  disabled={toggleActive.isPending}
                  className="flex items-center gap-1.5 text-[12px] font-semibold text-error hover:underline disabled:opacity-50"
                >
                  <Power className="h-3.5 w-3.5" /> {o.active ? "Suspender" : "Reactivar"}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
