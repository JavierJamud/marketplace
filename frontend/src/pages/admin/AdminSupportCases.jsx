import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { LifeBuoy, Mail, Phone, Check } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

// Problemas que los clientes le contaron al asistente del sitio. Los de un pedido con vendedor le llegan a esa tienda (y aquí
// quedan como referencia); los de la web o de un pedido sin tienda conocida llegan solo al admin.
export default function AdminSupportCases() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-support-cases"],
    queryFn: async () => (await api.get("/admin/support-cases")).data.cases,
  });
  const resolve = useMutation({
    mutationFn: async (id) => api.patch(`/admin/support-cases/${id}/resolve`),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["admin-support-cases"] });
      queryClient.invalidateQueries({ queryKey: ["admin-notifications"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo marcar como resuelto."),
  });

  return (
    <div className="max-w-[820px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={LifeBuoy} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Casos de soporte</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">Lo que los clientes reportan desde el asistente, con sus datos de contacto.</p>

      {isLoading && <ListSkeleton />}
      {isError && <p className="text-body-md text-error">No se pudieron cargar los casos.</p>}
      {data && !data.length && <p className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 text-body-md text-on-surface-variant">Todavía no hay casos.</p>}

      <ul className="flex flex-col gap-3">
        {data?.map((c) => (
          <li key={c.id} className={`rounded-2xl border bg-surface-container-lowest p-4 ${c.status === "OPEN" ? "border-secondary-container" : "border-surface-container-high opacity-75"}`}>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div className="text-[14px] font-bold text-on-surface">
                {c.kind === "ORDER" ? `Pedido${c.orderCode ? ` ${c.orderCode}` : ""}` : "Sitio web"}
                {c.vendor && <span className="font-normal text-outline"> · avisado a {c.vendor.companyName}</span>}
              </div>
              <span className="text-[11.5px] text-outline">{new Date(c.createdAt).toLocaleString("es-CU", { dateStyle: "medium", timeStyle: "short" })}</span>
            </div>
            <div className="mt-1 text-[13.5px] font-semibold text-on-surface">{c.name}</div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[13px] text-on-surface-variant">
              <a href={`tel:${c.phone}`} className="inline-flex min-h-11 items-center gap-1.5 hover:underline"><Phone className="h-3.5 w-3.5" /> {c.phone}</a>
              <a href={`mailto:${c.email}`} className="inline-flex min-h-11 items-center gap-1.5 hover:underline"><Mail className="h-3.5 w-3.5" /> {c.email}</a>
            </div>
            {c.message && <p className="mt-1 whitespace-pre-wrap text-[13.5px] text-on-surface">{c.message}</p>}
            {c.status === "OPEN" ? (
              <button type="button" onClick={() => resolve.mutate(c.id)} disabled={resolve.isPending} className="mt-2 inline-flex min-h-11 items-center gap-1.5 rounded-full bg-secondary-container px-4 text-[12.5px] font-bold text-on-secondary-container disabled:opacity-50">
                <Check className="h-4 w-4" /> Marcar como resuelto
              </button>
            ) : (
              <p className="mt-2 text-[12px] font-semibold text-verified-dark">Resuelto</p>
            )}
          </li>
        ))}
      </ul>
    </div>
  );
}
