import { useEffect, useState } from "react";
import { useSearchParams, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Check, CreditCard, Landmark, Upload, ExternalLink, Sparkles } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { CameraCapture } from "../../components/CameraCapture.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { BENEFITS, PLANS, STAGE_META } from "../../lib/verificationMeta.js";

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "long", year: "numeric" });
}

const STEPS = ["Documentos", "Revisión", "Pago", "Verificado"];
const STAGE_STEP_STATES = {
  REGULAR: ["active", "pending", "pending", "pending"],
  PENDIENTE_DOCS: ["done", "active", "pending", "pending"],
  PENDIENTE_PAGO: ["done", "done", "active", "pending"],
  VERIFICADO: ["done", "done", "done", "done"],
  RECHAZADO: ["active", "pending", "pending", "pending"],
};

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

export default function VendorVerification() {
  const queryClient = useQueryClient();
  const { vendor } = useOutletContext();
  const [searchParams, setSearchParams] = useSearchParams();
  const [fullName, setFullName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [selfieBlob, setSelfieBlob] = useState(null);
  const [idBlob, setIdBlob] = useState(null);
  const [proofFile, setProofFile] = useState(null);
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["my-verification"],
    queryFn: async () => (await api.get("/verification/me")).data.verification,
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

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ["my-verification"] });

  // Bloque 25: Stripe redirige de vuelta acá con ?stripe=success|cancel —
  // la activación REAL siempre la confirma el webhook del lado del
  // servidor (puede tardar unos segundos más que el redirect), esto es
  // solo feedback inmediato para que el vendedor no vea la pantalla
  // igual que antes de pagar y piense que no pasó nada.
  useEffect(() => {
    const stripeResult = searchParams.get("stripe");
    if (!stripeResult) return;
    if (stripeResult === "success") {
      toast.success("¡Pago recibido! Confirmando con Stripe — tu cuenta se activa en un momento.");
      invalidate();
    } else if (stripeResult === "cancel") {
      toast("Pago cancelado — puedes reintentar cuando quieras.", { icon: "ℹ️" });
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
      if (idNumber) form.append("idNumber", idNumber);
      form.append("selfie", selfieBlob, "selfie.jpg");
      form.append("idDocument", idBlob, "documento.jpg");
      return (await api.post("/verification/me", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(`Solicitud enviada. Un admin de ${settings?.siteName || "ZeuDin"} va a revisar tus documentos pronto.`);
      setSelfieBlob(null);
      setIdBlob(null);
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar la solicitud."),
  });

  const choosePaymentMethod = useMutation({
    mutationFn: async (method) => (await api.patch("/verification/me/payment-method", { method })).data,
    onSuccess: (data) => {
      toast.success(data.verification.paymentMethod === "CARD" ? "Te generamos tu link de pago con Stripe." : "Método de pago elegido.");
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

  const uploadProof = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("proof", proofFile);
      return (await api.post("/verification/me/payment-proof", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(`Comprobante enviado. El equipo de ${settings?.siteName || "ZeuDin"} va a confirmar el pago pronto.`);
      setProofFile(null);
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo subir el comprobante."),
  });

  // Movido acá desde VendorSubscription.jsx (unificación: verificación y
  // plan eran dos páginas mostrando prácticamente lo mismo — ver nota de
  // borrado en ese archivo). Vuelve a Regular de inmediato; el vendedor
  // puede volver a verificarse cuando quiera.
  const cancelPlan = useMutation({
    mutationFn: async () => (await api.patch("/vendors/me", { planType: "REGULAR" })).data,
    onSuccess: () => {
      toast.success("Volviste al Plan Regular.");
      setConfirmingCancel(false);
      queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cancelar la suscripción."),
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;

  const stage = data?.stage ?? "REGULAR";
  const meta = STAGE_META[stage];
  const stepStates = STAGE_STEP_STATES[stage];
  const canSubmitDocs = stage === "REGULAR" || stage === "RECHAZADO";
  const isBusiness = vendor?.planType === "BUSINESS";

  return (
    <div className="max-w-[820px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Verificación y plan</h1>
      <p className="mb-[22px] text-[13.5px] text-outline">
        {stage === "VERIFICADO"
          ? "Estado de tu verificación y de tu plan actual."
          : `Obtén el badge verde de tienda verificada y desbloquea las funciones Business. La aprobación final siempre la hace el equipo de ${settings?.siteName || "ZeuDin"}.`}
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
              {stage === "REGULAR" && "Sube tus documentos para empezar el trámite."}
              {stage === "PENDIENTE_DOCS" && `Un admin de ${settings?.siteName || "ZeuDin"} los está revisando a mano · respuesta en ~24h.`}
              {stage === "PENDIENTE_PAGO" && "Elige cómo pagar la suscripción para activar el badge y el Plan Business."}
              {stage === "VERIFICADO" && "Tu tienda tiene el badge verde y el Plan Business activo."}
              {stage === "RECHAZADO" && (data?.notes || "Tu solicitud fue rechazada. Vuelve a capturar los documentos e intenta de nuevo.")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0 border-t border-surface-container-high px-6 py-5">
          {STEPS.map((text, i) => (
            <div key={text} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
              <Step text={text} stepNumber={String(i + 1)} state={stepStates[i]} />
              {i < STEPS.length - 1 && (
                <div className="mx-3 h-0.5 flex-1" style={{ background: stepStates[i] === "done" ? "#0CAE53" : "#e4e2e3" }} />
              )}
            </div>
          ))}
        </div>

        {(stage === "VERIFICADO" && data?.paymentConfirmedAt) || (isBusiness && stage === "VERIFICADO") ? (
          <div className="border-t border-surface-container-high px-6 py-5">
            {data?.paymentConfirmedAt && (
              <p className="text-[13px] text-on-surface-variant">
                Business activo desde el <strong className="text-on-surface">{fmtDate(data.paymentConfirmedAt)}</strong>.
              </p>
            )}
            {isBusiness && (
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

      {canSubmitDocs && (
        <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
          <div className="mb-1 text-[15px] font-bold text-on-surface">Documentos</div>
          <p className="mb-4 text-[12.5px] text-outline">
            Privados y cifrados. Captura en vivo desde tu cámara — no se acepta subir fotos de la galería.
          </p>

          <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Input label="Nombre completo del responsable" value={fullName} onChange={(e) => setFullName(e.target.value)} />
            <Input label="Número de identidad" value={idNumber} onChange={(e) => setIdNumber(e.target.value)} />
          </div>

          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <CameraCapture
              shape="oval"
              label="Foto del responsable"
              instructions="Centra tu cara dentro del óvalo"
              facingMode="user"
              onCaptured={setSelfieBlob}
            />
            <CameraCapture
              shape="rect"
              label="Documento de identidad"
              instructions="Alinea el documento dentro del marco"
              facingMode="environment"
              onCaptured={setIdBlob}
            />
          </div>

          <Button className="mt-4" onClick={() => submit.mutate()} disabled={submit.isPending || !selfieBlob || !idBlob}>
            {submit.isPending ? "Enviando..." : "Enviar solicitud"}
          </Button>
          {(!selfieBlob || !idBlob) && (
            <p className="mt-2 text-label-sm text-outline">Captura la selfie y el documento con la cámara para poder enviar.</p>
          )}
        </div>
      )}

      {stage === "PENDIENTE_PAGO" && !data?.paymentMethod && (
        <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
          <div className="mb-1 text-[15px] font-bold text-on-surface">¿Cómo vas a pagar la suscripción?</div>
          <p className="mb-4 text-[12.5px] text-outline">2 500 CUP/mes — elige el medio que te resulte más fácil.</p>
          <div className="grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <button
              onClick={() => choosePaymentMethod.mutate("CARD")}
              disabled={choosePaymentMethod.isPending}
              className="flex flex-col items-start gap-2 rounded-lg border border-outline-variant p-4 text-left hover:border-tertiary-accent disabled:opacity-50"
            >
              <CreditCard className="h-5 w-5 text-tertiary-accent" />
              <div className="text-[13.5px] font-bold text-on-surface">Tarjeta (cualquier país)</div>
              <p className="text-[12px] text-outline">Te mandamos un link de pago por correo. Se activa solo al confirmarse el pago.</p>
            </button>
            <button
              onClick={() => choosePaymentMethod.mutate("CUP_TRANSFER")}
              disabled={choosePaymentMethod.isPending}
              className="flex flex-col items-start gap-2 rounded-lg border border-outline-variant p-4 text-left hover:border-tertiary-accent disabled:opacity-50"
            >
              <Landmark className="h-5 w-5 text-tertiary-accent" />
              <div className="text-[13.5px] font-bold text-on-surface">Transferencia CUP</div>
              <p className="text-[12px] text-outline">Transfieres en moneda nacional y subes el comprobante. Un admin confirma el pago a mano.</p>
            </button>
          </div>
        </div>
      )}

      {stage === "PENDIENTE_PAGO" && data?.paymentMethod === "CARD" && (
        <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
          <div className="mb-1 text-[15px] font-bold text-on-surface">Pago con tarjeta</div>
          {data?.stripeCheckoutUrl && !data?.stripeCheckoutExpired ? (
            <>
              <p className="mb-3 text-[12.5px] text-outline">
                Te mandamos el link de pago a tu correo. También puedes abrirlo directo desde acá — se activa solo apenas Stripe confirme el pago:
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

      {stage === "PENDIENTE_PAGO" && data?.paymentMethod === "CUP_TRANSFER" && (
        <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
          <div className="mb-1 text-[15px] font-bold text-on-surface">Transferencia bancaria en CUP</div>
          <p className="mb-3 text-[12.5px] leading-5 text-outline">
            Transferí <strong className="text-on-surface">2 500 CUP</strong> a la cuenta de {settings?.siteName || "ZeuDin"} (CI: 9205-XXXX-XXXX,
            a nombre de {settings?.siteName || "ZeuDin"} Marketplace) y sube el comprobante. La activación final la confirma un admin a mano —
            no es automática.
          </p>
          {data?.paymentProofReceived ? (
            <p className="flex items-center gap-2 text-[13px] font-semibold text-verified-dark">
              <Check className="h-4 w-4" /> Comprobante recibido — esperando confirmación del equipo de {settings?.siteName || "ZeuDin"}.
            </p>
          ) : (
            <div className="flex flex-wrap items-center gap-3">
              <label className="flex cursor-pointer items-center gap-2 rounded border border-outline-variant px-4 py-2.5 text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container">
                <Upload className="h-4 w-4" />
                {proofFile ? proofFile.name : "Elegir comprobante (foto o PDF)"}
                <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} />
              </label>
              <Button onClick={() => uploadProof.mutate()} disabled={!proofFile || uploadProof.isPending}>
                {uploadProof.isPending ? "Subiendo..." : "Enviar comprobante"}
              </Button>
            </div>
          )}
        </div>
      )}

      {stage !== "VERIFICADO" && (
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

          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            {mergedPlans.map((pl) => (
              <div key={pl.id} className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5">
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

      <ConfirmModal
        open={confirmingCancel}
        title="¿Cancelar la suscripción Business?"
        message="Vuelves al Plan Regular de inmediato: pierdes el badge de verificación, la IA para clientes, el destacado en la home y el límite de productos vuelve a 20. Puedes volver a verificarte cuando quieras."
        confirmLabel={cancelPlan.isPending ? "Cancelando..." : "Sí, cancelar"}
        danger
        onConfirm={() => cancelPlan.mutate()}
        onCancel={() => setConfirmingCancel(false)}
      />
    </div>
  );
}
