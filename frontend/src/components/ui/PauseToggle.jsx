import { Pause, Play } from "lucide-react";

// Bloque 248 (auditoría 004, hallazgo 9): WCAG 2.2.2 pide poder pausar el
// contenido que se mueve solo por más de 5 segundos. En celular no existe el
// "pausar al pasar el mouse", así que hay un botón real de 44px de alto.
export function PauseToggle({ paused, onToggle, label }) {
  return (
    <button
      type="button"
      onClick={onToggle}
      aria-pressed={paused}
      className="mt-1 flex min-h-11 items-center gap-1.5 rounded-lg px-2 text-label-sm font-semibold text-on-surface-variant hover:text-on-surface focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent"
    >
      {paused ? <Play className="h-3.5 w-3.5" aria-hidden="true" /> : <Pause className="h-3.5 w-3.5" aria-hidden="true" />}
      {paused ? `Reanudar ${label}` : `Pausar ${label}`}
    </button>
  );
}
