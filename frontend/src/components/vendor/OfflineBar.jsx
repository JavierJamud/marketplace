import { useEffect, useState } from "react";
import { AlertTriangle, ChevronDown, CloudOff, RefreshCw } from "lucide-react";
import { discardFailed, flushQueue, onQueueChange, retryFailed } from "../../lib/offlineQueue.js";

// Franja del panel de la tienda para trabajar sin conexión (ver lib/offlineQueue.js). Solo aparece cuando hace falta:
//  - sin conexión: se puede seguir vendiendo; lo hecho queda guardado en este dispositivo;
//  - con operaciones pendientes: cuántas faltan por enviar (se envían solas, o con "Enviar ahora");
//  - con operaciones rechazadas al sincronizar: el motivo de cada una, para reintentarla o descartarla.
const timeOf = (ms) => new Date(ms).toLocaleTimeString("es", { hour: "2-digit", minute: "2-digit" });

export function OfflineBar() {
  const [status, setStatus] = useState(null);
  const [open, setOpen] = useState(false);
  useEffect(() => onQueueChange(setStatus), []);

  if (!status) return null;
  const { online, pending, failed, syncing } = status;
  if (online && !pending.length && !failed.length) return null;

  const tone = failed.length ? "border-error/30 bg-error/[0.07]" : online ? "border-tertiary-accent/30 bg-tertiary-accent/[0.07]" : "border-secondary/40 bg-secondary-container/20";
  const title = !online
    ? "Sin conexión"
    : syncing
      ? "Enviando lo guardado..."
      : pending.length
        ? `${pending.length} ${pending.length === 1 ? "operación" : "operaciones"} por enviar`
        : `${failed.length} ${failed.length === 1 ? "operación no se pudo enviar" : "operaciones no se pudieron enviar"}`;
  const text = !online
    ? pending.length
      ? `Puedes seguir trabajando. ${pending.length} ${pending.length === 1 ? "operación guardada" : "operaciones guardadas"} en este dispositivo; se envían solas al volver internet.`
      : "Puedes seguir registrando ventas y cuentas de mesa: se guardan en este dispositivo y se envían solas al volver internet."
    : pending.length
      ? "Se están enviando en el mismo orden en que las hiciste."
      : "El servidor las rechazó al sincronizar. Revisa el motivo de cada una.";

  return (
    <div role="status" className={`mb-4 rounded-2xl border px-4 py-3 ${tone}`}>
      <div className="flex items-start gap-3">
        {failed.length ? (
          <AlertTriangle className="mt-0.5 h-5 w-5 flex-shrink-0 text-error" aria-hidden="true" />
        ) : (
          <CloudOff className="mt-0.5 h-5 w-5 flex-shrink-0 text-on-surface-variant" aria-hidden="true" />
        )}
        <div className="min-w-0 flex-1">
          <p className="text-[13.5px] font-bold text-on-surface">{title}</p>
          <p className="text-[12.5px] leading-[18px] text-on-surface-variant">{text}</p>
        </div>
        {online && pending.length > 0 && (
          <button type="button" onClick={() => flushQueue()} disabled={syncing} className="flex min-h-10 flex-shrink-0 items-center gap-1.5 rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[12.5px] font-bold text-on-surface disabled:opacity-50">
            <RefreshCw className={`h-3.5 w-3.5 ${syncing ? "animate-spin" : ""}`} aria-hidden="true" /> Enviar ahora
          </button>
        )}
      </div>

      {(pending.length > 0 || failed.length > 0) && (
        <>
          <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="mt-1 flex min-h-9 items-center gap-1 text-[12.5px] font-semibold text-tertiary-accent">
            {open ? "Ocultar detalle" : "Ver detalle"} <ChevronDown className={`h-3.5 w-3.5 transition-transform ${open ? "rotate-180" : ""}`} aria-hidden="true" />
          </button>
          {open && (
            <ul className="mt-1 divide-y divide-surface-container-high rounded-xl bg-surface-container-lowest">
              {failed.map((op) => (
                <li key={op.key} className="flex flex-wrap items-center gap-x-3 gap-y-1 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="text-[12.5px] font-semibold text-on-surface">{op.label ?? "Operación"} · {timeOf(op.at)}</p>
                    <p className="text-[12px] text-error">{op.error}</p>
                  </div>
                  <button type="button" onClick={() => retryFailed(op.key)} className="min-h-9 rounded-lg px-2.5 text-[12px] font-bold text-tertiary-accent hover:bg-surface-container">
                    Reintentar
                  </button>
                  <button type="button" onClick={() => discardFailed(op.key)} className="min-h-9 rounded-lg px-2.5 text-[12px] font-bold text-on-surface-variant hover:bg-surface-container">
                    Descartar
                  </button>
                </li>
              ))}
              {pending.map((op) => (
                <li key={op.key} className="px-3 py-2 text-[12.5px] text-on-surface">
                  {op.label ?? "Operación"} · <span className="text-on-surface-variant">{timeOf(op.at)}, pendiente</span>
                </li>
              ))}
            </ul>
          )}
        </>
      )}
    </div>
  );
}
