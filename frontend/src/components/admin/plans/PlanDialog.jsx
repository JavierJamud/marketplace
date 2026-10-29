import { useId, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { useDialogLayer } from "./useDialogLayer.js";

// Ventana corta de la pantalla de planes (crear, archivar, resumen de impacto, descartar cambios). Va en un portal al
// body: la ventana Configurar se desliza con transform y, dentro de ella, un position:fixed quedaría recortado.
// z-[70]: por encima de Configurar (z-50) y por debajo del código de acción del admin (z-[110]).
// En el celular sale como hoja desde abajo (el pulgar llega a los botones); en escritorio, centrada.
export function PlanDialog({ open, title, description, onClose, busy = false, children, footer, wide = false }) {
  const ref = useRef(null);
  const titleId = useId();
  const descId = useId();
  useDialogLayer(ref, { open, onEscape: () => !busy && onClose?.() });
  if (!open) return null;

  return createPortal(
    <div
      className="fixed inset-0 z-[70] flex items-end justify-center bg-black/45 sm:items-center sm:p-4"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) onClose?.();
      }}
    >
      <div
        ref={ref}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={description ? descId : undefined}
        tabIndex={-1}
        className={`motion-safe:animate-sheet-up flex max-h-[92dvh] w-full flex-col rounded-t-2xl bg-surface-container-lowest shadow-2xl outline-none sm:rounded-2xl ${wide ? "sm:max-w-[560px]" : "sm:max-w-[460px]"}`}
      >
        <div className="flex items-start gap-3 px-5 pb-2 pt-5">
          <div className="min-w-0 flex-1">
            <h2 id={titleId} className="font-display text-[17px] font-extrabold leading-snug text-on-surface">
              {title}
            </h2>
            {description && (
              <p id={descId} className="mt-1 text-[13px] leading-relaxed text-on-surface-variant">
                {description}
              </p>
            )}
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            aria-label="Cerrar"
            className="-mr-2 -mt-2 flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container focus-visible:outline focus-visible:outline-2 focus-visible:outline-tertiary-accent disabled:opacity-50"
          >
            <X className="h-5 w-5" aria-hidden="true" />
          </button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-3">{children}</div>
        {footer && (
          <div className="flex flex-col-reverse gap-2 border-t border-surface-container px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))] sm:flex-row sm:justify-end">
            {footer}
          </div>
        )}
      </div>
    </div>,
    document.body
  );
}

// Botones del pie de las ventanas: 44px de alto, con foco visible.
const FOCUS = "focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent";

export function DialogButton({ variant = "primary", className = "", ...props }) {
  const look = {
    primary: "bg-primary text-on-primary hover:bg-primary-container",
    danger: "bg-error text-on-error hover:brightness-95",
    outline: "border border-outline-variant text-on-surface hover:bg-surface-container",
    ghost: "text-tertiary-accent hover:bg-tertiary-accent/[0.07]",
  }[variant];
  return (
    <button
      type="button"
      className={`inline-flex min-h-11 items-center justify-center gap-2 rounded-xl px-5 text-[13.5px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${look} ${FOCUS} ${className}`}
      {...props}
    />
  );
}
