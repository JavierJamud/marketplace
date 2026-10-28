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
  const [delayHours, setDelayHours] = useState("");
  useEffect(() => {
    if (data) {
      setForm({ reminderHours: String(data.reminderHours), warningHours: String(data.warningHours), cancelHours: String(data.cancelHours) });
      setDelayHours(String(data.delayHours ?? 48));
    }
  }, [data]);

  const save = useMutation({
    mutationFn: async (body) => (await api.patch("/admin/settings/order-follow-up", body)).data,
    onSuccess: (r, body) => {
      queryClient.invalidateQueries({ queryKey: ["admin-order-follow-up"] });
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      if (body.delayEnabled !== undefined) toast.success(r.delayEnabled ? "Aviso de retraso guardado." : "Aviso de retraso apagado.");
      else toast.success(r.enabled ? "Seguimiento de pedidos guardado." : "Seguimiento de pedidos apagado.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  const enabled = data?.enabled !== false;
  const nums = form ? Object.fromEntries(Object.entries(form).map(([k, v]) => [k, Number(v)])) : null;
  const valid = nums && FIELDS.every((f) => Number.isInteger(nums[f.key]) && nums[f.key] >= 1 && nums[f.key] <= 336);
  const ordered = valid && nums.reminderHours < nums.warningHours && nums.warningHours < nums.cancelHours;
  const dirty = data && nums && FIELDS.some((f) => nums[f.key] !== data[f.key]);
  // Pedido detenido en "Vendido" o "En camino" (services/orderDelay.service.js): se guarda junto con lo de arriba.
  const base = data ? { enabled: data.enabled, reminderHours: data.reminderHours, warningHours: data.warningHours, cancelHours: data.cancelHours } : null;
  const delayOn = data?.delayEnabled !== false;
  const delayNum = Number(delayHours);
  const delayValid = Number.isInteger(delayNum) && delayNum >= 1 && delayNum <= 720;
  const delayDirty = data && delayValid && delayNum !== data.delayHours;

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

      {data && (
        <div className="mt-4 border-t border-surface-container-high pt-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="text-[13.5px] font-bold text-on-surface">Aviso de retraso al cliente y a la tienda</p>
              <p className="text-[12.5px] leading-[18px] text-outline">
                Si un pedido "Vendido" o "En camino" pasa estas horas sin cambiar de estado, la tienda recibe un aviso para actualizarlo y el cliente un correo con los contactos de la tienda. Con esto encendido, el cliente también se entera cuando su pedido pendiente llega al recordatorio de arriba.
              </p>
            </div>
            <ToggleSwitch
              isActive={delayOn}
              label="Aviso de retraso"
              disabled={save.isPending}
              onToggle={() => save.mutate({ ...base, delayEnabled: !delayOn, delayHours: data.delayHours })}
            />
          </div>
          <div className={`mt-3 flex flex-wrap items-end gap-3 ${delayOn ? "" : "opacity-60"}`}>
            <div>
              <label htmlFor="fu-delayHours" className="mb-1 block text-label-md text-on-surface-variant">Avisar a las (horas sin cambio)</label>
              <input
                id="fu-delayHours"
                type="number"
                inputMode="numeric"
                min={1}
                max={720}
                value={delayHours}
                disabled={!delayOn}
                onChange={(e) => setDelayHours(e.target.value)}
                className="h-11 w-40 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none focus:border-primary-container"
              />
              <p className="mt-1 text-[11.5px] text-outline">{delayValid ? days(delayNum) ?? `${delayNum} horas` : "Un número entero de 1 a 720 horas."}</p>
            </div>
            {delayDirty && delayOn && (
              <Button size="sm" className="mb-5" disabled={save.isPending} onClick={() => save.mutate({ ...base, delayEnabled: true, delayHours: delayNum })}>
                {save.isPending ? "Guardando..." : "Guardar"}
              </Button>
            )}
          </div>
        </div>
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
          <div className="flex gap-1">
            <dt>Avisos de retraso:</dt>
            <dd className="font-bold text-on-surface">{data.stats.delayed30d ?? 0}</dd>
          </div>
        </dl>
      )}
    </div>
  );
}
