import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Clock, Sparkles } from "lucide-react";
import { api } from "../../lib/api.js";

// Prueba gratis activa ("Free 30 días"): franja con los días que quedan, en todo el panel del dueño. Desde 7 días antes del
// final cambia a aviso: qué pasa al terminar y dónde elegir cómo pagar (el mismo aviso llega por correo a los 7, 3 y 1 días).
const DAY = 24 * 60 * 60 * 1000;

export function TrialStatusBanner({ vendor }) {
  const { data } = useQuery({
    queryKey: ["vendor-trial"],
    queryFn: async () => (await api.get("/vendors/me/trial")).data.trial,
    enabled: !!vendor?.id,
    staleTime: 20_000,
  });
  if (!data?.trialEndsAt) return null;
  const endsAt = new Date(data.trialEndsAt);
  const daysLeft = Math.ceil((endsAt.getTime() - Date.now()) / DAY);
  if (daysLeft <= 0) return null;
  const ending = daysLeft <= 7;
  const left = daysLeft === 1 ? "Queda 1 día" : `Quedan ${daysLeft} días`;
  const endLabel = endsAt.toLocaleDateString("es-CU", { day: "numeric", month: "long" });

  return (
    <div
      role="status"
      className={`mb-4 flex gap-2 rounded-2xl border px-4 py-3 sm:flex-row sm:items-center sm:justify-between ${ending ? "flex-col" : "flex-row items-center justify-between"} ${ending ? "border-error/30 bg-error/[0.06]" : "border-tertiary-accent/25 bg-tertiary-accent/[0.06]"}`}
    >
      <div className="flex min-w-0 items-start gap-3">
        {ending ? <Clock className="mt-0.5 h-5 w-5 flex-shrink-0 text-error" aria-hidden="true" /> : <Sparkles className="mt-0.5 h-5 w-5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />}
        <div className="min-w-0">
          <p className="text-[13.5px] font-bold text-on-surface">
            Free 30 días · {left}
          </p>
          {/* Mientras falta más de una semana, en el celular basta con la línea de arriba: el detalle ocupaba media pantalla en
              cada sección del panel. Cerca del final se muestra siempre, porque ahí sí hay que actuar. */}
          <p className={`text-[12.5px] leading-[18px] text-on-surface-variant ${ending ? "" : "hidden sm:block"}`}>
            {ending
              ? `Tu Premium gratis termina el ${endLabel}. Elige cómo pagar para seguir en Premium; si no, tu tienda pasa sola a Regular y los productos que pasen de su límite quedan ocultos (no se borran).`
              : `Tienes todas las funciones Premium gratis hasta el ${endLabel}.`}
          </p>
        </div>
      </div>
      <Link to="/vendedor/verificacion" className={`inline-flex min-h-10 flex-shrink-0 items-center justify-center rounded-lg px-3 text-[12.5px] font-bold ${ending ? "bg-primary text-on-primary" : "border border-outline-variant text-on-surface"}`}>
        {ending ? "Elegir cómo pagar" : "Ver mi plan"}
      </Link>
    </div>
  );
}
