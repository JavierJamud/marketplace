import { AlertTriangle } from "lucide-react";

// Confirmación genérica para acciones destructivas del admin (Bloque 12:
// eliminar tienda/cliente). Soft-delete en el backend, pero la UI no ofrece
// forma de deshacerlo — por eso la advertencia es tajante.
// Bloque 147: `zIndex` opcional (default "z-50", el de siempre) — el
// mini-carrito (CartDrawer.jsx) vive en z-[61], por encima del z-50 de
// siempre, así que necesita poder pedir un z-index más alto para que la
// confirmación de "Vaciar carrito" quede realmente arriba del panel, no
// tapada detrás — el resto de los usos (todos a nivel de página completa,
// sin nada más apilado encima) no pasan este prop y siguen igual.
export function ConfirmDeleteModal({ title, description, confirmLabel = "Eliminar", pending, onConfirm, onCancel, zIndex = "z-50" }) {
  return (
    // Bloque 196 (pedido explícito — "si se hace clic fuera de un
    // contenedor mostrado como ventana o popup en el panel debe cerrarse
    // automáticamente"): clic afuera = Cancelar, nunca Confirmar — es una
    // acción destructiva, así que el afuera siempre tiene que ser la salida
    // segura, jamás dispare el borrado solo.
    <div
      className={`fixed inset-0 ${zIndex} flex items-center justify-center bg-black/50 p-4`}
      onClick={(e) => { if (e.target === e.currentTarget && !pending) onCancel?.(); }}
    >
      <div className="max-h-[90vh] w-full max-w-sm overflow-y-auto rounded-xl bg-surface-container-lowest p-6 text-center">
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
