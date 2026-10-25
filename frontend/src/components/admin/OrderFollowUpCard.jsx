import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Hourglass } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import ToggleSwitch from "./ToggleSwitch.jsx";

// Pedidos que la tienda no responde (Admin > Configuración > Tiendas y productos): a cuántas horas va el recordatorio a la
// tienda, el aviso de que se cerrará y el cierre automático con aviso al cliente. Ver backend services/orderFollowUp.service.js.
const FIELDS = [
  { key: "reminderHours", label: "Recordatorio a la tienda", hint: "Con todos los datos del pedido, en la campana y por correo." },
  { key: "warningHours", label: "Aviso de que se cerrará", hint: "Le dice a la tienda la fecha y hora exactas del cierre." },
  { key: "cancelHours", label: "Cierre automático", hint: "El cliente recibe un aviso amable con los contactos de la tienda." },
];

const days = (h) => (h % 24 === 0 ? `${h / 24} ${h / 24 === 1 ? "día" : "días"}` : null);

export function OrderFollowUpCard() {
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["admin-order-follow-up"],
    queryFn: async () => (await api.get("/admin/settings/order-follow-up")).data,
    staleTime: 30 * 1000,
  });
  const [form, setForm] = useState(null);
  useEffect(() => {
    if (data) setForm({ reminderHours: String(data.reminderHours), warningHours: String(data.warningHours), cancelHours: String(data.cancelHours) });
  }, [data]);

  const save = useMutation({
    mutationFn: async (body) => (await api.patch("/admin/settings/order-follow-up", body)).data,
    onSuccess: (r) => {
      queryClient.invalidateQueries({ queryKey: ["admin-order-follow-up"] });
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      toast.success(r.enabled ? "Seguimiento de pedidos guardado." : "Seguimiento de pedidos apagado.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  const enabled = data?.enabled !== false;
  const nums = form ? Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)])) : null;
  const valid = nums && FIELDS.every((f) => Number.isInteger(nums[f.key]) && nums[f.key] >= 1 && nums[f.key] <= 336);
  const ordered = valid && nums.reminderHours < nums.warningHours && nums.warningHours < nums.cancelHours;
  const dirty = data && nums && FIELDS.some((f) => nums[f.key] !== data[f.key]);

  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[14px] font-bold text-on-surface">
            <Hourglass className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Pedidos sin respuesta de la tienda
          </div>
          <p className="text-[12.5px] leading-[18px] text-outline">
            Si una tienda no confirma ni rechaza un pedido, el sistema le recuerda, le avisa que se cerrará y al final lo cierra para que el cliente no siga esperando. Los correos a la tienda salen siempre, aunque tenga apagado el aviso de pedidos. La tienda puede reactivar un pedido cerrado durante 30 días.
          </p>
        </div>
        <ToggleSwitch
          isActive={enabled}
          label="Seguimiento de pedidos sin respuesta"
          disabled={isLoading || isError || save.isPending || !data}
          onToggle={() => save.mutate({ enabled: !enabled, reminderHours: data.reminderHours, warningHours: data.warningHours, cancelHours: data.cancelHours })}
        />
      </div>

      {isError && <p className="mt-3 text-[12.5px] text-error">No se pudo cargar. Recarga la página.</p>}

      {form && (
        <>
          <div className={`mt-4 grid grid-cols-1 gap-3.5 sm:grid-cols-3 ${enabled ? "" : "opacity-60"}`}>
            {FIELDS.map((f) => (
              <div key={f.key}>
                <label htmlFor={`fu-${f.key}`} className="mb-1 block text-label-md text-on-surface-variant">
                  {f.label} (horas)
                </label>
                <input
                  id={`fu-${f.key}`}
                  type="number"
                  inputMode="numeric"
                  min={1}
                  max={336}
                  value={form[f.key]}
                  disabled={!enabled}
                  onChange={(e) => setForm((prev) => ({ ...prev, [f.key]: e.target.value }))}
                  className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none focus:border-primary-container"
                />
                <p className="mt-1 text-[11.5px] text-outline">
                  {days(nums[f.key]) ? `${days(nums[f.key])}. ` : ""}
                  {f.hint}
                </p>
              </div>
            ))}
          </div>
          {valid && !ordered && <p className="mt-2 text-[12.5px] text-error">Las horas tienen que ir en orden: recordatorio, después el aviso y al final el cierre.</p>}
          {!valid && <p className="mt-2 text-[12.5px] text-error">Cada valor tiene que ser un número entero de 1 a 336 horas.</p>}
          {dirty && enabled && (
            <Button className="mt-3.5" size="sm" disabled={!ordered || save.isPending} onClick={() => save.mutate({ enabled, ...nums })}>
              {save.isPending ? "Guardando..." : "Guardar horas"}
            </Button>
          )}
        </>
      )}

      {data?.stats && (
        <dl className="mt-4 flex flex-wrap gap-x-5 gap-y-1 border-t border-surface-container-high pt-3 text-[12.5px] text-on-surface-variant">
          <div className="flex gap-1">
            <dt>Esperando respuesta ahora:</dt>
            <dd className="font-bold text-on-surface">{data.stats.waiting}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Recordatorios (30 días):</dt>
            <dd className="font-bold text-on-surface">{data.stats.reminded30d}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Cerrados sin respuesta:</dt>
            <dd className="font-bold text-on-surface">{data.stats.autoCancelled30d}</dd>
          </div>
          <div className="flex gap-1">
            <dt>Reactivados:</dt>
            <dd className="font-bold text-on-surface">{data.stats.reactivated30d}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
