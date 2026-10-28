import { useEffect, useState } from "react";
import { Link, useSearchParams, useOutletContext } from "react-router-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Check, Landmark, Sparkles, ArrowRight, Clock, ShieldCheck } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { KycSubmitForm } from "../../components/vendor/KycSubmitForm.jsx";
import { SubscriptionOverview } from "../../components/vendor/SubscriptionOverview.jsx";
import { PaymentChooser } from "../../components/vendor/PaymentChooser.jsx";
import { STAGE_META } from "../../lib/verificationMeta.js";
import { EnterpriseCta, PlansCatalog, usePublicPlans } from "../../components/plans/PlansCatalog.jsx";
import { PanelSkeleton } from "../../components/ui/Skeleton.jsx";

// Pantalla "Suscripción" del panel (antes "Verificación y plan"): el trámite de verificación (documentos, revisión y pago) y,
// con la tienda verificada, el resumen de su suscripción. Con tarjeta el pago se hace en Stripe y la tienda queda verificada
// sola al confirmarse; en CUP el pago es manual (transferir y avisar), como siempre.

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
}

// El paso visual sale de Vendor.verificationStatus (ver STAGE_META). "Revisión de pago" solo aplica al pago en CUP: con
// tarjeta, Stripe confirma y la tienda pasa directo a verificada.
const STEPS = ["Documentos", "Revisión", "Pago", "Revisión de pago", "Verificado"];
const STAGE_STEP_STATES = {
  NOT_STARTED: ["active", "pending", "pending", "pending", "pending"],
  PENDING_DOCS: ["done", "active", "pending", "pending", "pending"],
  IN_REVIEW: ["done", "active", "pending", "pending", "pending"],
  VERIFIED: ["done", "done", "done", "done", "done"],
  REJECTED: ["active", "pending", "pending", "pending", "pending"],
};
function computeStepStates(status, claimed) {
  if (STAGE_STEP_STATES[status]) return STAGE_STEP_STATES[status];
  return claimed ? ["done", "done", "done", "active", "pending"] : ["done", "done", "active", "pending", "pending"];
}

