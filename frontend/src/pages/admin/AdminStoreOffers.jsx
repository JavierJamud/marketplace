import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Gift, Power } from "lucide-react";
import { api } from "../../lib/api.js";
import { EmptyState } from "../../components/ui/EmptyState.jsx";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

function discountLabel(code) {
  if (!code) return "";
  return code.type === "PERCENTAGE" ? `-${Number(code.value)}%` : `-${Number(code.value).toLocaleString("es-CU")} CUP`;
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
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Ofertas de tienda</h1>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Ofertas dentro de la tienda de cada vendedor (distintas de la sección "Ofertas" del Home) — puedes suspender
        cualquiera que incumpla políticas.
      </p>

      {isLoading && <p className="text-body-md text-on-surface-variant">Cargando...</p>}

      {!isLoading && !storeOffers?.length && (
        <EmptyState icon={Gift} title="Todavía no hay ofertas de tienda" description="Las ofertas que publiquen los vendedores van a aparecer acá." />
      )}

      {storeOffers?.length > 0 && (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {storeOffers.map((o) => (
            <div key={o.id} className="overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest shadow-sm">
              <div className="relative h-36 w-full overflow-hidden bg-surface-container">
                <img src={imgUrl(o.imageUrl)} alt="" className="h-full w-full object-cover" />
                <span
                  className={`absolute left-2.5 top-2.5 rounded-full px-2.5 py-1 text-[10.5px] font-bold ${
                    o.active ? "bg-verified/90 text-white" : "bg-surface-container-highest text-outline"
                  }`}
                >
                  {o.active ? "Activa" : "Inactiva"}
                </span>
                {o.discountCode && (
                  <span className="absolute right-2.5 top-2.5 rounded-full bg-error px-2.5 py-1 text-[10.5px] font-bold text-white">
                    {o.discountCode.code} · {discountLabel(o.discountCode)}
                  </span>
                )}
              </div>
              <div className="p-3.5">
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
