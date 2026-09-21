import { useEffect, useState } from "react";
import { Link, useSearchParams, useOutletContext, useNavigate } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Check, CreditCard, Landmark, ExternalLink, Sparkles, ArrowRight, Clock, Minus, Plus, RefreshCw, History, ShieldCheck } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { CameraCapture } from "../../components/CameraCapture.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { BENEFITS, PLANS, STAGE_META } from "../../lib/verificationMeta.js";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "long", year: "numeric" });
}

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "long", hour: "2-digit", minute: "2-digit" });
}

// Bloque 150 (pedido explícito — "el cliente podrá seleccionar cuántos
// meses desea pagar, mínimo 1, máximo 24"): mismo rango que valida el
// backend (verification.controller.js) — este mínimo/máximo es solo para
// la UI (deshabilitar +/-), la validación real siempre la hace el servidor.
const MIN_MONTHS = 1;
const MAX_MONTHS = 24;

function fmtCup(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}
function fmtUsd(n) {
  return `US$ ${Number(n).toLocaleString("en-US")}`;
}

// Bloque 64: fuente única de verdad — el paso visual de este stepper se
// deriva directo de Vendor.verificationStatus (ver STAGE_META), ya no de un
// "stage" en español traducido server-side aparte.
// Bloque 153 (pedido explícito — "en el paso 3, después de pago, debe
// haber un paso extra que será revisión de pago"): "Pago" (elegir método y
// completarlo) y "Revisión de pago" (ya se reclamó, esperando que el admin
// confirme) pasan a ser 2 pasos distintos — antes un solo "Pago" cubría
// las 2 cosas, sin distinguir si el vendedor ya había hecho su parte o no.
const STEPS = ["Documentos", "Revisión", "Pago", "Revisión de pago", "Verificado"];
// Estático para los estados que no dependen de nada más — PENDING_PAYMENT/
// PAYMENT_FAILED/SUSPENDED necesitan saber además si ya se reclamó el pago
// (`paymentClaimedAt`), ver computeStepStates.
const STAGE_STEP_STATES = {
  NOT_STARTED: ["active", "pending", "pending", "pending", "pending"],
  PENDING_DOCS: ["done", "active", "pending", "pending", "pending"],
  IN_REVIEW: ["done", "active", "pending", "pending", "pending"],
  VERIFIED: ["done", "done", "done", "done", "done"],
  REJECTED: ["active", "pending", "pending", "pending", "pending"],
};
function computeStepStates(status, claimed) {
  if (STAGE_STEP_STATES[status]) return STAGE_STEP_STATES[status];
  // PENDING_PAYMENT / PAYMENT_FAILED / SUSPENDED: "Pago" queda hecho y
  // "Revisión de pago" pasa a activo recién cuando ya se reclamó el pago
  // ("Ya pagué") — antes de eso, el paso activo sigue siendo "Pago".
  return claimed ? ["done", "done", "done", "active", "pending"] : ["done", "done", "active", "pending", "pending"];
}

function Step({ text, stepNumber, state }) {
  const circle =
    state === "done" ? "bg-verified text-white" : state === "active" ? "bg-secondary text-white" : "bg-surface-container-high text-outline";
  const label = state === "pending" ? "text-outline" : "text-on-surface";
  return (
    <div className="flex items-center gap-2">
      <div className={`flex h-[26px] w-[26px] flex-shrink-0 items-center justify-center rounded-full text-[12px] font-bold ${circle}`}>
        {state === "done" ? <Check className="h-3.5 w-3.5" /> : stepNumber}
      </div>
      <span className={`text-[12.5px] font-semibold ${label}`}>{text}</span>
    </div>
  );
}

function fmtDaysLabel(n) {
  if (n == null) return "—";
  if (n < 0) return "vencida";
  if (n === 0) return "vence hoy";
  return `${n} ${n === 1 ? "día" : "días"}`;
}