function Step({ text, stepNumber, state }) {
  const circle = state === "done" ? "bg-verified text-white" : state === "active" ? "bg-secondary text-white" : "bg-surface-container-high text-outline";
  const label = state === "pending" ? "text-outline" : "text-on-surface";
  return (
    <div className="flex items-center gap-2">
      <div className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${circle}`}>{state === "done" ? <Check className="h-3.5 w-3.5" /> : stepNumber}</div>
      <span className={`text-[12.5px] font-semibold ${label}`}>{text}</span>
    </div>
  );
}

// Al volver de Stripe el aviso de pago puede tardar unos segundos en llegar: mientras tanto se vuelve a preguntar.
const RETURN_MESSAGES = {
  success: ["Pago recibido", "Estamos activando tu suscripción. Tarda unos segundos."],
  "trial-success": ["Tarjeta registrada", "Estamos activando tu prueba gratis. Hoy no se cobró nada."],
  "card-updated": ["Tarjeta guardada", "Si tenías un cobro pendiente, se cobra ahora con la tarjeta nueva."],
};

export default function VendorVerification() {
  const queryClient = useQueryClient();
  const { vendor } = useOutletContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [changingMethod, setChangingMethod] = useState(false);
  const [switchToCard, setSwitchToCard] = useState(false);
  const [waitingStripe, setWaitingStripe] = useState(false);

  // Esta pantalla dice si ya te aprobaron: siempre se pide de nuevo al entrar. Mientras se espera el aviso de Stripe, cada 2 s.
  const { data, isLoading } = useQuery({
    queryKey: ["my-verification"],
    queryFn: async () => (await api.get("/verification/me")).data.verification,
    refetchOnMount: "always",
    refetchInterval: waitingStripe ? 2000 : false,
  });

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  // Nombre, precio y beneficios de cada plan vienen de la configuración de planes del admin (GET /settings/plans).
  // `?plan=` llega desde la página pública de planes y preselecciona ese plan en el pago.
  const { data: publicPlans } = usePublicPlans();
  const planList = publicPlans?.plans ?? [];
  // Con un pago ya elegido manda su plan; al cambiar la forma de pago, el que se elija en pantalla.
  const urlPlan = searchParams.get("plan");
  const requestedPlan = data?.paymentMethod && !changingMethod ? data.paymentPlanType ?? urlPlan : urlPlan ?? data?.paymentPlanType;
  const badgePlans = planList.filter((p) => p.grantsBadge && !p.isFree && !p.contactOnly);
  const businessPlan = badgePlans.find((p) => p.planType === requestedPlan) ?? badgePlans.find((p) => p.highlighted) ?? badgePlans[badgePlans.length - 1];
  const basicPlan = planList.find((p) => p.planType === "REGULAR");
  const currentPlan = planList.find((p) => p.planType === vendor?.planType);
  const choosePlan = (planType) => {
    const next = new URLSearchParams(searchParams);
    next.set("plan", planType);
    setSearchParams(next, { replace: true });
  };

  // Plan de pago sin insignia (el Básico cuando deja de ser gratis): se paga desde acá, sin verificación.
  const { data: subscription } = useQuery({
    queryKey: ["my-subscription"],
    queryFn: async () => (await api.get("/verification/me/subscription")).data.subscription,
  });
  const paysWithoutBadge = !!subscription?.paysWithoutBadge;

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ["my-verification"] });
    queryClient.invalidateQueries({ queryKey: ["my-subscription"] });
    queryClient.invalidateQueries({ queryKey: ["vendor-trial"] });
    queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
  };

  // Vuelta desde Stripe (?stripe=success|trial-success|card-updated|cancel).
  useEffect(() => {
    const result = searchParams.get("stripe");
    if (!result) return;
    if (RETURN_MESSAGES[result]) {
      toast.success(...RETURN_MESSAGES[result]);
      setWaitingStripe(true);
      invalidate();
    } else if (result === "cancel") {
      toast.info("No se hizo ningún cobro. Puedes intentarlo cuando quieras.");
    }
    setSearchParams(
      (prev) => {
        prev.delete("stripe");
        return prev;
      },
      { replace: true }
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Deja de preguntar al quedar verificada (o a los 40 s, por si el aviso de Stripe se demora).
  useEffect(() => {
    if (!waitingStripe) return undefined;
    if (data?.verificationStatus === "VERIFIED") {
      setWaitingStripe(false);
      invalidate();
      return undefined;
    }
    const t = setTimeout(() => setWaitingStripe(false), 40_000);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [waitingStripe, data?.verificationStatus]);

  if (isLoading) return <PanelSkeleton />;

  const status = data?.verificationStatus ?? "NOT_STARTED";
  const meta = STAGE_META[status];
  const stepStates = computeStepStates(status, !!data?.paymentClaimedAt && data?.paymentMethod === "CUP_TRANSFER");
  const canSubmitDocs = status === "NOT_STARTED" || status === "REJECTED";
  const showOverview = status === "VERIFIED" || status === "PAYMENT_FAILED" || status === "SUSPENDED";
  // Elegir cómo pagar: aprobada sin método todavía, o queriendo cambiarlo, o con el plan vencido o el cobro fallido.
  const showChooser =
    (status === "PENDING_PAYMENT" && (!data?.paymentMethod || changingMethod || (data?.paymentMethod === "CARD" && !data?.stripePaidAt))) ||
    status === "PAYMENT_FAILED" ||
    status === "SUSPENDED" ||
    status === "PLAN_ENDED";
  // Pago en CUP elegido (o un pago con tarjeta antiguo, de antes del cobro automático, que pedía comprobante).
  const awaitingProofClaim =
    status === "PENDING_PAYMENT" && (data?.paymentMethod === "CUP_TRANSFER" || (data?.paymentMethod === "CARD" && !!data?.stripePaidAt)) && !changingMethod;

  return (
    <div className="max-w-[820px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={ShieldCheck} tone="green" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Suscripción</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        {status === "VERIFIED" ? "Tu plan, lo que incluye, cómo pagas y cuándo se renueva." : `Verifica tu tienda y activa el plan ${businessPlan?.name ?? "Premium"}.`}
      </p>

      {waitingStripe && status !== "VERIFIED" && (
        <p className="mb-5 flex items-center gap-2 rounded-xl border border-tertiary-accent/30 bg-tertiary-accent/[0.06] p-3.5 text-[13px] text-on-surface" role="status">
          <Clock className="h-4 w-4 flex-shrink-0 animate-pulse text-tertiary-accent" aria-hidden="true" /> Confirmando el pago con Stripe...
        </p>
      )}

      <div className="mb-5 overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest shadow-sm">
        <div className="flex items-center gap-4 p-6" style={{ background: `linear-gradient(135deg, ${meta.bg}, rgba(255,255,255,0))` }}>
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl shadow-sm" style={{ background: meta.color }}>
            <meta.Icon className="h-7 w-7 text-white" />
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[16.5px] font-bold text-on-surface">{meta.label}</span>
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: meta.bg, color: meta.color }}>
                Plan {currentPlan?.name ?? basicPlan?.name ?? "Básico"}
              </span>
            </div>
            <div className="text-[13px] text-on-surface-variant">
              {status === "NOT_STARTED" && "Sube tus documentos para empezar el trámite."}
              {(status === "PENDING_DOCS" || status === "IN_REVIEW") && `El equipo de ${settings?.siteName || "Baznova"} los está revisando · respuesta en unas 24 horas.`}
              {status === "PENDING_PAYMENT" && "Aprobamos tus documentos. Elige cómo pagar tu plan para terminar."}
              {status === "VERIFIED" && "Tu tienda tiene la insignia de verificada."}
              {status === "PAYMENT_FAILED" && "No pudimos cobrar tu plan. Resuélvelo abajo para recuperarlo, sin rehacer documentos."}
              {status === "SUSPENDED" && "Tu suscripción terminó. Reactívala abajo, sin rehacer documentos."}
              {status === "PLAN_ENDED" && `Tu tienda está en el plan ${basicPlan?.name ?? "Básico"}, sin la insignia. Tus documentos siguen aprobados: vuelve a ${businessPlan?.name ?? "Premium"} pagando abajo.`}
              {status === "REJECTED" && (data?.notes || "Tu solicitud fue rechazada. Vuelve a capturar los documentos e intenta de nuevo.")}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-surface-container-high px-6 py-5 sm:flex-row sm:items-center sm:gap-0">
          {STEPS.map((text, i) => (
            <div key={text} className={`flex items-center ${i < STEPS.length - 1 ? "sm:flex-1" : ""}`}>
              <Step text={text} stepNumber={String(i + 1)} state={stepStates[i]} />
              {i < STEPS.length - 1 && <div className="ml-auto hidden h-0.5 flex-1 sm:mx-3 sm:block" style={{ background: stepStates[i] === "done" ? "#0CAE53" : "#e4e2e3" }} />}
            </div>
          ))}
        </div>
      </div>

      {/* Mientras paga la verificación recién aprobada no se muestra este segundo selector de pago. */}
      {paysWithoutBadge && status !== "PENDING_PAYMENT" && (
        <>
          <div className="mb-3 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5 text-[13px] text-on-surface-variant">
            <p className="text-[15px] font-bold text-on-surface">Tu plan {subscription.planName}</p>
            {subscription.periodEnd && (
              <p className="mt-1">
                Próxima fecha de cobro: <strong className="text-on-surface">{new Date(subscription.periodEnd).toLocaleDateString("es-CU", { day: "numeric", month: "long", year: "numeric" })}</strong>. Lo que pagues ahora se suma desde esa fecha.
              </p>
            )}
            {subscription.pendingRenewal && (
              <Link to="/vendedor/pago-manual" className="mt-2 inline-flex min-h-11 items-center font-semibold text-tertiary-accent hover:underline">
                Tienes un pago en curso: ver los datos y avisar que pagaste
              </Link>
            )}
          </div>
          <PaymentChooser renewal onlyPlanType={vendor?.planType} title={`Pagar mi plan ${subscription.planName}`} intro="Elige cuántos meses pagar. Pagando varios meses juntos se aplica el descuento del plan." onChoseCup={invalidate} />
        </>
      )}

      {showOverview && <SubscriptionOverview onChoosePayment={() => setSwitchToCard(true)} />}

      {switchToCard && status === "VERIFIED" && (
        <PaymentChooser
          switching
          title="Pasar a cobro automático con tarjeta"
          intro="Lo que ya pagaste se respeta: el primer cobro con tarjeta es cuando vence."
          initialPlanType={vendor?.planType}
        />
      )}

      {!showOverview && status !== "VERIFIED" && (
        <>
          <div className="mb-5">
            <h2 className="mb-1 text-[15px] font-bold text-on-surface">Elige tu plan</h2>
            <p className="mb-5 text-[12.5px] text-on-surface-variant">
              Los planes con <strong className="text-on-surface">insignia de verificada</strong> se activan al terminar la verificación y pagar. El plan que elijas acá queda marcado en el pago.
            </p>
            <PlansCatalog
              compact
              currentPlanType={vendor?.planType}
              cta={(plan, { dark, current, supportWhatsapp }) => {
                if (plan.contactOnly) return <EnterpriseCta plan={plan} supportWhatsapp={supportWhatsapp} dark={dark} />;
                const base = "flex min-h-12 w-full items-center justify-center rounded-2xl px-4 text-[14px] font-extrabold transition";
                if (current || !plan.grantsBadge || plan.isFree) {
                  return <span className={`${base} border ${dark ? "border-white/30 text-white/85" : "border-outline-variant text-on-surface-variant"}`}>{current ? "Es tu plan actual" : "Sin verificación"}</span>;
                }
                const picked = businessPlan?.planType === plan.planType;
                return (
                  <button
                    type="button"
                    aria-pressed={picked}
                    onClick={() => choosePlan(plan.planType)}
                    className={`${base} ${picked ? (dark ? "bg-white text-primary" : "bg-tertiary-accent text-white") : dark ? "bg-secondary-container text-on-secondary-container hover:brightness-95" : "bg-primary text-on-primary hover:bg-primary-container"}`}
                  >
                    {picked ? (
                      <>
                        <Check className="mr-1.5 h-4 w-4" aria-hidden="true" /> Elegido
                      </>
                    ) : (
                      `Elegir ${plan.name}`
                    )}
                  </button>
                );
              }}
            />
          </div>
        </>
      )}

      {canSubmitDocs && <KycSubmitForm vendor={vendor} siteName={settings?.siteName} onSubmitted={invalidate} />}

      {status === "PENDING_PAYMENT" && data?.paymentDeadlineAt && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-tertiary-accent/30 bg-tertiary-accent/[0.06] p-4 text-[12.5px] text-on-surface-variant">
          <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-tertiary-accent" />
          <p>
            Tienes hasta el <strong className="text-on-surface">{fmtDateTime(data.paymentDeadlineAt)}</strong> (24 horas desde la aprobación) para pagar. Si el plazo vence sin un pago
            confirmado, vas a tener que volver a enviar tus documentos.
          </p>
        </div>
      )}

      {showChooser && (
        <>
          {changingMethod && (
            <button type="button" onClick={() => setChangingMethod(false)} className="mb-2 min-h-10 text-[12.5px] font-semibold text-tertiary-accent hover:underline">
              Volver
            </button>
          )}
          <PaymentChooser
            title={status === "PENDING_PAYMENT" ? "¿Cómo vas a pagar tu plan?" : "Elegir otra forma de pago"}
            intro={status === "PENDING_PAYMENT" ? "Con tarjeta tu tienda se verifica al instante. En CUP, cuando el equipo confirme la transferencia." : "Si prefieres, también puedes pagar de otra forma."}
            initialPlanType={businessPlan?.planType}
            onPlanChange={choosePlan}
            onChoseCup={() => {
              // El plan ya quedó guardado en el pago: el del enlace (?plan=) deja de mandar.
              const next = new URLSearchParams(searchParams);
              next.delete("plan");
              setSearchParams(next, { replace: true });
              setChangingMethod(false);
              invalidate();
            }}
          />
        </>
      )}

      {awaitingProofClaim && (
        <div className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-6 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
          <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
            <Landmark className="h-4.5 w-4.5 text-tertiary-accent" /> {data?.paymentMethod === "CARD" ? "Pago con tarjeta recibido" : "Transferencia en CUP"}
          </div>
          {data?.paymentClaimedAt ? (
            <p className="flex items-center gap-2 text-[13px] font-bold text-tertiary-accent">
              <Clock className="h-4 w-4 flex-shrink-0" /> En revisión: el equipo confirma en unas horas.
            </p>
          ) : (
            <>
              <p className="mb-4 text-[12.5px] leading-5 text-outline">
                {data?.paymentMethod === "CARD"
                  ? "Stripe ya confirmó tu pago. Sube la captura (o indica que no pudiste) para que el equipo lo confirme."
                  : `Transfiere ${data?.paymentMonths ? `${data.paymentMonths} ${data.paymentMonths === 1 ? "mes" : "meses"}` : "el monto"} y avisa "Ya pagué" para activar tu plan.`}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link to="/vendedor/pago-manual" className="inline-flex min-h-11 items-center gap-2 rounded-xl bg-secondary-container px-4 text-[13px] font-bold text-on-secondary-container">
                  {data?.paymentMethod === "CARD" ? "Subir comprobante" : "Empezar con el proceso de pago"} <ArrowRight className="h-4 w-4" />
                </Link>
                <button type="button" onClick={() => setChangingMethod(true)} className="min-h-11 text-[12.5px] font-semibold text-tertiary-accent hover:underline">
                  Cambiar forma de pago
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {!showOverview && status === "VERIFIED" && currentPlan?.includes && (
        <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
            <Sparkles className="h-4 w-4 text-tertiary-accent" /> Tu plan incluye
          </div>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {currentPlan.includes.map((f) => (
              <div key={f} className="flex items-center gap-2 text-[12.5px] text-on-surface-variant">
                <Check className="h-3.5 w-3.5 flex-shrink-0 text-verified" strokeWidth={2.5} />
                {f}
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
