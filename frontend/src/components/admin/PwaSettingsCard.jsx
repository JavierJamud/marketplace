import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Smartphone } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import ToggleSwitch from "./ToggleSwitch.jsx";
import { ConfirmModal } from "../ConfirmModal.jsx";

// Aplicaciones instalables y avisos (Admin > Configuración > General). Es el interruptor de emergencia de la PWA: apagada, cada
// dispositivo quita el service worker y su caché la próxima vez que abre el sitio, se corta el canal en vivo y no salen avisos push.
// Las suscripciones no se borran, así que al volver a encenderla los avisos siguen llegando a los mismos dispositivos.
const APP_LABELS = { CLIENT: "Marketplace", VENDOR: "Tienda", ADMIN: "Admin" };

export function PwaSettingsCard() {
  const queryClient = useQueryClient();
  const [confirming, setConfirming] = useState(false);
  const { data, isLoading, isError } = useQuery({ queryKey: ["admin-pwa-status"], queryFn: async () => (await api.get("/admin/settings/pwa")).data, staleTime: 15 * 1000 });

  const save = useMutation({
    mutationFn: async (pwaEnabled) => (await api.patch("/admin/settings/pwa", { pwaEnabled })).data,
    onSuccess: (r) => {
      setConfirming(false);
      queryClient.invalidateQueries({ queryKey: ["admin-pwa-status"] });
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      toast.success(r.settings.pwaEnabled ? "Aplicaciones y avisos encendidos." : "Aplicaciones y avisos apagados.");
    },
    onError: (err) => {
      setConfirming(false);
      toast.error(err.response?.data?.error ?? "No se pudo guardar.");
    },
  });

  const enabled = data?.pwaEnabled !== false;

  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="mb-1 flex items-center gap-2 text-[14px] font-bold text-on-surface">
            <Smartphone className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Aplicaciones y avisos
          </div>
          <p className="text-[12.5px] leading-[18px] text-outline">
            Permite instalar Baznova Marketplace, Tienda y Admin en el celular, recibir avisos aunque la página esté cerrada y ver los cambios al instante. Si algo falla, apágalo: cada dispositivo vuelve a funcionar como página web normal.
          </p>
        </div>
        <ToggleSwitch isActive={enabled} label="Aplicaciones y avisos" disabled={isLoading || isError || save.isPending} onToggle={() => (enabled ? setConfirming(true) : save.mutate(true))} />
      </div>

      {isError && <p className="mt-3 text-[12.5px] text-error">No se pudo cargar el estado. Recarga la página.</p>}
      {data && (
        <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-surface-container-high pt-3 text-[12.5px] text-on-surface-variant">
          {Object.entries(APP_LABELS).map(([key, label]) => (
            <div key={key} className="flex gap-1">
              <dt>{label}:</dt>
              <dd className="font-bold text-on-surface">{data.devices?.[key] ?? 0} con avisos</dd>
            </div>
          ))}
          <div className="flex gap-1">
            <dt>Conectadas ahora:</dt>
            <dd className="font-bold text-on-surface">{data.connected}</dd>
          </div>
        </dl>
      )}

      <ConfirmModal
        open={confirming}
        title="¿Apagar aplicaciones y avisos?"
        message="Nadie recibirá avisos push ni verá cambios al instante, y las aplicaciones instaladas pasarán a abrir la página web normal. Puedes volver a encenderlo cuando quieras."
        confirmLabel={save.isPending ? "Apagando..." : "Sí, apagar"}
        danger
        confirmDisabled={save.isPending}
        onConfirm={() => save.mutate(false)}
        onCancel={() => setConfirming(false)}
      />
    </div>
  );
}
