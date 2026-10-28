import { useEffect, useId, useMemo, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { useNavigate } from "react-router-dom";
import { CreditCard, Landmark, Lock, Minus, Plus } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { planPrice, usePublicPlans } from "../plans/PlansCatalog.jsx";

// Elegir cómo pagar la suscripción.
//  - Tarjeta: se elige el plazo (1, 3, 6 o 12 meses) y un solo botón lleva a la página de pago de Stripe. Al pagar, la tienda
//    queda verificada sola (sin comprobante) y Stripe renueva por el mismo plazo hasta que se cancele.
//  - Transferencia en CUP: se eligen los meses (1 a 24) y sigue el pago manual de siempre (transferir y avisar "Ya pagué").
// Antes se elige el plan: solo los de pago que dan la insignia (los demás no pasan por la verificación). Precios y
// descuentos por meses salen de la configuración del admin; el servidor vuelve a calcular el total al cobrar.
//
// `renewal` + `onlyPlanType`: pagar más meses de un plan sin verificación (el Básico cuando deja de ser gratis). Es un pago
// único por los meses elegidos, con tarjeta en Stripe o por transferencia (sigue en Pago manual), que se suma a la fecha
// de cobro cuando el equipo lo confirma.
const CARD_INTERVALS = [1, 3, 6, 12];
const CUP_MIN = 1;
const CUP_MAX = 24;

const fmt = (n, currency) => `${Number(n).toLocaleString("es-CU", { maximumFractionDigits: currency === "USD" ? 2 : 0 })} ${currency}`;

function every(n) {
  return n === 1 ? "cada mes" : `cada ${n} meses`;
}

export function PaymentChooser({ initialPlanType, title = "¿Cómo vas a pagar tu plan?", intro, onChoseCup, switching = false, renewal = false, onlyPlanType, onPlanChange }) {
  const navigate = useNavigate();
  const titleId = useId();
  const [method, setMethod] = useState("CARD");
  const [cardMonths, setCardMonths] = useState(1);
  const [cupMonths, setCupMonths] = useState(1);
  const { data: plansData, isLoading: plansLoading, isError: plansError, refetch } = usePublicPlans();
  const plans = useMemo(
    () => (plansData?.plans ?? []).filter((p) => (onlyPlanType ? p.planType === onlyPlanType : p.grantsBadge) && !p.isFree && !p.contactOnly),
    [plansData, onlyPlanType]
  );
  const [planType, setPlanType] = useState(null);
  // Si se elige otro plan desde fuera (las tarjetas de planes de la misma pantalla), el pago lo sigue.
  useEffect(() => {
    if (initialPlanType) setPlanType(initialPlanType);
  }, [initialPlanType]);
  useEffect(() => {
    if (planType && plans.some((p) => p.planType === planType)) return;
    const preferred = plans.find((p) => p.planType === initialPlanType) ?? plans.find((p) => p.highlighted) ?? plans[plans.length - 1];
    if (preferred) setPlanType(preferred.planType);
  }, [plans, initialPlanType, planType]);
  const plan = plans.find((p) => p.planType === planType);

  const startCard = useMutation({
    mutationFn: async () =>
      renewal
        ? (await api.patch("/verification/me/subscription/payment-method", { method: "CARD", months: cardMonths, planType })).data
        : (await api.post("/verification/me/card-subscription", { months: cardMonths, planType })).data,
    onSuccess: (d) => {
      const url = renewal ? d.subscriptionPayment?.stripeCheckoutUrl : d.url;
      if (url) window.location.assign(url);
      else toast.error("No se pudo abrir el pago con Stripe.");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo abrir el pago con Stripe."),
  });
  const chooseCup = useMutation({
    mutationFn: async () =>
      (await api.patch(renewal ? "/verification/me/subscription/payment-method" : "/verification/me/payment-method", { method: "CUP_TRANSFER", months: cupMonths, planType })).data,
    onSuccess: () => {
      toast.success("Listo", "Ahora haz la transferencia y avisa cuando hayas pagado.");
      onChoseCup?.();
      if (renewal) navigate("/vendedor/pago-manual");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el método de pago."),
  });

  const option = (active) => `flex min-h-11 flex-1 items-start gap-3 rounded-xl border p-4 text-left transition-colors ${active ? "border-tertiary-accent bg-tertiary-accent/[0.06]" : "border-outline-variant hover:border-tertiary-accent/60"}`;

  if (plansLoading) return <section className="mb-5 h-40 animate-pulse rounded-2xl bg-surface-container-low" aria-busy="true" aria-label="Cargando planes" />;
  if (plansError || !plan) {
    return (
      <section className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5 text-[13px] text-on-surface-variant">
        No pudimos cargar los planes.{" "}
        <button type="button" onClick={() => refetch()} className="min-h-11 font-semibold text-tertiary-accent hover:underline">
          Reintentar
        </button>
      </section>
    );
  }
  const card = planPrice(plan, cardMonths, "USD");
  const cup = planPrice(plan, cupMonths, "CUP");
  const cupDiscounts = (plan.monthDiscounts ?? []).filter((d) => d.cup > 0);

  return (
    <section className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] sm:p-6" aria-labelledby={titleId}>
      <h2 id={titleId} className="text-[15px] font-bold text-on-surface">
        {title}
      </h2>
      {intro && <p className="mt-1 text-[12.5px] text-on-surface-variant">{intro}</p>}

      {plans.length > 1 && (
        <div className="mt-4">
          <p className="mb-2 text-[12.5px] font-semibold text-on-surface">Plan</p>
          <div role="radiogroup" aria-label="Plan" className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {plans.map((p) => (
              <button key={p.planType} type="button" role="radio" aria-checked={planType === p.planType} onClick={() => {
                  setPlanType(p.planType);
                  onPlanChange?.(p.planType);
                }} className={option(planType === p.planType)}>
                <span className="min-w-0">
                  <span className="block text-[13.5px] font-bold text-on-surface">{p.name}</span>
                  <span className="block text-[12px] text-on-surface-variant">
                    {fmt(p.priceCup, "CUP")} o {fmt(p.priceUsd, "USD")} al mes
                  </span>
                  {p.tagline && <span className="mt-0.5 block text-[11.5px] text-on-surface-variant">{p.tagline}</span>}
                </span>
              </button>
            ))}
          </div>
          <a href="/planes" target="_blank" rel="noreferrer" className="mt-1.5 inline-flex min-h-11 items-center text-[12.5px] font-semibold text-tertiary-accent hover:underline">
            Comparar lo que incluye cada plan
          </a>
        </div>
      )}

      <div role="radiogroup" aria-label="Forma de pago" className="mt-4 flex flex-col gap-2.5 sm:flex-row">
        <button type="button" role="radio" aria-checked={method === "CARD"} onClick={() => setMethod("CARD")} className={option(method === "CARD")}>
          <CreditCard className="mt-0.5 h-5 w-5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
          <span>
            <span className="block text-[13.5px] font-bold text-on-surface">Tarjeta (Visa, Mastercard)</span>
            <span className="block text-[12px] text-on-surface-variant">{renewal ? "Pago único en la página segura de Stripe." : "Se activa al instante y se renueva sola. Cancela cuando quieras."}</span>
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
          <p className="mb-2 text-[12.5px] font-semibold text-on-surface">{renewal ? "Meses a pagar" : "Cada cuánto se cobra"}</p>
          <div role="radiogroup" aria-label="Plazo" className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {CARD_INTERVALS.map((m) => {
              const q = planPrice(plan, m, "USD");
              const on = cardMonths === m;
              return (
                <button
                  key={m}
                  type="button"
                  role="radio"
                  aria-checked={on}
                  onClick={() => setCardMonths(m)}
                  className={`min-h-12 rounded-xl border px-2 py-1.5 text-center ${on ? "border-primary bg-primary text-white" : "border-outline-variant text-on-surface hover:border-primary/60"}`}
                >
                  <span className="block text-[13.5px] font-bold">{m === 1 ? "1 mes" : `${m} meses`}</span>
                  <span className={`block text-[11.5px] ${on ? "text-white/85" : "text-on-surface-variant"}`}>{fmt(q.total, "USD")}</span>
                  {q.pct > 0 && <span className={`block text-[11px] font-semibold ${on ? "text-white" : "text-verified-dark"}`}>{q.pct}% menos</span>}
                </button>
              );
            })}
          </div>
          <p className="mt-3 text-[12.5px] text-on-surface-variant">
            {renewal
              ? `Plan ${plan.name}: pagas ${fmt(card.total, "USD")} una sola vez por ${cardMonths === 1 ? "1 mes" : `${cardMonths} meses`}, que se suman a tu fecha de cobro.`
              : switching
              ? `El primer cobro con tarjeta es cuando vence lo que ya pagaste; después ${fmt(card.total, "USD")} ${every(cardMonths)}.`
              : `Plan ${plan.name}: se cobran ${fmt(card.total, "USD")} ahora y ${every(cardMonths)} hasta que canceles. Tu tienda se verifica al confirmarse el pago.`}
            {card.pct > 0 && ` Incluye ${card.pct}% de descuento (sin él serían ${fmt(card.gross, "USD")}).`}
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
            <span className="text-[13.5px] font-bold text-on-surface">
              {cup.pct > 0 && <span className="mr-1.5 font-normal text-on-surface-variant line-through">{fmt(cup.gross, "CUP")}</span>}
              {fmt(cup.total, "CUP")}
            </span>
            {cup.pct > 0 && <span className="rounded-full bg-verified/10 px-2 py-0.5 text-[11.5px] font-bold text-verified-dark">{cup.pct}% menos</span>}
          </div>
          {cupDiscounts.length > 0 && (
            <p className="mt-2 text-[12px] text-on-surface-variant">Descuentos: {cupDiscounts.map((d) => `${d.months} meses o más, ${d.cup}%`).join(" · ")}.</p>
          )}
          <button type="button" onClick={() => chooseCup.mutate()} disabled={chooseCup.isPending} className="mt-3 flex min-h-12 w-full items-center justify-center rounded-xl bg-primary px-5 text-[14px] font-bold text-white hover:bg-primary/90 disabled:opacity-60 sm:w-auto">
            {chooseCup.isPending ? "Guardando..." : "Continuar con transferencia"}
          </button>
        </div>
      )}
    </section>
  );
}
