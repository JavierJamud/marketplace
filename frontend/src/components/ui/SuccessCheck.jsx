import { useEffect } from "react";
import { Check } from "lucide-react";

// Único patrón de "animación de confirmación" del proyecto (Bloque 16) — se
// reutiliza en todos los momentos que piden un check animado en vez de un
// simple toast (pedido de mesa enviado, pago de suscripción confirmado), en
// vez de inventar una animación distinta por pantalla.
export function SuccessCheck({ title, message, onDone, autoCloseMs = 2200 }) {
  useEffect(() => {
    const t = setTimeout(() => onDone?.(), autoCloseMs);
    return () => clearTimeout(t);
  }, [onDone, autoCloseMs]);

  return (
    <div
      className="fixed inset-0 z-[100] flex animate-overlay-in items-center justify-center bg-black/45 px-4"
      onClick={() => onDone?.()}
    >
      <div className="flex max-w-[340px] flex-col items-center rounded-xl bg-surface-container-lowest px-8 py-9 text-center shadow-xl">
        <div className="mb-4 flex h-16 w-16 animate-check-pop items-center justify-center rounded-full bg-verified/15">
          <Check className="h-8 w-8 text-verified-dark" strokeWidth={3} />
        </div>
        <div className="mb-1 text-[16px] font-bold text-on-surface">{title}</div>
        {message && <p className="text-[13px] leading-5 text-on-surface-variant">{message}</p>}
      </div>
    </div>
  );
}
