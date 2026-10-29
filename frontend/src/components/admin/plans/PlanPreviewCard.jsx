import { Check } from "lucide-react";

const fmt = (n, digits = 0) => Number(n ?? 0).toLocaleString("es-CU", { minimumFractionDigits: digits, maximumFractionDigits: 2 });

// "Así lo ve la tienda": la tarjeta del plan como aparece en /planes y en "Tu plan incluye" del panel del vendedor. Los datos
// (`card`) los arma el servidor con la misma función que publica el plan (previewCard en adminPlans.controller.js), así lo
// que se ve aquí es lo que se publicará. Muestra el precio de 1 mes; los descuentos por meses se ven en la página de planes.
export function PlanPreviewCard({ card }) {
  if (!card) return null;
  const lines = card.includes ?? [];
  return (
    <div className={`rounded-2xl border bg-surface-container-lowest p-5 ${card.highlighted ? "border-secondary-container" : "border-surface-container-high"}`}>
      {card.highlighted && <span className="mb-2 inline-block rounded-full bg-secondary-container px-2.5 py-0.5 text-[11.5px] font-bold text-on-secondary-container">Más elegido</span>}
      <p className="font-display text-[19px] font-extrabold leading-tight text-on-surface">{card.displayName}</p>
      {card.tagline && <p className="mt-1 text-[13px] text-on-surface-variant">{card.tagline}</p>}
      <div className="mt-3">
        {card.contactOnly ? (
          <p className="text-[15px] font-bold text-on-surface">Precio a convenir por WhatsApp</p>
        ) : card.isFree ? (
          <>
            <p className="font-display text-[24px] font-extrabold text-on-surface">Gratis</p>
            {(card.listPriceCup || card.listPriceUsd) && (
              <p className="text-[12.5px] text-on-surface-variant">
                Antes <s>{card.listPriceCup ? `${fmt(card.listPriceCup)} CUP` : ""}{card.listPriceCup && card.listPriceUsd ? " · " : ""}{card.listPriceUsd ? `US$ ${fmt(card.listPriceUsd, 2)}` : ""}</s>
              </p>
            )}
          </>
        ) : (
          <>
            <p className="font-display text-[24px] font-extrabold text-on-surface">{fmt(card.priceCup)} CUP</p>
            <p className="text-[12.5px] text-on-surface-variant">o US$ {fmt(card.priceUsd, 2)}, al mes</p>
          </>
        )}
      </div>
      <p className="mb-2 mt-4 text-[11.5px] font-bold uppercase tracking-wide text-outline">Incluye</p>
      {lines.length ? (
        <ul className="grid gap-1.5">
          {lines.map((line) => (
            <li key={line} className="flex items-start gap-2 text-[13px] text-on-surface">
              <Check className="mt-0.5 h-4 w-4 flex-shrink-0 text-verified" strokeWidth={2.5} aria-hidden="true" />
              {line}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-[13px] text-on-surface-variant">Este plan todavía no anuncia ninguna función.</p>
      )}
      {!card.isPublic && <p className="mt-4 rounded-lg bg-surface-container-low px-3 py-2 text-[12px] text-on-surface-variant">Está oculto: no sale en la página de planes hasta que lo muestres.</p>}
    </div>
  );
}
