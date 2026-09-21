import { AlertTriangle } from "lucide-react";

// Bloque 196 (pedido explícito — "si se hace clic fuera de un contenedor
// mostrado como ventana o popup en el panel debe cerrarse automáticamente,
// y si necesita que guarden datos debe preguntar si desea guardar o
// descartar antes de cerrar"): diálogo compartido de 3 salidas (guardar y
// salir / descartar / seguir editando) — ConfirmModal.jsx no alcanza acá
// porque solo tiene 2 botones (confirmar/cancelar), y esta decisión
// siempre necesita 3.
export function UnsavedChangesModal({ open, onSave, onDiscard, onCancel, saving = false }) {
  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-[60] flex items-center justify-center p-4"
      style={{ backgroundColor: "rgba(0,0,0,0.45)" }}
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
    >
      <div className="relative w-full max-w-sm rounded-2xl bg-surface-container-lowest p-6 shadow-2xl" style={{ animation: "modal-pop 0.18s ease-out" }}>
        <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-primary-container/30">
          <AlertTriangle className="h-6 w-6 text-primary" />
        </div>
        <h2 className="mb-2 text-[16px] font-bold text-on-surface">Tienes cambios sin guardar</h2>
        <p className="mb-5 text-[13.5px] leading-relaxed text-on-surface-variant">¿Quieres guardarlos antes de salir?</p>
        <div className="flex flex-col gap-2">
          {onSave && (
            <button
              onClick={onSave}
              disabled={saving}
              className="rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {saving ? "Guardando..." : "Guardar y salir"}
            </button>
          )}
          <button
            onClick={onDiscard}
            disabled={saving}
            className="rounded-xl border border-error/40 px-5 py-2.5 text-[13px] font-semibold text-error transition hover:bg-error/5 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Descartar cambios
          </button>
          <button
            onClick={onCancel}
            disabled={saving}
            className="rounded-xl border border-outline-variant px-5 py-2.5 text-[13px] font-semibold text-on-surface transition hover:bg-surface-variant disabled:cursor-not-allowed disabled:opacity-50"
          >
            Seguir editando
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
