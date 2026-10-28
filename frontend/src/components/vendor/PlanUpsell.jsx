import { Link } from "react-router-dom";
import { Lock } from "lucide-react";

// Aviso de "esta función es del plan de pago" para las pantallas del panel que el servidor responde con 403 + planRequired.
// Explica qué se gana y lleva a Verificación y plan, en vez de un error genérico.
export function PlanUpsell({ title, text }) {
  return (
    <div className="rounded-2xl border border-secondary/40 bg-secondary-container/15 p-5">
      <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
        <Lock className="h-4 w-4 text-secondary" aria-hidden="true" /> {title}
      </div>
      <p className="mb-3 text-[13px] leading-[19px] text-on-surface-variant">{text}</p>
      <Link to="/vendedor/verificacion" className="inline-flex min-h-11 items-center rounded-xl bg-secondary-container px-4 text-[13.5px] font-bold text-on-secondary-container hover:brightness-95">
        Ver los planes
      </Link>
    </div>
  );
}

export const isPlanError = (err) => err?.response?.status === 403 && !!err?.response?.data?.details?.planRequired;
