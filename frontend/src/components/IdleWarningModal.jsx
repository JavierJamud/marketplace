import { Clock } from "lucide-react";

// Aviso de "¿sigues ahí?" a los 25 minutos sin actividad: 5 minutos de cuenta regresiva y, sin el clic, la sesión se
// cierra a los 30 (ver AuthContext.jsx).
// A diferencia de ConfirmModal, este SÍ es intencionalmente no descartable
// haciendo clic afuera o con Escape: la única forma de seguir es el clic
// explícito en "Sigo aquí" (tal como se pidió — actividad ambiente no
// cuenta mientras este aviso está activo, ver AuthContext.jsx).
export function IdleWarningModal({ secondsLeft, onConfirm }) {
  const minutes = Math.floor(secondsLeft / 60);
  const seconds = secondsLeft % 60;
  const formatted = `${minutes}:${String(seconds).padStart(2, "0")}`;

  return (
    <div className="fixed inset-0 z-[200] flex items-center justify-center bg-black/50 p-4">
      <div className="modal-panel-6 relative w-full max-w-sm rounded-2xl bg-surface-container-lowest p-6 text-center shadow-2xl motion-safe:animate-modal-pop">
        <div className="mx-auto mb-4 flex h-12 w-12 items-center justify-center rounded-full bg-error/10">
          <Clock className="h-6 w-6 text-error" />
        </div>

        <h2 className="mb-2 text-[16px] font-bold text-on-surface">¿Sigues ahí?</h2>
        <p className="mb-1 text-[13.5px] leading-relaxed text-on-surface-variant">
          Tu sesión está inactiva y se va a cerrar por seguridad.
        </p>
        <p className="mb-5 text-[28px] font-bold tabular-nums text-error">{formatted}</p>

        <button
          onClick={onConfirm}
          className="w-full rounded-xl bg-primary px-5 py-2.5 text-[13px] font-semibold text-white transition hover:bg-primary/90 active:bg-primary/80"
        >
          Sigo aquí
        </button>
      </div>

    </div>
  );
}
