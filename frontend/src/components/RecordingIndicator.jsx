import { useEffect, useState } from "react";
import { X } from "lucide-react";
import { VoiceWaveform } from "./VoiceWaveform.jsx";

// Bloque 277 (pedido explícito — "cuando se graba un audio se muestra una animación con las ondas
// sonoras en tiempo real y que diga Grabando, así la persona sabe que sí está funcionando"):
// indicador común a todos los chats con voz. Punto rojo que parpadea, la palabra "Grabando", las
// ondas reales del micrófono (VoiceWaveform) y el tiempo transcurrido. Con "reducir movimiento"
// el punto no parpadea, pero las ondas siguen porque son información, no adorno.
export function RecordingIndicator({ stream, onCancel, className = "" }) {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const started = Date.now();
    const id = setInterval(() => setSeconds(Math.floor((Date.now() - started) / 1000)), 250);
    return () => clearInterval(id);
  }, []);
  const clock = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
  return (
    <div className={`flex min-h-10 min-w-0 flex-1 items-center gap-2.5 rounded-full border border-error/40 bg-error/5 pl-4 pr-1 ${className}`} role="status" aria-live="polite">
      <span className="h-2.5 w-2.5 flex-shrink-0 animate-pulse rounded-full bg-error motion-reduce:animate-none" aria-hidden="true" />
      <span className="flex-shrink-0 text-[12.5px] font-semibold text-error">Grabando</span>
      <VoiceWaveform stream={stream} />
      <span className="flex-shrink-0 text-[12px] tabular-nums text-error">{clock}</span>
      <button type="button" onClick={onCancel} aria-label="Cancelar la grabación" className="flex h-10 w-10 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:text-error focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent">
        <X className="h-4 w-4" aria-hidden="true" />
      </button>
    </div>
  );
}
