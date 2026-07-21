import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Clock, CheckCircle2, XCircle, Check, CreditCard, Landmark, Upload, ExternalLink } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { CameraCapture } from "../../components/CameraCapture.jsx";

const BENEFITS = ["Badge de verificación", "Productos ilimitados", "Aparición en la home", "IA de empresa (chatbot)"];

// Bloque 16: la comparación Regular/Business se movió acá desde Home.jsx —
// ya no es un gancho de marketing público, es algo que el vendedor explora
// si quiere desde su propio panel.
const PLANS = [
  {
    id: "regular",
    name: "Regular",
    priceLabel: "Gratis",
    features: ["Hasta 20 productos", "Pedidos por WhatsApp", "Perfil de tienda público", "Sin comisiones por venta"],
  },
  {
    id: "business",
    name: "Business",
    priceLabel: "2 500 CUP/mes",
    features: ["Productos ilimitados", "Sello de tienda verificada", "Destacada en la home", "Recomendaciones con IA", "Horarios de atención"],
  },
];

// stage (derivado server-side, ver verification.controller.js): REGULAR →
// PENDIENTE_DOCS → PENDIENTE_PAGO → VERIFICADO, o RECHAZADO en el medio.
const STAGE_META = {
  REGULAR: { label: "Sin verificar todavía", color: "#75777c", bg: "rgba(117,119,124,0.1)", Icon: Clock },
  PENDIENTE_DOCS: { label: "Documentos en revisión", color: "#8A5100", bg: "rgba(138,81,0,0.1)", Icon: Clock },
  PENDIENTE_PAGO: { label: "Documentos aprobados — falta el pago", color: "#337475", bg: "rgba(51,116,117,0.1)", Icon: Clock },
  VERIFICADO: { label: "Tienda verificada", color: "#0A8F42", bg: "rgba(12,174,83,0.1)", Icon: CheckCircle2 },
  RECHAZADO: { label: "Documentos rechazados", color: "#ba1a1a", bg: "rgba(186,26,26,0.1)", Icon: XCircle },
};

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
  const [searchParams, setSearchParams] = useSearchParams();
  const [fullName, setFullName] = useState("");
  const [idNumber, setIdNumber] = useState("");
  const [selfieBlob, setSelfieBlob] = useState(null);
  const [idBlob, setIdBlob] = useState(null);
  const [proofFile, setProofFile] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["my-verification"],
    queryFn: async () => (await api.get("/verification/me")).data.verification,
  });

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
      toast("Pago cancelado — podés reintentar cuando quieras.", { icon: "ℹ️" });
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
      toast.success("Solicitud enviada. Un admin de ZeuDin va a revisar tus documentos pronto.");
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
      toast.success("Comprobante enviado. El equipo de ZeuDin va a confirmar el pago pronto.");
      setProofFile(null);
      invalidate();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo subir el comprobante."),
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;

  const stage = data?.stage ?? "REGULAR";
  const meta = STAGE_META[stage];
  const stepStates = STAGE_STEP_STATES[stage];
  const canSubmitDocs = stage === "REGULAR" || stage === "RECHAZADO";

  return (
    <div className="max-w-[820px]">
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Verificar mi empresa</h1>
      <p className="mb-[22px] text-[13.5px] text-outline">
        Obtené el badge verde de tienda verificada y desbloqueá las funciones Business. La aprobación final siempre la
        hace el equipo de ZeuDin.
      </p>

      <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-[18px] flex items-center gap-3.5">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md" style={{ background: meta.bg }}>
            <meta.Icon className="h-6 w-6" style={{ color: meta.color }} />
          </div>
          <div>
            <div className="text-[16px] font-bold text-on-surface">{meta.label}</div>
            <div className="text-[13px] text-outline">
              {stage === "REGULAR" && "Subí tus documentos para empezar el trámite."}
              {stage === "PENDIENTE_DOCS" && "Un admin de ZeuDin los está revisando a mano · respuesta en ~24h."}
              {stage === "PENDIENTE_PAGO" && "Elegí cómo pagar la suscripción para activar el badge y el Plan Business."}
              {stage === "VERIFICADO" && "Tu tienda tiene el badge verde y el Plan Business activo."}
              {stage === "RECHAZADO" && (data?.notes || "Tu solicitud fue rechazada. Volvé a capturar los documentos e intentá de nuevo.")}
            </div>
          </div>
        </div>
        <div className="flex items-center gap-0">
          {STEPS.map((text, i) => (
            <div key={text} className={`flex items-center ${i < STEPS.length - 1 ? "flex-1" : ""}`}>
              <Step text={text} stepNumber={String(i + 1)} state={stepStates[i]} />
              {i < STEPS.length - 1 && (
                <div className="mx-3 h-0.5 flex-1" style={{ background: stepStates[i] === "done" ? "#0CAE53" : "#e4e2e3" }} />
              )}
            </div>
          ))}
        </div>
      </div>

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
              instructions="Centrá tu cara dentro del óvalo"
              facingMode="user"
              onCaptured={setSelfieBlob}
            />
            <CameraCapture
              shape="rect"
              label="Documento de identidad"
              instructions="Alineá el documento dentro del marco"
              facingMode="environment"
              onCaptured={setIdBlob}
            />
          </div>

          <Button className="mt-4" onClick={() => submit.mutate()} disabled={submit.isPending || !selfieBlob || !idBlob}>
            {submit.isPending ? "Enviando..." : "Enviar solicitud"}
          </Button>
          {(!selfieBlob || !idBlob) && (
            <p className="mt-2 text-label-sm text-outline">Capturá la selfie y el documento con la cámara para poder enviar.</p>
          )}
        </div>
      )}

      {stage === "PENDIENTE_PAGO" && !data?.paymentMethod && (
        <div className="mb-5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
          <div className="mb-1 text-[15px] font-bold text-on-surface">¿Cómo vas a pagar la suscripción?</div>
          <p className="mb-4 text-[12.5px] text-outline">2 500 CUP/mes — elegí el medio que te resulte más fácil.</p>
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
              <p className="text-[12px] text-outline">Transferís en moneda nacional y subís el comprobante. Un admin confirma el pago a mano.</p>
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
                Te mandamos el link de pago a tu correo. También podés abrirlo directo desde acá — se activa solo apenas Stripe confirme el pago:
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
                  {retryStripeCheckout.isPending ? "Generando..." : "¿No te funcionó? Generá un link nuevo"}
                </button>
              </div>
            </>
          ) : (
            <>
              <p className="mb-3 text-[12.5px] text-outline">
                {data?.stripeCheckoutExpired
                  ? "Tu link de pago anterior venció (los links de Stripe expiran solos después de un tiempo)."
                  : "Todavía no se generó tu link de pago."}{" "}
                Generá uno nuevo para continuar:
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
            Transferí <strong className="text-on-surface">2 500 CUP</strong> a la cuenta de ZeuDin (CI: 9205-XXXX-XXXX,
            a nombre de ZeuDin Marketplace) y subí el comprobante. La activación final la confirma un admin a mano —
            no es automática.
          </p>
          {data?.paymentProofReceived ? (
            <p className="flex items-center gap-2 text-[13px] font-semibold text-verified-dark">
              <Check className="h-4 w-4" /> Comprobante recibido — esperando confirmación del equipo de ZeuDin.
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
            <div className="mb-3.5 text-[15px] font-bold">Al verificarte obtenés</div>
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
            {PLANS.map((pl) => (
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
    </div>
  );
}
