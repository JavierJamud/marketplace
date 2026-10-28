import { useState } from "react";
import { Link } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { AlertTriangle, CalendarClock, Check, CreditCard, History, Landmark, RefreshCw, Sparkles } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { ConfirmModal } from "../ConfirmModal.jsx";
import { CardListSkeleton } from "../ui/Skeleton.jsx";

// Resumen de la suscripción en la pantalla "Suscripción" del panel. Muestra lo que incluye el plan (lo que el admin configura
// en Suscripciones), el precio, cómo paga, la tarjeta, desde cuándo está suscrita, el periodo actual, cuánto le queda y el
// próximo cobro. Con tarjeta: cancelar (sigue con Premium hasta el final de lo pagado), reactivar (si ya venció, se cobra en
// el momento con la tarjeta guardada) y cambiar la tarjeta (página de Stripe). En CUP: renovar con transferencia.
const BRAND = { visa: "Visa", mastercard: "Mastercard", amex: "American Express", discover: "Discover", diners: "Diners", jcb: "JCB", unionpay: "UnionPay" };
const METHOD_LABEL = {
  CARD: "Tarjeta, cobro automático",
  CUP_TRANSFER: "Transferencia en CUP (pago manual)",
  MANUAL: "Pago registrado por el equipo",
  TRIAL: "Prueba gratis",
};

function fmtDate(iso) {
  return iso ? new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "long", year: "numeric" }) : "Sin dato";
}
function fmtMoney(amount, currency) {
  if (amount == null) return null;
  return `${Number(amount).toLocaleString("es-CU")} ${currency ?? ""}`.trim();
}
function every(n) {
  return n === 1 ? "cada mes" : `cada ${n} meses`;
}

