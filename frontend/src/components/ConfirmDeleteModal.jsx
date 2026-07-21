import { AlertTriangle } from "lucide-react";

// Confirmación genérica para acciones destructivas del admin (Bloque 12:
// eliminar tienda/cliente). Soft-delete en el backend, pero la UI no ofrece
// forma de deshacerlo — por eso la advertencia es tajante.
export function ConfirmDeleteModal({ title, description, confirmLabel = "Eliminar", pending, onConfirm, onCancel }) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
      <div className="w-full max-w-sm rounded-xl bg-surface-container-lowest p-6 text-center">
        <div className="mx-auto mb-3.5 flex h-12 w-12 items-center justify-center rounded-full bg-error/10">
          <AlertTriangle className="h-6 w-6 text-error" />
        </div>
        <h2 className="mb-1.5 text-title-lg font-bold text-on-surface">{title}</h2>
        <p className="mb-5 text-[13px] text-outline">{description} Esta acción no se puede deshacer.</p>
        <div className="flex gap-2.5">
          <button
            onClick={onCancel}
            disabled={pending}
            className="flex-1 rounded-md border border-outline-variant py-2.5 text-label-md font-semibold text-on-surface-variant disabled:opacity-50"
          >
            Cancelar
          </button>
          <button
            onClick={onConfirm}
            disabled={pending}
            className="flex-1 rounded-md bg-error py-2.5 text-label-md font-bold text-on-error disabled:opacity-50"
          >
            {pending ? "Eliminando..." : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
