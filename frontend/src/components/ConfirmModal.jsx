import { useEffect } from "react";
import { X, AlertTriangle, Trash2 } from "lucide-react";

/**
 * ConfirmModal — reemplaza window.confirm()/window.prompt() con un modal moderno y responsivo.
 *
 * Props:
 *   open            {boolean}  — si el modal esta visible
 *   title           {string}   — titulo del modal
 *   message         {string}   — descripcion
 *   confirmLabel    {string}   — texto del boton de confirmar (default: "Confirmar")
 *   cancelLabel     {string}   — texto del boton cancelar (default: "Cancelar")
 *   danger          {boolean}  — si true, boton de confirmar en rojo
 *   confirmDisabled {boolean}  — si true, deshabilita el boton de confirmar (ej. reemplaza
 *                                 el `if (reason)` que hacía window.prompt() antes de aceptar "")
 *   children        {node}     — contenido extra entre el mensaje y los botones (ej. un
 *                                 textarea para pedir un motivo, ver AdminVerifications.jsx)
 *   onConfirm       {function} — callback al confirmar
 *   onCancel        {function} — callback al cancelar
 */
export function ConfirmModal({
  open,
  title,
  message,
  confirmLabel = "Confirmar",
  cancelLabel = "Cancelar",
  danger = false,
  confirmDisabled = false,
  children,
  onConfirm,
  onCancel,
}) {
  useEffect(() => {
    if (!open) return;
    function onKey(e) {
      if (e.key === "Escape") onCancel?.();
    }
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, [open, onCancel]);

  useEffect(() => {
    if (open) {
      document.body.style.overflow = "hidden";
    } else {
      document.body.style.overflow = "";
    }
    return () => {
      document.body.style.overflow = "";
    };
  }, [open]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel?.(); }}
    >
      <div
        className="relative max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-2xl bg-surface-container-lowest p-6 shadow-2xl"
        style={{ animation: "modal-pop 0.18s ease-out" }}
      >
        <button
          onClick={onCancel}
          className="absolute right-4 top-4 rounded-full p-1.5 text-outline hover:bg-surface-variant hover:text-on-surface"
        >
          <X className="h-4 w-4" />
        </button>

        <div className={`mb-4 flex h-12 w-12 items-center justify-center rounded-full ${danger ? "bg-error/10" : "bg-primary-container/30"}`}>
          {danger ? (
            <Trash2 className="h-6 w-6 text-error" />
          ) : (
            <AlertTriangle className="h-6 w-6 text-primary" />
          )}
        </div>

        <h2 className="mb-2 text-[16px] font-bold text-on-surface">{title}</h2>

        <p className="mb-4 text-[13.5px] leading-relaxed text-on-surface-variant">{message}</p>

        {children && <div className="mb-4">{children}</div>}

        <div className="flex flex-col gap-2 sm:flex-row sm:justify-end">
          <button
            onClick={onCancel}
            className="order-2 rounded-xl border border-outline-variant px-5 py-2.5 text-[13px] font-semibold text-on-surface transition hover:bg-surface-variant sm:order-1"
          >
            {cancelLabel}
          </button>
          <button
            onClick={onConfirm}
            disabled={confirmDisabled}
            className={`order-1 rounded-xl px-5 py-2.5 text-[13px] font-semibold text-white transition disabled:cursor-not-allowed disabled:opacity-50 sm:order-2 ${
              danger
                ? "bg-error hover:bg-error/90 active:bg-error/80"
                : "bg-primary hover:bg-primary/90 active:bg-primary/80"
            }`}
          >
            {confirmLabel}
          </button>
        </div>
      </div>

      <style>{`
        @keyframes modal-pop {
          from { opacity: 0; transform: scale(0.94) translateY(8px); }
          to   { opacity: 1; transform: scale(1) translateY(0); }
        }
      `}</style>
    </div>
  );
}