export function SubscriptionOverview({ onChoosePayment }) {
  const queryClient = useQueryClient();
  const [confirmCancel, setConfirmCancel] = useState(false);
  const [showHistory, setShowHistory] = useState(false);
  const { data: s, isLoading, isError, refetch } = useQuery({
    queryKey: ["my-subscription"],
    queryFn: async () => (await api.get("/verification/me/subscription")).data.subscription,
    refetchOnMount: "always",
  });

  const refresh = () => {
    queryClient.invalidateQueries({ queryKey: ["my-subscription"] });
    queryClient.invalidateQueries({ queryKey: ["my-verification"] });
    queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
  };
  const goToStripe = (url) => {
    window.location.assign(url);
  };

  const cancel = useMutation({
    mutationFn: async () => (await api.post("/verification/me/card-subscription/cancel")).data,
    onSuccess: () => {
      toast.success("Suscripción cancelada", "Sigues con todo hasta el final de lo que pagaste.");
      setConfirmCancel(false);
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cancelar."),
  });
  const reactivate = useMutation({
    mutationFn: async () => (await api.post("/verification/me/card-subscription/reactivate")).data,
    onSuccess: (d) => {
      if (d.status === "needs_card") {
        toast.warning("Tu tarjeta no pasó", "Te llevamos a Stripe para poner otra y pagar.");
        goToStripe(d.url);
        return;
      }
      toast.success(d.status === "charged" ? "Suscripción reactivada y cobrada" : "Suscripción reactivada");
      refresh();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo reactivar."),
  });
  const updateCard = useMutation({
    mutationFn: async () => (await api.post("/verification/me/card-subscription/update-card")).data,
    onSuccess: (d) => goToStripe(d.url),
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo abrir Stripe."),
  });

  if (isLoading) return <CardListSkeleton />;
  if (isError)
    return (
      <p className="mb-5 text-[13px] text-error">
        No se pudo cargar tu suscripción.{" "}
        <button type="button" onClick={() => refetch()} className="font-semibold underline">
          Reintentar
        </button>
      </p>
    );
  if (!s) return null;

  const isCard = s.method === "CARD";
  const statusChip = s.paymentFailed
    ? { label: "Cobro fallido", cls: "bg-error/10 text-error" }
    : s.status === "SUSPENDED"
      ? { label: "Vencida", cls: "bg-error/10 text-error" }
      : s.inTrial
        ? { label: s.cancelAtPeriodEnd ? "Prueba gratis, cancelada" : "Prueba gratis", cls: "bg-tertiary-accent/10 text-tertiary-accent" }
        : s.cancelAtPeriodEnd
          ? { label: "Cancelada: termina al vencer", cls: "bg-secondary-container/30 text-on-surface" }
          : { label: "Activa", cls: "bg-verified/10 text-verified-dark" };
  const card = s.card ? `${BRAND[s.card.brand] ?? s.card.brand} terminada en ${s.card.last4} · vence ${String(s.card.expMonth).padStart(2, "0")}/${String(s.card.expYear).slice(-2)}` : null;
  const box = "rounded-xl bg-surface-container/60 px-3 py-2.5";

  return (
    <section className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 shadow-sm sm:p-6" aria-labelledby="sub-title">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
        <h2 id="sub-title" className="flex items-center gap-2 text-[16px] font-bold text-on-surface">
          <RefreshCw className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Plan {s.planName}
        </h2>
        <span className={`rounded-full px-2.5 py-1 text-[12px] font-bold ${statusChip.cls}`}>{statusChip.label}</span>
      </div>

      {/* El equipo programó el paso al plan Regular: hasta esa fecha sigue todo igual y no se renueva. */}
      {s.planDowngradeAt && (
        <div role="status" className="mb-4 flex gap-2 rounded-xl border border-secondary/30 bg-secondary-container/30 p-3.5 text-[13px] text-on-surface">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-secondary" aria-hidden="true" />
          <p>
            Tu tienda pasará al plan Básico el <strong>{new Date(s.planDowngradeAt).toLocaleDateString("es-CU", { day: "numeric", month: "long", year: "numeric" })}</strong>.
            Hasta ese día tienes todas las funciones Premium y no se te cobra la renovación.
            {s.planDowngradeReason ? ` Motivo: ${s.planDowngradeReason}.` : ""} Si quieres mantener Premium, escríbenos en Mensajes.
          </p>
        </div>
      )}

      {s.paymentFailed && isCard && (
        <div className="mb-4 flex flex-col gap-2 rounded-xl border border-error/30 bg-error/5 p-3.5 sm:flex-row sm:items-center">
          <p className="flex min-w-0 flex-1 gap-2 text-[13px] text-on-surface">
            <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0 text-error" aria-hidden="true" />
            Stripe no pudo cobrar tu tarjeta. Pon otra tarjeta: se cobra en el momento y recuperas todo.
          </p>
          <button type="button" onClick={() => updateCard.mutate()} disabled={updateCard.isPending} className="min-h-11 rounded-xl bg-primary px-4 text-[13px] font-bold text-white disabled:opacity-60">
            {updateCard.isPending ? "Abriendo Stripe..." : "Poner otra tarjeta y pagar"}
          </button>
        </div>
      )}

      <dl className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2">
        <div className={box}>
          <dt className="text-[11.5px] text-outline">Precio</dt>
          <dd className="text-[14px] font-bold text-on-surface">
            {s.inTrial && !isCard ? "Gratis durante la prueba" : s.amount != null ? `${fmtMoney(s.amount, s.currency)}${s.intervalMonths ? ` ${every(s.intervalMonths)}` : ""}` : "Sin dato"}
          </dd>
        </div>
        <div className={box}>
          <dt className="text-[11.5px] text-outline">Cómo pagas</dt>
          <dd className="text-[14px] font-bold text-on-surface">{METHOD_LABEL[s.method] ?? "Sin dato"}</dd>
          {card && <dd className="text-[12px] text-on-surface-variant">{card}</dd>}
        </div>
        <div className={box}>
          <dt className="text-[11.5px] text-outline">Suscrita desde</dt>
          <dd className="text-[14px] font-bold text-on-surface">{fmtDate(s.subscribedSince)}</dd>
        </div>
        <div className={box}>
          <dt className="text-[11.5px] text-outline">{s.inTrial ? "La prueba termina" : "Periodo actual"}</dt>
          <dd className="text-[14px] font-bold text-on-surface">{s.inTrial ? fmtDate(s.periodEnd) : `${fmtDate(s.periodStart)} al ${fmtDate(s.periodEnd)}`}</dd>
        </div>
        <div className={box}>
          <dt className="text-[11.5px] text-outline">Te quedan</dt>
          <dd className={`text-[14px] font-bold ${s.daysRemaining != null && s.daysRemaining <= 7 ? "text-error" : "text-on-surface"}`}>
            {s.daysRemaining == null ? "Sin dato" : s.daysRemaining < 0 ? "Vencida" : s.daysRemaining === 0 ? "Vence hoy" : `${s.daysRemaining} ${s.daysRemaining === 1 ? "día" : "días"}`}
          </dd>
        </div>
        <div className={box}>
          <dt className="flex items-center gap-1 text-[11.5px] text-outline">
            <CalendarClock className="h-3.5 w-3.5" aria-hidden="true" /> Próximo cobro
          </dt>
          <dd className="text-[14px] font-bold text-on-surface">
            {s.nextCharge
              ? `${fmtMoney(s.nextCharge.amount, s.nextCharge.currency)} el ${fmtDate(s.nextCharge.at)}`
              : s.cancelAtPeriodEnd
                ? "Ninguno: cancelaste la renovación"
                : isCard
                  ? "Ninguno"
                  : "Pago manual antes de que venza"}
          </dd>
        </div>
      </dl>

      {s.features?.length > 0 && (
        <div className="mb-4">
          <h3 className="mb-1.5 flex items-center gap-1.5 text-[12.5px] font-bold text-on-surface">
            <Sparkles className="h-4 w-4 text-tertiary-accent" aria-hidden="true" /> Tu plan incluye
          </h3>
          <ul className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
            {s.features.map((f) => (
              <li key={f} className="flex items-start gap-2 text-[13px] text-on-surface-variant">
                <Check className="mt-0.5 h-3.5 w-3.5 flex-shrink-0 text-verified-dark" strokeWidth={2.5} aria-hidden="true" /> {f}
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="flex flex-col gap-2 border-t border-surface-container-high pt-4 sm:flex-row sm:flex-wrap">
        {s.canReactivate ? (
          <button type="button" onClick={() => reactivate.mutate()} disabled={reactivate.isPending} className="min-h-11 rounded-xl bg-verified-dark px-4 text-[13px] font-bold text-white disabled:opacity-60">
            {reactivate.isPending ? "Reactivando..." : s.status === "VERIFIED" ? "Reactivar suscripción" : card ? `Reactivar y cobrar a la tarjeta ${s.card.last4}` : "Reactivar suscripción"}
          </button>
        ) : (
          ((s.status === "VERIFIED" && s.planType !== "REGULAR") || s.paysWithoutBadge) && (
            <button type="button" onClick={() => setConfirmCancel(true)} className="min-h-11 rounded-xl border border-error px-4 text-[13px] font-bold text-error hover:bg-error/5">
              Cancelar suscripción
            </button>
          )
        )}
        {isCard && !s.paymentFailed && (
          <button type="button" onClick={() => updateCard.mutate()} disabled={updateCard.isPending} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-outline-variant px-4 text-[13px] font-semibold text-on-surface disabled:opacity-60">
            <CreditCard className="h-4 w-4" aria-hidden="true" /> {updateCard.isPending ? "Abriendo Stripe..." : "Cambiar tarjeta"}
          </button>
        )}
        {!isCard && s.status === "VERIFIED" && !s.inTrial && (
          <button type="button" onClick={onChoosePayment} className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-outline-variant px-4 text-[13px] font-semibold text-on-surface">
            <CreditCard className="h-4 w-4" aria-hidden="true" /> Pasar a cobro automático con tarjeta
          </button>
        )}
        {s.pendingRenewal && (
          <Link to="/vendedor/pago-manual" className="flex min-h-11 items-center justify-center gap-1.5 rounded-xl border border-outline-variant px-4 text-[13px] font-semibold text-on-surface">
            <Landmark className="h-4 w-4" aria-hidden="true" /> Renovación en CUP en curso ({s.pendingRenewal.months} {s.pendingRenewal.months === 1 ? "mes" : "meses"})
          </Link>
        )}
      </div>
      {isCard && !s.cancelAtPeriodEnd && s.status === "VERIFIED" && (
        <p className="mt-2 text-[12px] text-on-surface-variant">Se renueva sola {s.intervalMonths ? every(s.intervalMonths) : ""} con tu tarjeta. Si cancelas, sigues con todo hasta el final de lo que pagaste.</p>
      )}

      {s.history?.length > 0 && (
        <div className="mt-4 border-t border-surface-container-high pt-3">
          <button type="button" onClick={() => setShowHistory((v) => !v)} aria-expanded={showHistory} className="flex min-h-10 items-center gap-1.5 text-[12.5px] font-semibold text-tertiary-accent">
            <History className="h-4 w-4" aria-hidden="true" /> {showHistory ? "Ocultar" : "Ver"} historial de pagos ({s.history.length})
          </button>
          {showHistory && (
            <ul className="mt-2 flex flex-col gap-1.5">
              {s.history.map((h) => (
                <li key={h.id} className="rounded-lg bg-surface-container/60 px-3 py-2 text-[12.5px] text-on-surface-variant">
                  <span className="font-semibold text-on-surface">{fmtMoney(h.amount, h.currency) ?? "Sin monto"}</span> · {h.months} {h.months === 1 ? "mes" : "meses"} ·{" "}
                  {h.automatic ? "cobro automático con tarjeta" : METHOD_LABEL[h.paymentMethod] ?? h.paymentMethod} · {fmtDate(h.confirmedAt)}
                  {h.periodEnd ? ` · cubre hasta el ${fmtDate(h.periodEnd)}` : ""}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmCancel}
        title={`¿Cancelar el plan ${s.planName}?`}
        message={`No pierdes nada ahora: sigues con todo lo que incluye tu plan hasta el ${fmtDate(s.periodEnd)}. ${isCard ? "No se te volverá a cobrar. " : ""}Después pasas al plan gratis. Puedes reactivarla antes de esa fecha con un solo botón.`}
        confirmLabel={cancel.isPending ? "Cancelando..." : "Sí, cancelar"}
        danger
        onConfirm={() => cancel.mutate()}
        onCancel={() => setConfirmCancel(false)}
      />
    </section>
  );
}