// Bloque 153 (pedido explícito — "una vez el cliente esté verificado, en la
// sección de suscripción de su panel podrá ver cuántos días vence la
// suscripción del mes actual, la fecha de inicio y fecha de fin, y podrá
// activar un nuevo mes o varios... el proceso será casi igual... se
// guardará todo ese historial"): tarjeta propia, solo visible con la
// tienda VERIFIED — período vigente + renovar (mismo selector de método+
// meses que el ciclo inicial, sobre SubscriptionPayment en vez de
// VerificationRequest) + historial real de renovaciones ya confirmadas.
function SubscriptionCard({ vendor, settings }) {
  const queryClient = useQueryClient();
  const [months, setMonths] = useState(MIN_MONTHS);
  const [choosing, setChoosing] = useState(false);
  const [showHistory, setShowHistory] = useState(false);

  const { data: subscription, isLoading } = useQuery({
    queryKey: ["my-subscription"],
    queryFn: async () => (await api.get("/verification/me/subscription")).data.subscription,
    refetchOnMount: "always",
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["my-subscription"] });

  const chooseRenewal = useMutation({
    mutationFn: async (method) => (await api.patch("/verification/me/subscription/payment-method", { method, months })).data,
    onSuccess: (data) => {
      toast.success(data.subscriptionPayment.paymentMethod === "CARD" ? "Te generamos tu link de pago con Stripe." : "Método elegido.");
      setChoosing(false);
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo iniciar la renovación."),
  });

  const retryStripe = useMutation({
    mutationFn: async () => (await api.post("/verification/me/subscription/stripe-checkout/retry")).data,
    onSuccess: () => {
      toast.success("Nuevo link de pago generado.");
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo generar un nuevo link."),
  });

  if (isLoading || !subscription) return null;

  const pending = subscription.pendingRenewal;
  const daysRemaining = subscription.daysRemaining;

  return (
    <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
      <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
        <RefreshCw className="h-4 w-4 text-tertiary-accent" /> Tu suscripción
      </div>
      <div className="mb-4 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <div>
          <div className="text-[11px] text-outline">Inicio del ciclo actual</div>
          <div className="text-[13.5px] font-bold text-on-surface">{subscription.periodStart ? fmtDate(subscription.periodStart) : "—"}</div>
        </div>
        <div>
          <div className="text-[11px] text-outline">Vence</div>
          <div className="text-[13.5px] font-bold text-on-surface">{subscription.periodEnd ? fmtDate(subscription.periodEnd) : "—"}</div>
        </div>
        <div>
          <div className="text-[11px] text-outline">Días restantes</div>
          <div className={`text-[13.5px] font-bold ${daysRemaining != null && daysRemaining <= 7 ? "text-error" : "text-on-surface"}`}>
            {fmtDaysLabel(daysRemaining)}
          </div>
        </div>
      </div>

      {pending ? (
        <div className="rounded-md border border-surface-container-high p-4">
          <div className="mb-1.5 text-[13px] font-bold text-on-surface">
            Renovación en curso — {pending.months} {pending.months === 1 ? "mes" : "meses"}
          </div>
          {pending.paymentClaimedAt ? (
            <p className="flex items-center gap-1.5 text-[12.5px] font-semibold text-tertiary-accent">
              <Clock className="h-3.5 w-3.5 flex-shrink-0" /> En revisión — el equipo confirma en unas horas.
            </p>
          ) : pending.paymentMethod === "CARD" && !pending.stripePaidAt ? (
            <div className="flex flex-wrap items-center gap-2.5">
              {pending.stripeCheckoutUrl && !pending.stripeCheckoutExpired ? (
                <a
                  href={pending.stripeCheckoutUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded bg-secondary-container px-3.5 py-2 text-[12.5px] font-bold text-on-secondary-container"
                >
                  <ExternalLink className="h-3.5 w-3.5" /> Ir a pagar con Stripe
                </a>
              ) : (
                <button
                  onClick={() => retryStripe.mutate()}
                  disabled={retryStripe.isPending}
                  className="rounded bg-secondary-container px-3.5 py-2 text-[12.5px] font-bold text-on-secondary-container disabled:opacity-50"
                >
                  {retryStripe.isPending ? "Generando..." : "Generar link de pago"}
                </button>
              )}
            </div>
          ) : (
            <Link
              to="/vendedor/pago-manual"
              className="inline-flex items-center gap-2 text-[12.5px] font-bold text-tertiary-accent hover:underline"
            >
              {pending.paymentMethod === "CARD" ? "Subir comprobante" : "Empezar con el proceso de pago"} <ArrowRight className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      ) : choosing ? (
        <div className="rounded-md border border-surface-container-high p-4">
          <div className="mb-3 flex items-center justify-between gap-2">
            <span className="text-[12.5px] font-bold text-on-surface">¿Cuántos meses quieres pagar?</span>
            <button type="button" onClick={() => setChoosing(false)} className="text-[11.5px] font-semibold text-on-surface-variant hover:underline">
              Cancelar
            </button>
          </div>
          <div className="mb-3 flex items-center gap-3">
            <div className="flex items-center rounded-lg border border-outline-variant">
              <button
                type="button"
                onClick={() => setMonths((m) => Math.max(MIN_MONTHS, m - 1))}
                disabled={months <= MIN_MONTHS}
                className="flex h-8 w-8 items-center justify-center text-on-surface disabled:opacity-30"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="number"
                min={MIN_MONTHS}
                max={MAX_MONTHS}
                value={months}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (Number.isFinite(n)) setMonths(Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, n)));
                }}
                className="h-8 w-14 border-x border-outline-variant bg-transparent text-center text-[13px] font-bold text-on-surface outline-none"
              />
              <button
                type="button"
                onClick={() => setMonths((m) => Math.min(MAX_MONTHS, m + 1))}
                disabled={months >= MAX_MONTHS}
                className="flex h-8 w-8 items-center justify-center text-on-surface disabled:opacity-30"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
          </div>
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            <button
              onClick={() => chooseRenewal.mutate("CARD")}
              disabled={chooseRenewal.isPending}
              className="flex flex-col items-start gap-1.5 rounded-lg border border-outline-variant p-3 text-left hover:border-tertiary-accent disabled:opacity-50"
            >
              <CreditCard className="h-4 w-4 text-tertiary-accent" />
              <div className="text-[12.5px] font-bold text-on-surface">Tarjeta</div>
              <p className="text-[11.5px] text-outline">{fmtUsd((settings?.cardSubscriptionPriceUsd ?? 25) * months)}</p>
            </button>
            <button
              onClick={() => chooseRenewal.mutate("CUP_TRANSFER")}
              disabled={chooseRenewal.isPending}
              className="flex flex-col items-start gap-1.5 rounded-lg border border-outline-variant p-3 text-left hover:border-tertiary-accent disabled:opacity-50"
            >
              <Landmark className="h-4 w-4 text-tertiary-accent" />
              <div className="text-[12.5px] font-bold text-on-surface">Transferencia CUP</div>
              <p className="text-[11.5px] text-outline">{fmtCup((settings?.cupSubscriptionPriceCup ?? 2500) * months)}</p>
            </button>
          </div>
        </div>
      ) : (
        <button
          onClick={() => setChoosing(true)}
          className="rounded-xl border border-outline-variant px-4 py-2.5 text-[13px] font-bold text-on-surface-variant hover:border-tertiary-accent"
        >
          Renovar / pagar meses por adelantado
        </button>
      )}

      {subscription.history.length > 0 && (
        <div className="mt-4 border-t border-surface-container-high pt-3.5">
          <button
            onClick={() => setShowHistory((s) => !s)}
            className="flex items-center gap-1.5 text-[12px] font-semibold text-on-surface-variant hover:underline"
          >
            <History className="h-3.5 w-3.5" /> {showHistory ? "Ocultar" : "Ver"} historial de renovaciones ({subscription.history.length})
          </button>
          {showHistory && (
            <div className="mt-2.5 flex flex-col gap-2">
              {subscription.history.map((h) => (
                <div key={h.id} className="rounded-md bg-surface-container px-3 py-2 text-[12px] text-on-surface-variant">
                  {h.months} {h.months === 1 ? "mes" : "meses"} · {Number(h.amount).toLocaleString("es-CU")} {h.currency} ·{" "}
                  {h.paymentMethod === "CARD" ? "Tarjeta" : "Transferencia CUP"} · confirmado {fmtDate(h.confirmedAt)} · vence{" "}
                  {fmtDate(h.periodEnd)}
                </div>
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

export default function VendorVerification() {
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const { vendor } = useOutletContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [fullName, setFullName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  // Bloque 150 (pedido explícito): cuántos meses de adelanto paga el
  // vendedor — se elige junto con el método, un solo paso.
  const [months, setMonths] = useState(MIN_MONTHS);
  // Bloque 151 (pedido explícito — "el vendedor o la tienda puede cambiar
  // si luego se arrepiente de esa forma de pago... quiero que pueda
  // cambiar ahí"): antes de este bloque, una vez elegido un método
  // (CARD/CUP) el selector desaparecía para siempre mientras siguiera en
  // PENDING_PAYMENT — el backend (`chooseMyPaymentMethod`) ya aceptaba
  // elegirlo de nuevo sin ningún cambio (limpia el rastro del anterior
  // igual que ya hacía para SUSPENDED/PAYMENT_FAILED), pero la UI nunca
  // ofrecía la forma de volver a abrirlo. Este flag fuerza a mostrar el
  // selector de nuevo bajo pedido explícito del vendedor.
  const [changingMethod, setChangingMethod] = useState(false);
  const [selfieBlob, setSelfieBlob] = useState(null);
  const [idBlob, setIdBlob] = useState(null);
  // Bloque 146: opcional — solo se llena si el navegador soporta detección
  // de rostro + MediaRecorder (ver CameraCapture.jsx). Nunca bloquea el
  // envío si queda en null.
  const [selfieVideoBlob, setSelfieVideoBlob] = useState(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);
  // Bloque 66 (pedido explícito): datos legales de la tienda, pedidos desde
  // el arranque del trámite junto con los documentos — nunca en una fase
  // posterior. Todos privados (nunca se exponen en el perfil público).
  const [idDocumentType, setIdDocumentType] = useState("");
  const [companyTaxId, setCompanyTaxId] = useState("");
  // Bloque 165 (bug real reportado en vivo — una tienda llegaba a VERIFIED
  // con esto vacío porque nunca se lo pedía en ningún lado): obligatorio
  // desde el arranque del trámite, junto con el resto de los datos legales.
  const [companyAddress, setCompanyAddress] = useState("");
  const [registrationCountryId, setRegistrationCountryId] = useState("");
  const [legalProvinceId, setLegalProvinceId] = useState("");
  const [legalMunicipalityId, setLegalMunicipalityId] = useState("");

  // Bloque 144 (bug real reportado en vivo — mismo caso que ["my-vendor"]
  // en VendorLayout.jsx, ver el comentario largo ahí): esta es LA pantalla
  // que muestra si ya te aprobaron o no — un dato en caché de hasta 5
  // minutos acá es directamente el bug que se reportó, no una molestia
  // menor. `refetchOnMount:"always"` obliga a pedirlo de nuevo cada vez
  // que se entra a esta página, sin importar qué tan fresco esté el caché.
  const { data, isLoading } = useQuery({
    queryKey: ["my-verification"],
    queryFn: async () => (await api.get("/verification/me")).data.verification,
    refetchOnMount: "always",
  });

  // Qué incluye cada plan (Regular/Business) — editable por el admin desde
  // AdminSubscriptions.jsx (ver PlanFeaturesCard), ya no un array hardcodeado.
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  // id/nombre/priceLabel de PLANS siguen estáticos — solo el array de
  // features viene ahora del backend.
  const mergedPlans = PLANS.map((p) => ({
    ...p,
    features: settings ? (p.id === "regular" ? settings.planFeaturesRegular : settings.planFeaturesBusiness) : p.features,
  }));
  const currentPlanFeatures = settings && (vendor?.planType === "BUSINESS" ? settings.planFeaturesBusiness : settings.planFeaturesRegular);

  // Bloque 66: mismo patrón de selects en cascada país → provincia →
  // municipio que ya usa VendorSettings.jsx para "países a los que entregas".
  const { data: countries = [] } = useQuery({
    queryKey: ["active-countries"],
    queryFn: async () => (await api.get("/locations/countries")).data.countries,
  });
  const { data: provincesForCountry = [] } = useQuery({
    queryKey: ["provinces-for-country", registrationCountryId],
    queryFn: async () => (await api.get(`/locations/countries/${registrationCountryId}/provinces`)).data.provinces,
    enabled: !!registrationCountryId,
  });
  const { data: municipalitiesForProvince = [] } = useQuery({
    queryKey: ["municipalities-for-province", legalProvinceId],
    queryFn: async () => (await api.get(`/locations/provinces/${legalProvinceId}/municipalities`)).data.municipalities,
    enabled: !!legalProvinceId,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["my-verification"] });

  // Bloque 25: Stripe redirige de vuelta acá con ?stripe=success|cancel.
  // Bloque 150 (pedido explícito — "automáticamente, después del pago, el
  // cliente será redirigido a la página de confirmación de pago... donde
  // podrá hacer la captura y subirla"): la confirmación del cobro (webhook)
  // ya no activa nada sola — deja `stripePaidAt` y el siguiente paso real es
  // subir el comprobante, así que success ahora manda derecho a
  // /vendedor/pago-manual en vez de quedarse acá esperando una activación
  // automática que ya no ocurre.
  useEffect(() => {
    const stripeResult = searchParams.get("stripe");
    if (!stripeResult) return;
    if (stripeResult === "success") {
      toast.success("¡Pago recibido! Sube la captura del pago para que el equipo lo confirme.");
      invalidate();
      navigate("/vendedor/pago-manual", { replace: true });
      return;
    }
    if (stripeResult === "cancel") {
      toast.info("Pago cancelado — puedes reintentar cuando quieras.");
    }
    setSearchParams((prev) => {
      prev.delete("stripe");
      return prev;
    }, { replace: true });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const submit = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      if (fullName) form.append("fullName", fullName);
      form.append("idNumber", idNumber);
      form.append("idDocumentType", idDocumentType);
      if (companyTaxId) form.append("companyTaxId", companyTaxId);
      form.append("companyAddress", companyAddress);
      form.append("registrationCountryId", registrationCountryId);
      form.append("legalProvinceId", legalProvinceId);
      if (legalMunicipalityId) form.append("legalMunicipalityId", legalMunicipalityId);
      form.append("selfie", selfieBlob, "selfie.jpg");
      form.append("idDocument", idBlob, "documento.jpg");
      // Bloque 146: opcional — solo se manda si el navegador lo pudo grabar.
      if (selfieVideoBlob) form.append("selfieVideo", selfieVideoBlob, "selfie-video.webm");
      return (await api.post("/verification/me", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(`Solicitud enviada. Un admin de ${settings?.siteName || "Baznova"} va a revisar tus documentos pronto.`);
      setSelfieBlob(null);
      setIdBlob(null);
      setSelfieVideoBlob(null);
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar la solicitud."),
  });

  const choosePaymentMethod = useMutation({
    mutationFn: async (method) => (await api.patch("/verification/me/payment-method", { method, months })).data,
    onSuccess: (data) => {
      toast.success(data.verification.paymentMethod === "CARD" ? "Te generamos tu link de pago con Stripe." : "Método de pago elegido.");
      setChangingMethod(false);
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el método de pago."),
  });

  // Bloque 25: "reintentar" — el Checkout Session anterior venció o el
  // vendedor cerró la pestaña de Stripe sin pagar; genera uno nuevo sin
  // tener que elegir el método de pago de nuevo.
  const retryStripeCheckout = useMutation({
    mutationFn: async () => (await api.post("/verification/me/stripe-checkout/retry")).data,
    onSuccess: () => {
      toast.success("Nuevo link de pago generado.");
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo generar un nuevo link."),
  });

  // Movido acá desde VendorSubscription.jsx (unificación: verificación y
  // plan eran dos páginas mostrando prácticamente lo mismo — ver nota de
  // borrado en ese archivo). Bloque 66 (pedido explícito): ya no vuelve a
  // Regular de inmediato — queda diferido hasta nextPaymentDueDate (ver
  // updateMyVendor en el backend); el vendedor puede volver a verificarse
  // cuando quiera, incluso antes de que la cancelación se haga efectiva.
  const cancelPlan = useMutation({
    mutationFn: async () => (await api.patch("/vendors/me", { planType: "REGULAR" })).data,
    onSuccess: () => {
      toast.success("Cancelación programada — sigues con acceso hasta el vencimiento de tu ciclo actual.");
      setConfirmingCancel(false);
      queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cancelar la suscripción."),
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;

  const status = data?.verificationStatus ?? "NOT_STARTED";
  const meta = STAGE_META[status];
  const stepStates = computeStepStates(status, !!data?.paymentClaimedAt);
  const canSubmitDocs = status === "NOT_STARTED" || status === "REJECTED";
  const isBusiness = vendor?.planType === "BUSINESS";
  // Bloque 66: mismo mínimo que exige submitVerification server-side — se
  // avisa acá antes de intentar enviar, en vez de dejar que el 400 del
  // backend sea la primera noticia.
  const descriptionTooShort = !vendor?.description || vendor.description.trim().length < 30;
  const canSubmit =
    !submit.isPending &&
    !!selfieBlob &&
    !!idBlob &&
    !!idDocumentType &&
    // Bloque 153 (pedido explícito): el nombre del responsable pasa a ser
    // obligatorio para poder enviar — mismo mínimo que exige el backend.
    fullName.trim().length >= 2 &&
    // Bloque 165 (pedido explícito — "esos son campos obligatorios a
    // llenar antes de verificar la tienda"): idNumber y companyAddress se
    // suman a la lista de obligatorios — antes idNumber era opcional y
    // companyAddress ni se pedía, lo que dejaba tiendas VERIFIED con estos
    // datos vacíos y sin forma de completarlos después (ver
    // updateMyVendor, backend, candado de identidad).
    idNumber.trim().length >= 4 &&
    companyAddress.trim().length > 0 &&
    !!registrationCountryId &&
    !!legalProvinceId &&
    !descriptionTooShort;

  // Bloque 150 (pedido explícito — "el cliente podrá seleccionar cuántos
  // meses desea pagar... si no se realiza el pago y se confirma,
  // automáticamente se deberán enviar nuevos datos"): ya no hay ninguna
  // suscripción que se renueve/reintente sola — CARD pasó a ser un pago
  // ÚNICO por un bloque de N meses, igual que CUP. Por eso PAYMENT_FAILED/
  // SUSPENDED (el bloque anterior se terminó o se revocó) siempre vuelven a
  // mostrar el selector de método+meses, sin importar qué habían elegido
  // antes — elegir de nuevo ES el gesto de renovar (mismo criterio que ya
  // regía para CUP desde el Bloque 64, ahora parejo para los 2 métodos).
  // `chooseMyPaymentMethod` (backend) transiciona a PENDING_PAYMENT apenas
  // se elige, así que el resto de las fases de abajo solo miran ese status.
  const showChooseMethod =
    (status === "PENDING_PAYMENT" && (!data?.paymentMethod || changingMethod)) || status === "PAYMENT_FAILED" || status === "SUSPENDED";
  // Tarjeta: falta pagar en Stripe (stripePaidAt todavía null). Bloque 151:
  // `!changingMethod` para que no se muestre esta sección Y el chooser al
  // mismo tiempo cuando el vendedor pide cambiar de método.
  const showCardCheckout = status === "PENDING_PAYMENT" && data?.paymentMethod === "CARD" && !data?.stripePaidAt && !changingMethod;
  // Bloque 150: CUP_TRANSFER (de siempre) Y CARD una vez que Stripe ya
  // confirmó el cobro (stripePaidAt) comparten el mismo paso siguiente —
  // subir el comprobante (o marcar que no se pudo) en /vendedor/pago-manual,
  // esa página ya sabe mostrar lo que corresponda según el método.
  const awaitingProofClaim =
    status === "PENDING_PAYMENT" &&
    (data?.paymentMethod === "CUP_TRANSFER" || (data?.paymentMethod === "CARD" && !!data?.stripePaidAt)) &&
    !changingMethod;

  return (
    <div className="max-w-[820px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={ShieldCheck} tone="green" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Verificación y plan</h1>
      </div>
      <p className="mb-[22px] text-[13.5px] text-outline">
        {status === "VERIFIED"
          ? "Estado de tu verificación y de tu plan actual."
          : `Obtén el badge verde de tienda verificada y desbloquea las funciones Business. La aprobación final siempre la hace el equipo de ${settings?.siteName || "Baznova"}.`}
      </p>

      <div className="mb-5 overflow-hidden rounded-2xl border border-surface-container-high bg-surface-container-lowest shadow-sm">
        <div
          className="flex items-center gap-4 p-6"
          style={{ background: `linear-gradient(135deg, ${meta.bg}, rgba(255,255,255,0))` }}
        >
          <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center rounded-2xl shadow-sm" style={{ background: meta.color }}>
            <meta.Icon className="h-7 w-7 text-white" />
          </div>
          <div>
            <div className="mb-1 flex flex-wrap items-center gap-2">
              <span className="text-[16.5px] font-bold text-on-surface">{meta.label}</span>
              <span className="rounded-full px-2.5 py-0.5 text-[11px] font-bold" style={{ background: meta.bg, color: meta.color }}>
                Plan {vendor?.planType === "BUSINESS" ? "Business" : "Regular"}
              </span>
            </div>
            <div className="text-[13px] text-on-surface-variant">
              {status === "NOT_STARTED" && "Sube tus documentos para empezar el trámite."}
              {(status === "PENDING_DOCS" || status === "IN_REVIEW") &&
                `Un admin de ${settings?.siteName || "Baznova"} los está revisando a mano · respuesta en ~24h.`}
              {status === "PENDING_PAYMENT" && "Elige cómo pagar la suscripción para activar el badge y el Plan Business."}
              {status === "VERIFIED" && "Tu tienda tiene el badge verde y el Plan Business activo."}
              {status === "PAYMENT_FAILED" && "No pudimos cobrar tu suscripción — resuelve el pago para recuperar el badge, sin rehacer documentos."}
              {status === "SUSPENDED" && "Tu suscripción ya no está activa. Elige un método de pago para reactivarla, sin rehacer documentos."}
              {status === "REJECTED" && (data?.notes || "Tu solicitud fue rechazada. Vuelve a capturar los documentos e intenta de nuevo.")}
            </div>
          </div>
        </div>
        <div className="flex flex-col gap-3 border-t border-surface-container-high px-6 py-5 sm:flex-row sm:items-center sm:gap-0">
          {/* Bloque 195 (bug real encontrado en auditoría — responsividad: la
              clase se armaba como `sm:${...}`, un template partido que
              Tailwind nunca puede detectar en su escaneo estático del código
              fuente — "sm:flex-1" jamás se generaba en el CSS compilado, así
              que en pantallas sm+ los pasos no se repartían el ancho
              disponible ni las líneas conectoras quedaban parejas): ahora la
              clase completa "sm:flex-1" aparece literal en el código. */}
          {STEPS.map((text, i) => (
            <div key={text} className={`flex items-center ${i < STEPS.length - 1 ? "sm:flex-1" : ""}`}>
              <Step text={text} stepNumber={String(i + 1)} state={stepStates[i]} />
              {i < STEPS.length - 1 && (
                <div className="ml-auto hidden h-0.5 flex-1 sm:mx-3 sm:block" style={{ background: stepStates[i] === "done" ? "#0CAE53" : "#e4e2e3" }} />
              )}
            </div>
          ))}
        </div>

        {isBusiness ? (
          <div className="border-t border-surface-container-high px-6 py-5">
            {data?.paymentConfirmedAt && (
              <p className="text-[13px] text-on-surface-variant">
                Business activo desde el <strong className="text-on-surface">{fmtDate(data.paymentConfirmedAt)}</strong>.
              </p>
            )}
            {/* Bloque 66 (pedido explícito): cancelar ya no revoca de
                inmediato — se muestra la fecha real en la que deja de tener
                acceso (Vendor.nextPaymentDueDate), no un "listo, ya está". */}
            {vendor?.cancelAtPeriodEnd ? (
              <p className="mt-3 rounded-md bg-surface-container px-3.5 py-2.5 text-[12.5px] text-on-surface-variant">
                Cancelación programada — sigues con el badge y el Plan Business
                {vendor?.nextPaymentDueDate ? (
                  <>
                    {" "}
                    hasta el <strong className="text-on-surface">{fmtDate(vendor.nextPaymentDueDate)}</strong>
                  </>
                ) : null}
                . Después de esa fecha vuelves al Plan Regular automáticamente.
              </p>
            ) : (
              <button
                onClick={() => setConfirmingCancel(true)}
                className="mt-3 rounded-xl border border-error px-4 py-2.5 text-[13px] font-bold text-error hover:bg-error/5"
              >
                Cancelar suscripción
              </button>
            )}
          </div>
        ) : null}
      </div>

      {status === "VERIFIED" && <SubscriptionCard vendor={vendor} settings={settings} />}

      {currentPlanFeatures && (
        <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
          <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
            <Sparkles className="h-4 w-4 text-tertiary-accent" /> Tu plan incluye
          </div>
          <p className="mb-3 text-[12.5px] text-outline">
            Plan {vendor?.planType === "BUSINESS" ? "Business" : "Regular"} — esto es lo que tienes disponible hoy.
          </p>
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {currentPlanFeatures.map((f) => (
              <div key={f} className="flex items-center gap-2 text-[12.5px] text-on-surface-variant">
                <Check className="h-3.5 w-3.5 flex-shrink-0 text-verified" strokeWidth={2.5} />
                {f}
              </div>
            ))}
          </div>
          {/* Bloque 51: política de ofertas configurable por el admin (ver
              AdminOffers.jsx) — se muestra acá para que el vendedor sepa,
              desde su plan/suscripción, cada cuánto puede publicar y cuánto
              dura activa una oferta por default. */}
          {isBusiness && settings?.offerCooldownDays && (
            <div className="mt-3 border-t border-surface-container-high pt-3 text-[12px] text-outline">
              📢 Ofertas: puedes publicar/republicar una nueva cada <strong className="text-on-surface">{settings.offerCooldownDays} días</strong>,
              activa hasta <strong className="text-on-surface">{settings.offerDefaultDurationDays} días</strong> por default.
            </div>
          )}
        </div>
      )}

      {/* Bloque 66 (pedido explícito): este bloque + la comparación de planes
          vivían al final de la página, después de los formularios de pago —
          se movieron para quedar inmediatamente debajo de "Tu plan incluye". */}
      {status !== "VERIFIED" && (
        <>
          <div className="mb-5 rounded-lg bg-gradient-to-br from-primary to-primary-container p-6 text-white">
            <div className="mb-3.5 text-[15px] font-bold">Al verificarte obtienes</div>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              {BENEFITS.map((b) => (
                <div key={b} className="flex items-center gap-2.5 text-[13px] text-white/85">
                  <Check className="h-[15px] w-[15px] flex-shrink-0 text-secondary-container" strokeWidth={2.5} />
                  {b}
                </div>
              ))}
            </div>
          </div>

          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
            {mergedPlans.map((pl) => (
              <div key={pl.id} className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-5">
                <div className="font-display text-title-lg text-on-surface">{pl.name}</div>
                <div className="mb-3 mt-1 font-display text-xl font-extrabold text-on-surface">{pl.priceLabel}</div>
                <div className="flex flex-col gap-2">
                  {pl.features.map((f) => (
                    <div key={f} className="flex items-center gap-2 text-[12.5px] text-on-surface-variant">
                      <Check className="h-3.5 w-3.5 flex-shrink-0 text-verified" strokeWidth={2.5} />
                      {f}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </>
      )}

      {canSubmitDocs && (
        <div className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
          <div className="mb-1 text-[15px] font-bold text-on-surface">Documentos</div>
          <p className="mb-4 text-[12.5px] text-outline">
            Privados y cifrados. Captura en vivo desde tu cámara — no se acepta subir fotos de la galería.
          </p>

          {descriptionTooShort && (
            <p className="mb-4 rounded-md bg-error/10 px-3 py-2 text-label-sm font-semibold text-error">
              ⚠️ Tu tienda necesita una descripción de al menos 30 caracteres antes de verificarte —{" "}
              <Link to="/vendedor/configuracion" className="underline">
                edítala en Configuración
              </Link>
              .
            </p>
          )}

          <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Input label="Nombre completo del responsable" required value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input label="Número de identidad" required value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </div>

          <div className="mb-4">
            <Select label="Tipo de documento" required value={idDocumentType} onChange={(e) => setIdDocumentType(e.target.value)}>
              <option value="" disabled>Elige cuál presentas...</option>
              <option value="NATIONAL_ID">Carné de identidad</option>
              <option value="PASSPORT">Pasaporte</option>
              <option value="INTERNATIONAL_ID">Carné de extranjería</option>
            </Select>
          </div>

          <p className="mb-1 text-[13px] font-bold text-on-surface">Datos legales de la tienda</p>
          <p className="mb-3 text-label-sm text-outline">
            Privados — nunca se muestran en tu perfil público (eso se configura aparte).
          </p>
          <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Input
              label={vendor?.ownerIdNumber ? "ID fiscal de la empresa (opcional, ya tienes ID personal)" : "ID fiscal de la empresa"}
              value={companyTaxId}
              onChange={(e) => setCompanyTaxId(e.target.value)}
            />
            <Select
              label="País de registro legal"
              required
              value={registrationCountryId}
              onChange={(e) => {
                setRegistrationCountryId(e.target.value);
                setLegalProvinceId("");
                setLegalMunicipalityId("");
              }}
            >
              <option value="" disabled>Elige un país...</option>
              {countries.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
            <Select
              label="Provincia/estado de registro legal"
              required
              disabled={!registrationCountryId}
              value={legalProvinceId}
              onChange={(e) => {
                setLegalProvinceId(e.target.value);
                setLegalMunicipalityId("");
              }}
            >
              <option value="" disabled>Elige una provincia...</option>
              {provincesForCountry.map((p) => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ))}
            </Select>
            <Select
              label="Municipio (opcional)"
              disabled={!legalProvinceId}
              value={legalMunicipalityId}
              onChange={(e) => setLegalMunicipalityId(e.target.value)}
            >
              <option value="">Sin especificar</option>
              {municipalitiesForProvince.map((m) => (
                <option key={m.id} value={m.id}>{m.name}</option>
              ))}
            </Select>
            <div className="sm:col-span-2">
              <Input
                label="Dirección de la empresa"
                required
                value={companyAddress}
                onChange={(e) => setCompanyAddress(e.target.value)}
                placeholder="Ej.: Calle 23 #456, Vedado, La Habana"
              />
            </div>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <div>
              {/* Bloque 146 (pedido explícito — "debe indicar que tiene que
                  ser la foto de la persona responsable, debe coincidir con
                  la foto del documento de identidad"): esta aclaración
                  vivía en ningún lado antes — el óvalo no explicaba para
                  qué es ni contra qué se compara. */}
              <p className="mb-1.5 text-[11.5px] text-outline">
                Foto de la cara de la persona responsable — tiene que coincidir con la foto del documento de identidad que subes al
                lado.
              </p>
              <CameraCapture
                shape="oval"
                label="Foto del responsable"
                instructions="Centra tu cara dentro del óvalo"
                facingMode="user"
                onCaptured={setSelfieBlob}
                onVideoCaptured={setSelfieVideoBlob}
              />
            </div>
            <div>
              <p className="mb-1.5 text-[11.5px] text-outline">
                Documento de identidad, bien enfocado y legible — el mismo tipo que elegiste arriba.
              </p>
              <CameraCapture
                shape="rect"
                label="Documento de identidad"
                instructions="Alinea el documento dentro del marco"
                facingMode="environment"
                onCaptured={setIdBlob}
              />
            </div>
          </div>

          <Button className="mt-4" onClick={() => submit.mutate()} disabled={!canSubmit}>
            {submit.isPending ? "Enviando..." : "Enviar solicitud"}
          </Button>
          {!canSubmit && (
            <p className="mt-2 text-label-sm text-outline">
              Captura la selfie y el documento, escribe el nombre del responsable, elige el tipo de documento, y completa el país/provincia
              de registro para poder enviar.
            </p>
          )}
        </div>
      )}

      {/* Bloque 145 (pedido explícito — "el cliente debe recibir la
          información que diga que esa aprobación será válida por 24 horas
          desde ese momento que se aprobó"): un aviso fijo, visible en
          cualquiera de las 3 secciones de pago de abajo (elegir método,
          transferencia CUP, o tarjeta con Stripe) — el plazo real lo
          calcula el backend del mismo historial que usa el cron de
          vencimiento (expireStalePendingPaymentApprovals), nunca una
          cuenta regresiva inventada del lado del cliente. */}
      {status === "PENDING_PAYMENT" && data?.paymentDeadlineAt && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg border border-tertiary-accent/30 bg-tertiary-accent/[0.06] p-4 text-[12.5px] text-on-surface-variant">
          <Clock className="mt-0.5 h-4 w-4 flex-shrink-0 text-tertiary-accent" />
          <p>
            Tienes hasta el <strong className="text-on-surface">{fmtDateTime(data.paymentDeadlineAt)}</strong> (24 horas desde la
            aprobación) para elegir el método de pago y completarlo. Si el plazo vence sin un pago confirmado, vas a tener que
            volver a enviar tus documentos.
          </p>
        </div>
      )}

      {showChooseMethod && (
        <div className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[15px] font-bold text-on-surface">¿Cómo vas a pagar la suscripción?</div>
            {/* Bloque 151: solo tiene sentido "Cancelar" cuando el vendedor
                ABRIÓ el selector a propósito para cambiar de opinión — si no
                tenía ningún método elegido todavía (o el ciclo anterior
                terminó), no hay a qué volver. */}
            {changingMethod && status === "PENDING_PAYMENT" && data?.paymentMethod && (
              <button
                type="button"
                onClick={() => setChangingMethod(false)}
                className="text-[12px] font-semibold text-on-surface-variant hover:underline"
              >
                Cancelar
              </button>
            )}
          </div>
          <p className="mb-4 text-[12.5px] text-outline">
            {(status === "PAYMENT_FAILED" || status === "SUSPENDED") && "Tu ciclo anterior terminó — "}
            Elige cuántos meses pagas de una vez y el medio que te resulte más fácil.
          </p>

          {/* Bloque 150 (pedido explícito): selector de meses (1..24) — el
              monto se recalcula en vivo en cada tarjeta de método, según su
              propio precio/moneda (CUP o USD). */}
          <div className="mb-4 flex items-center gap-3">
            <span className="text-[12.5px] font-semibold text-on-surface-variant">Meses a pagar:</span>
            <div className="flex items-center rounded-lg border border-outline-variant">
              <button
                type="button"
                onClick={() => setMonths((m) => Math.max(MIN_MONTHS, m - 1))}
                disabled={months <= MIN_MONTHS}
                className="flex h-9 w-9 items-center justify-center text-on-surface disabled:opacity-30"
              >
                <Minus className="h-3.5 w-3.5" />
              </button>
              <input
                type="number"
                min={MIN_MONTHS}
                max={MAX_MONTHS}
                value={months}
                onChange={(e) => {
                  const n = Math.round(Number(e.target.value));
                  if (Number.isFinite(n)) setMonths(Math.min(MAX_MONTHS, Math.max(MIN_MONTHS, n)));
                }}
                className="h-9 w-14 border-x border-outline-variant bg-transparent text-center text-[14px] font-bold text-on-surface outline-none"
              />
              <button
                type="button"
                onClick={() => setMonths((m) => Math.min(MAX_MONTHS, m + 1))}
                disabled={months >= MAX_MONTHS}
                className="flex h-9 w-9 items-center justify-center text-on-surface disabled:opacity-30"
              >
                <Plus className="h-3.5 w-3.5" />
              </button>
            </div>
            <span className="text-[11.5px] text-outline">(mínimo {MIN_MONTHS}, máximo {MAX_MONTHS})</span>
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <button
              onClick={() => choosePaymentMethod.mutate("CARD")}
              disabled={choosePaymentMethod.isPending}
              className="flex flex-col items-start gap-2 rounded-lg border border-outline-variant p-4 text-left hover:border-tertiary-accent disabled:opacity-50"
            >
              <CreditCard className="h-5 w-5 text-tertiary-accent" />
              <div className="text-[13.5px] font-bold text-on-surface">Tarjeta — Visa/Mastercard</div>
              <p className="text-[12px] text-outline">
                Pagas {fmtUsd((settings?.cardSubscriptionPriceUsd ?? 25) * months)} con Stripe ({months} {months === 1 ? "mes" : "meses"}) y subes
                la captura del pago para que lo confirmemos.
              </p>
            </button>
            <button
              onClick={() => choosePaymentMethod.mutate("CUP_TRANSFER")}
              disabled={choosePaymentMethod.isPending}
              className="flex flex-col items-start gap-2 rounded-lg border border-outline-variant p-4 text-left hover:border-tertiary-accent disabled:opacity-50"
            >
              <Landmark className="h-5 w-5 text-tertiary-accent" />
              <div className="text-[13.5px] font-bold text-on-surface">Transferencia CUP</div>
              <p className="text-[12px] text-outline">
                Transfieres {fmtCup((settings?.cupSubscriptionPriceCup ?? 2500) * months)} ({months} {months === 1 ? "mes" : "meses"}) y avisas
                "Ya pagué". Un admin confirma el pago a mano.
              </p>
            </button>
          </div>
        </div>
      )}

      {/* Bloque 150: CUP_TRANSFER (de siempre) y CARD una vez que Stripe ya
          confirmó el cobro comparten el mismo próximo paso — subir el
          comprobante en /vendedor/pago-manual, esa página ya distingue qué
          mostrar según el método. */}
      {awaitingProofClaim && (
        <div className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
          <div className="mb-1 flex items-center gap-2 text-[15px] font-bold text-on-surface">
            {data?.paymentMethod === "CARD" ? (
              <>
                <CreditCard className="h-4.5 w-4.5 text-tertiary-accent" /> Pago con tarjeta recibido
              </>
            ) : (
              <>
                <Landmark className="h-4.5 w-4.5 text-tertiary-accent" /> Transferencia bancaria en CUP
              </>
            )}
          </div>
          {/* Bloque 153 (pedido explícito — "una vez el cliente realiza el
              pago y pone 'Avisaste que ya pagaste'... debe cambiar el
              estado del botón de la sección anterior a 'en revisión', y no
              se debe poder cambiar el método de pago... ya hay una en
              proceso"): apenas se reclama el pago, esta sección deja de ser
              una invitación a hacer algo — pasa a ser un estado de "en
              revisión", sin el botón ni la opción de cambiar de método
              (esa sí sigue disponible en la sección de arriba, mientras
              todavía no se reclamó nada). */}
          {data?.paymentClaimedAt ? (
            <p className="flex items-center gap-2 text-[13px] font-bold text-tertiary-accent">
              <Clock className="h-4 w-4 flex-shrink-0" /> En revisión — el equipo confirma en unas horas.
            </p>
          ) : (
            <>
              <p className="mb-4 text-[12.5px] leading-5 text-outline">
                {data?.paymentMethod === "CARD"
                  ? "Stripe ya confirmó tu pago — sube la captura (o indica que no pudiste) para que el equipo lo confirme y active tu badge."
                  : "Completa la transferencia y avisa \"Ya pagué\" para activar el badge y el Plan Business."}
              </p>
              <div className="flex flex-wrap items-center gap-3">
                <Link
                  to="/vendedor/pago-manual"
                  className="inline-flex items-center gap-2 rounded bg-secondary-container px-4 py-2.5 text-[13px] font-bold text-on-secondary-container"
                >
                  {/* Bloque 153 (pedido explícito): "Ir a avisar que ya
                      pagué" sonaba a que el pago ya se había hecho — para
                      CUP el vendedor todavía va a TRANSFERIR, no a avisar
                      algo que ya pasó. */}
                  {data?.paymentMethod === "CARD" ? "Subir comprobante" : "Empezar con el proceso de pago"} <ArrowRight className="h-4 w-4" />
                </Link>
                {/* Bloque 151 (pedido explícito — "el vendedor... puede
                    cambiar si luego se arrepiente de esa forma de pago"):
                    reabre el selector de método+meses de arriba — elegir de
                    nuevo ya limpia cualquier reclamo/comprobante del método
                    anterior (mismo `chooseMyPaymentMethod` de siempre). */}
                <button
                  type="button"
                  onClick={() => setChangingMethod(true)}
                  className="text-[12.5px] font-semibold text-tertiary-accent hover:underline"
                >
                  Cambiar método de pago
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {showCardCheckout && (
        <div className="mb-5 rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
          <div className="mb-1 flex items-center justify-between gap-2">
            <div className="text-[15px] font-bold text-on-surface">
              Pago con tarjeta{data?.paymentMonths ? ` — ${data.paymentMonths} ${data.paymentMonths === 1 ? "mes" : "meses"}` : ""}
            </div>
            <button
              type="button"
              onClick={() => setChangingMethod(true)}
              className="text-[12px] font-semibold text-tertiary-accent hover:underline"
            >
              Cambiar método de pago
            </button>
          </div>
          {data?.stripeCheckoutUrl && !data?.stripeCheckoutExpired ? (
            <>
              <p className="mb-3 text-[12.5px] text-outline">
                Te mandamos el link de pago a tu correo. También puedes abrirlo directo desde acá — al pagar, Stripe te trae de vuelta para
                que subas la captura del pago:
              </p>
              <div className="flex flex-wrap items-center gap-2.5">
                <a
                  href={data.stripeCheckoutUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-2 rounded bg-secondary-container px-4 py-2.5 text-[13px] font-bold text-on-secondary-container"
                >
                  <ExternalLink className="h-4 w-4" /> Ir a pagar con Stripe
                </a>
                <button
                  onClick={() => retryStripeCheckout.mutate()}
                  disabled={retryStripeCheckout.isPending}
                  className="rounded border border-outline-variant px-3.5 py-2.5 text-[12.5px] font-semibold text-on-surface-variant disabled:opacity-50"
                >
                  {retryStripeCheckout.isPending ? "Generando..." : "¿No te funcionó? Genera un link nuevo"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 text-[12.5px] text-outline">
                {data?.stripeCheckoutExpired
                  ? "Tu link de pago anterior venció (los links de Stripe expiran solos después de un tiempo)."
                  : "Todavía no se generó tu link de pago."}{" "}
                Genera uno nuevo para continuar:
              </p>
              <button
                onClick={() => retryStripeCheckout.mutate()}
                disabled={retryStripeCheckout.isPending}
                className="inline-flex items-center gap-2 rounded bg-secondary-container px-4 py-2.5 text-[13px] font-bold text-on-secondary-container disabled:opacity-50"
              >
                <ExternalLink className="h-4 w-4" /> {retryStripeCheckout.isPending ? "Generando..." : "Generar link de pago"}
              </button>
            </>
          )}
        </div>
      )}

      <ConfirmModal
        open={confirmingCancel}
        title="¿Cancelar la suscripción Business?"
        message={`No pierdes el acceso de inmediato — sigues con el badge, la IA para clientes, el destacado en la home y el límite de productos ilimitado hasta ${
          vendor?.nextPaymentDueDate ? fmtDate(vendor.nextPaymentDueDate) : "el vencimiento de tu ciclo actual"
        }. Después de esa fecha vuelves al Plan Regular automáticamente. Puedes volver a verificarte cuando quieras.`}
        confirmLabel={cancelPlan.isPending ? "Cancelando..." : "Sí, cancelar"}
        danger
        onConfirm={() => cancelPlan.mutate()}
        onCancel={() => setConfirmingCancel(false)}
      />
    </div>
  );
}
