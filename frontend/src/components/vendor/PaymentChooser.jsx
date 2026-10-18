import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { CreditCard, Landmark, Lock, Minus, Plus } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";

// Elegir cómo pagar la suscripción.
//  - Tarjeta: se elige el plazo (1, 3, 6 o 12 meses) y un solo botón lleva a la página de pago de Stripe. Al pagar, la tienda
//    queda verificada sola (sin comprobante) y Stripe renueva por el mismo plazo hasta que se cancele.
//  - Transferencia en CUP: se eligen los meses (1 a 24) y sigue el pago manual de siempre (transferir y avisar "Ya pagué").
const CARD_INTERVALS = [1, 3, 6, 12];
const CUP_MIN = 1;
const CUP_MAX = 24;

function every(n) {
  return n === 1 ? "cada mes" : `cada ${n} meses`;
}

export function PaymentChooser({ cardPriceUsd = 25, cupPrice = 2500, title = "¿Cómo vas a pagar tu plan?", intro, onChoseCup, switching = false }) {
  const [method, setMethod] = useState("CARD");
  const [cardMonths, setCardMonths] = useState(1);
  const [cupMonths, setCupMonths] = useState(1);

  const startCard = useMutation({
    mutationFn: async () => (await api.post("/verification/me/card-subscription", { months: cardMonths })).data,
    onSuccess: (d) => window.location.assign(d.url),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo abrir el pago con Stripe."),
  });
  const chooseCup = useMutation({
    mutationFn: async () => (await api.patch("/verification/me/payment-method", { method: "CUP_TRANSFER", months: cupMonths })).data,
    onSuccess: () => {
      toast.success("Listo", "Ahora haz la transferencia y avisa cuando hayas pagado.");
      onChoseCup?.();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el método de pago."),
  });

  const option = (active) => `flex min-h-11 flex-1 items-start gap-3 rounded-xl border p-4 text-left transition-colors ${active ? "border-tertiary-accent bg-tertiary-accent/[0.06]" : "border-outline-variant hover:border-tertiary-accent/60"}`;
  const cardTotal = cardPriceUsd * cardMonths;

  return (
    <section className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] sm:p-6" aria-labelledby="pay-title">
      <h2 id="pay-title" className="text-[15px] font-bold text-on-surface">
        {title}
      </h2>
      {intro && <p className="mt-1 text-[12.5px] text-on-surface-variant">{intro}</p>}

      <div role="radiogroup" aria-label="Forma de pago" className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <button type="button" role="radio" aria-checked={method === "CARD"} onClick={() => setMethod("CARD")} className={option(method === "CARD")}>
          <CreditCard className="mt-0.5 h-5 w-5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
          <span>
            <span className="block text-[13.5px] font-bold text-on-surface">Tarjeta (Visa, Mastercard)</span>
            <span className="block text-[12px] text-on-surface-variant">Se activa al instante y se renueva sola. Cancela cuando quieras.</span>
          </span>
        </button>
        {!switching && (
          <button type="button" role="radio" aria-checked={method === "CUP"} onClick={() => setMethod("CUP")} className={option(method === "CUP")}>
            <Landmark className="mt-0.5 h-5 w-5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
            <span>
              <span className="block text-[13.5px] font-bold text-on-surface">Transferencia en CUP</span>
              <span className="block text-[12px] text-on-surface-variant">Pago manual: transfieres y el equipo lo confirma.</span>
            </span>
          </button>
        )}
      </div>

      {method === "CARD" ? (
        <div className="mt-4">
          <p className="mb-2 text-[12.5px] font-semibold text-on-surface">Cada cuánto se cobra</p>
          <div role="radiogroup" aria-label="Plazo" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CARD_INTERVALS.map((m) => (
              <button
                key={m}
                type="button"
                role="radio"
                aria-checked={cardMonths === m}
                onClick={() => setCardMonths(m)}
                className={`min-h-12 rounded-xl border px-2 text-center ${cardMonths === m ? "border-primary bg-primary text-white" : "border-outline-variant text-on-surface hover:border-primary/60"}`}
              >
                <span className="block text-[13.5px] font-bold">{m === 1 ? "1 mes" : `${m} meses`}</span>
                <span className={`block text-[11.5px] ${cardMonths === m ? "text-white/85" : "text-on-surface-variant"}`}>{(cardPriceUsd * m).toLocaleString("es-CU")} USD</span>
              </button>
            ))}
          </div>
          <p className="mt-3 text-[12.5px] text-on-surface-variant">
            {switching
              ? `El primer cobro con tarjeta es cuando vence lo que ya pagaste; después ${cardTotal.toLocaleString("es-CU")} USD ${every(cardMonths)}.`
              : `Se cobran ${cardTotal.toLocaleString("es-CU")} USD ahora y ${every(cardMonths)} hasta que canceles. Tu tienda se verifica al confirmarse el pago.`}
          </p>
          <button type="button" onClick={() => startCard.mutate()} disabled={startCard.isPending} className="mt-3 flex min-h-12 w-full items-center justify-center gap-2 rounded-xl bg-primary px-5 text-[14px] font-bold text-white hover:bg-primary/90 disabled:opacity-60 sm:w-auto">
            <Lock className="h-4 w-4" aria-hidden="true" /> {startCard.isPending ? "Abriendo Stripe..." : "Continuar al pago con Stripe"}
          </button>
          <p className="mt-2 text-[11.5px] text-outline">El pago se hace en la página segura de Stripe. Tus datos de tarjeta no pasan por nuestro sitio.</p>
        </div>
      ) : (
        <div className="mt-4">
          <p className="mb-2 text-[12.5px] font-semibold text-on-surface">Meses a pagar</p>
          <div className="flex flex-wrap items-center gap-3">
            <div className="flex items-center rounded-xl border border-outline-variant">
              <button type="button" onClick={() => setCupMonths((m) => Math.max(CUP_MIN, m - 1))} disabled={cupMonths <= CUP_MIN} aria-label="Un mes menos" className="flex h-11 w-11 items-center justify-center text-on-surface disabled:opacity-30">
                <Minus className="h-4 w-4" />
              </button>
              <span className="w-12 text-center text-[15px] font-bold text-on-surface" aria-live="polite">
                {cupMonths}
              </span>
              <button type="button" onClick={() => setCupMonths((m) => Math.min(CUP_MAX, m + 1))} disabled={cupMonths >= CUP_MAX} aria-label="Un mes más" className="flex h-11 w-11 items-center justify-center text-on-surface disabled:opacity-30">
                <Plus className="h-4 w-4" />
              </button>
            </div>
            <span className="text-[13.5px] font-bold text-on-surface">{(cupPrice * cupMonths).toLocaleString("es-CU")} CUP</span>
          </div>
          <button type="button" onClick={() => chooseCup.mutate()} disabled={chooseCup.isPending} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-[14px] font-bold text-white hover:bg-primary/90 disabled:opacity-60 sm:w-auto">
            {chooseCup.isPending ? "Guardando..." : "Continuar con transferencia"}
          </button>
        </div>
      )}
    </section>
  );
}
