import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Mail } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import ToggleSwitch from "./ToggleSwitch.jsx";

// Recordatorios automáticos a clientes (Admin > Configuración > General): carrito sin terminar y "volviste a mirar esta tienda"
// (puntos para usar u oferta activa). Cada cliente puede apagarlos para sí; esto los apaga para toda la plataforma.
export function CustomerRemindersCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-customer-reminders"],
    queryFn: async () => (await api.get("/admin/settings/customer-reminders")).data,
    staleTime: 30 * 1000,
  });

  const save = useMutation({
    mutationFn: async (enabled) => (await api.patch("/admin/settings/customer-reminders", { enabled })).data,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["admin-customer-reminders"] });
      toast.success(r.enabled ? "Recordatorios a clientes encendidos." : "Recordatorios a clientes apagados.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  const enabled = data?.enabled !== false;

  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[14px] font-bold text-on-surface">
            <Mail className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Recordatorios a clientes
          </div>
          <p className="text-[12.5px] leading-[18px] text-outline">
            Correos a nombre de cada tienda: carrito sin terminar después de un día, y a los 3 días de mirar una tienda sin comprar, si tiene puntos para usar o una oferta activa. Como mucho uno cada 3 días por cliente, y cada uno puede darse de baja.
          </p>
        </div>
        <ToggleSwitch isActive={enabled} label="Recordatorios a clientes" disabled={isLoading || isError || save.isPending} onToggle={() => save.mutate(!enabled)} />
      </div>
      {isError && <p className="mt-3 text-[12.5px] text-error">No se pudo cargar el estado. Recarga la página.</p>}
      {data && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-surface-container-high pt-3 text-[12.5px] text-on-surface-variant">
          <div className="flex gap-1">
            <dt>Carritos (30 días):</dt>
            <dd className="font-bold text-on-surface">{data.cart30d}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Tiendas visitadas (30 días):</dt>
            <dd className="font-bold text-on-surface">{data.store30d}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Clientes que los apagaron:</dt>
            <dd className="font-bold text-on-surface">{data.optedOut}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
