import { useEffect, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Landmark, CreditCard, Upload, Check, ArrowLeft, Clock } from "lucide-react";
import { api } from "../../lib/api.js";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";

const ELIGIBLE_STATUSES = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"];

function fmtDateTime(iso) {
  return new Date(iso).toLocaleString("es-CU", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

// Bloque 64: página propia para reclamar el pago de la suscripción — antes
// vivía inline en VendorVerification.jsx (una sola vez, en la fase de pago
// inicial). Sirve también para RENOVAR (PAYMENT_FAILED por vencimiento) o
// reactivar (SUSPENDED), sin rehacer documentos.
// Bloque 150 (pedido explícito — "para ambas cosas, tanto en pago en moneda
// nacional como Visa/Mastercard, el cliente siempre deberá subir una
// captura de pantalla del pago"): deja de ser una pantalla solo-CUP — ahora
// cubre los 2 métodos.
// Bloque 153 (pedido explícito — "el proceso será casi igual" para las
// renovaciones mientras la tienda ya está VERIFIED): esta misma página
// ahora cubre 2 "modos" — el ciclo INICIAL de siempre (VerificationRequest,
// `/verification/me` + `/verification/me/payment-proof`) y una RENOVACIÓN
// mientras ya está verificada (SubscriptionPayment, `/verification/me/
// subscription` + `/verification/me/subscription/payment-proof`) — mismo
// formulario, mismos campos, solo cambia a qué endpoint apunta.
export default function PagoManual() {
  const queryClient = useQueryClient();
  const { vendor } = useOutletContext();
  const [proofFile, setProofFile] = useState(null);
  const [payerName, setPayerName] = useState("");
  const [payerAccountNumber, setPayerAccountNumber] = useState("");
  const [payerPhone, setPayerPhone] = useState("");
  // Bloque 150: solo aparecen si el vendedor marca que no pudo hacer la
  // captura (CARD) — datos de respaldo para que el admin pueda conciliar.
  const [proofUnavailable, setProofUnavailable] = useState(false);
  const [payerAddress, setPayerAddress] = useState("");
  const [payerCountry, setPayerCountry] = useState("");
  const [payerCardLast4, setPayerCardLast4] = useState("");

  const { data: verification, isLoading: loadingVerification } = useQuery({
    queryKey: ["my-verification"],
    queryFn: async () => (await api.get("/verification/me")).data.verification,
    refetchOnMount: "always",
  });
  const { data: subscription, isLoading: loadingSubscription } = useQuery({
    queryKey: ["my-subscription"],
    queryFn: async () => (await api.get("/verification/me/subscription")).data.subscription,
    refetchOnMount: "always",
  });

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  const isLoading = loadingVerification || loadingSubscription;
  // Renovación: solo cuando la tienda YA está VERIFIED y hay una renovación
  // en curso — si no, es el ciclo inicial de siempre.
  const isRenewal = vendor?.verificationStatus === "VERIFIED" && !!subscription?.pendingRenewal;
  // Normaliza los 2 orígenes a la misma forma para no repetir el resto del
  // componente 2 veces.
  const data = isRenewal
    ? {
        paymentMethod: subscription.pendingRenewal.paymentMethod,
        paymentMonths: subscription.pendingRenewal.months,
        expectedAmount: subscription.pendingRenewal.expectedAmount,
        stripeCheckoutUrl: subscription.pendingRenewal.stripeCheckoutUrl,
        stripePaidAt: subscription.pendingRenewal.stripePaidAt,
        paymentClaimedAt: subscription.pendingRenewal.paymentClaimedAt,
        verificationStatus: "VERIFIED",
      }
    : verification;

  // Bloque 152 (pedido explícito — "el responsable debe ser la misma
  // persona a la que está registrada la cuenta"): prellena con el
  // responsable ya cargado en la tienda (Vendor.ownerName) — sigue siendo
  // editable por si de verdad pagó otra persona a nombre de la tienda.
  useEffect(() => {
    if (vendor?.ownerName && !payerName) setPayerName(vendor.ownerName);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [vendor?.ownerName]);

  const isCup = data?.paymentMethod === "CUP_TRANSFER";

  const claimPayment = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      form.append("payerName", payerName.trim());
      if (isCup) {
        form.append("payerAccountNumber", payerAccountNumber.trim());
        form.append("payerPhone", payerPhone.trim());
      } else {
        form.append("proofUnavailable", String(proofUnavailable));
        if (proofUnavailable) {
          form.append("payerPhone", payerPhone.trim());
          form.append("payerAddress", payerAddress.trim());
          form.append("payerCountry", payerCountry.trim());
          if (payerCardLast4.trim()) form.append("payerCardLast4", payerCardLast4.trim());
        }
      }
      if (proofFile) form.append("proof", proofFile);
      const endpoint = isRenewal ? "/verification/me/subscription/payment-proof" : "/verification/me/payment-proof";
      return (await api.post(endpoint, form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(`Aviso enviado — el equipo de ${settings?.siteName || "Baznova"} confirma tu pago en unas horas.`);
      setProofFile(null);
      queryClient.invalidateQueries({ queryKey: ["my-verification"] });
      queryClient.invalidateQueries({ queryKey: ["my-subscription"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el aviso de pago."),
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;

  const eligible = isRenewal || (ELIGIBLE_STATUSES.includes(verification?.verificationStatus) && !!verification?.paymentMethod);

  if (!eligible) {
    return (
      <div className="max-w-[560px]">
        <Link to="/vendedor/verificacion" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-surface-variant">
          <ArrowLeft className="h-4 w-4" /> Volver a Verificación y plan
        </Link>
        <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
          <p className="text-[13.5px] text-on-surface-variant">
            No tienes ningún pago pendiente de confirmar ahora mismo. Si necesitas verificarte, elegir tu método de pago o renovar,
            hazlo desde "Verificación y plan".
          </p>
        </div>
      </div>
    );
  }

  const canSubmit =
    !claimPayment.isPending &&
    payerName.trim().length >= 2 &&
    (isCup ? payerAccountNumber.trim() && payerPhone.trim() : proofFile || (proofUnavailable && payerPhone.trim() && payerAddress.trim() && payerCountry.trim()));

  return (
    <div className="max-w-[560px]">
      <Link to="/vendedor/verificacion" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-surface-variant">
        <ArrowLeft className="h-4 w-4" /> Volver a Verificación y plan
      </Link>

      <h1 className="mb-1 font-display text-[22px] font-bold text-on-surface">
        {isRenewal ? "Renovar suscripción" : isCup ? "Pago por transferencia CUP" : "Confirmar pago con tarjeta"}
      </h1>
      <p className="mb-5 text-[13px] text-on-surface-variant">
        {isRenewal
          ? "Completa el pago de tu renovación y avisa para que el equipo la confirme."
          : data.verificationStatus === "PAYMENT_FAILED"
            ? "Tu ciclo anterior venció — completa este aviso para recuperar el badge de verificación."
            : isCup
              ? "Completa la transferencia y sube el comprobante para activar tu Plan Business."
              : "Sube la captura del pago (o indica que no pudiste) para que el equipo confirme y active tu Plan Business."}
      </p>

      <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
        <div className="mb-4 flex items-center gap-2 text-[14px] font-bold text-on-surface">
          {isCup ? (
            <>
              <Landmark className="h-4.5 w-4.5 text-tertiary-accent" /> Datos para transferir
            </>
          ) : (
            <>
              <CreditCard className="h-4.5 w-4.5 text-tertiary-accent" /> Pago con tarjeta
            </>
          )}
        </div>

        {/* Bloque 152 (pedido explícito — "en los datos para transferir
            debe aparecer más detalles: cuántos meses está pagando el
            cliente, el nombre de la tienda que está registrada y demás"):
            antes solo se mostraba el monto total con los meses entre
            paréntesis, poco visible — ahora tienda, meses y precio unitario
            son líneas propias, para que quien hace la transferencia (y
            quien la revisa del lado del admin) tenga el detalle completo a
            la vista, no solo el total. */}
        {isCup ? (
          settings?.cupBankAccountNumber ? (
            <div className="mb-4 flex flex-col gap-2 rounded-md bg-surface-container p-4 text-[13px]">
              <div>
                <span className="text-outline">Tienda: </span>
                <strong className="text-on-surface">{vendor?.companyName}</strong>
              </div>
              <div>
                <span className="text-outline">Duración: </span>
                <strong className="text-on-surface">
                  {data.paymentMonths ?? 1} {(data.paymentMonths ?? 1) === 1 ? "mes" : "meses"}
                </strong>
                {data.paymentMonths > 1 && (
                  <span className="text-outline"> ({(settings.cupSubscriptionPriceCup ?? 2500).toLocaleString("es-CU")} CUP/mes)</span>
                )}
              </div>
              <div>
                <span className="text-outline">Monto total a transferir: </span>
                <strong className="text-on-surface">{(data.expectedAmount ?? 0).toLocaleString("es-CU")} CUP</strong>
              </div>
              <div>
                <span className="text-outline">Cuenta: </span>
                <strong className="text-on-surface">{settings.cupBankAccountNumber}</strong>
              </div>
              {settings.cupBankAccountHolder && (
                <div>
                  <span className="text-outline">A nombre de: </span>
                  <strong className="text-on-surface">{settings.cupBankAccountHolder}</strong>
                </div>
              )}
              {settings.cupBankInstructions && <p className="mt-1 whitespace-pre-line text-outline">{settings.cupBankInstructions}</p>}
            </div>
          ) : (
            <p className="mb-4 rounded-md bg-surface-container p-4 text-[13px] text-outline">
              Todavía no hay una cuenta bancaria cargada — contacta al equipo de {settings?.siteName || "Baznova"} para coordinar el pago.
            </p>
          )
        ) : (
          <div className="mb-4 rounded-md bg-surface-container p-4 text-[13px]">
            {data.stripePaidAt ? (
              <p className="mb-1.5 flex items-center gap-1.5 font-semibold text-verified-dark">
                <Check className="h-4 w-4" /> Stripe confirmó tu pago el {fmtDateTime(data.stripePaidAt)}.
              </p>
            ) : (
              <p className="mb-1.5 flex items-center gap-1.5 text-outline">
                <Clock className="h-4 w-4 flex-shrink-0" /> Confirmando tu pago con Stripe — puede tardar unos segundos. Ya puedes completar el
                aviso igual.
              </p>
            )}
            <div>
              <span className="text-outline">Tienda: </span>
              <strong className="text-on-surface">{vendor?.companyName}</strong>
            </div>
            <div>
              <span className="text-outline">Duración: </span>
              <strong className="text-on-surface">
                {data.paymentMonths ?? 1} {(data.paymentMonths ?? 1) === 1 ? "mes" : "meses"}
              </strong>
              {data.paymentMonths > 1 && (
                <span className="text-outline"> (US$ {(settings?.cardSubscriptionPriceUsd ?? 25).toLocaleString("en-US")}/mes)</span>
              )}
            </div>
            <div>
              <span className="text-outline">Monto pagado: </span>
              <strong className="text-on-surface">US$ {(data.expectedAmount ?? 0).toLocaleString("en-US")}</strong>
            </div>
          </div>
        )}

        {data.paymentClaimedAt ? (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-verified-dark">
            <Check className="h-4 w-4" /> Avisaste que ya pagaste — el equipo de {settings?.siteName || "Baznova"} confirma en unas horas.
          </p>
        ) : (
          <div className="flex flex-col gap-3.5">
            {/* Bloque 150 (pedido explícito): "los datos de quién hizo la
                operación, nombre y apellidos" — obligatorio para los 2
                métodos. */}
            <Input
              label="Nombre y apellidos de quien pagó"
              required
              value={payerName}
              onChange={(e) => setPayerName(e.target.value)}
              placeholder={isCup ? "Tal como figura en la cuenta" : "Tiene que coincidir con el nombre de la tarjeta"}
            />
            {/* Bloque 153 (pedido explícito — "el monto pagado no se puede
                editar ya que es un valor que ya se calculó por los meses
                que eligió el cliente... quiero que esas cuentas sean bien
                estrictas"): ya no es un campo — es un dato de solo lectura
                (ya visible arriba, en "Datos para transferir"/"Pago con
                tarjeta") y el backend lo recalcula server-side al reclamar
                el pago, nunca confía en lo que mande el cliente. Cambiar
                cuántos meses se pagan se hace ANTES de este paso, desde el
                selector de "Verificación y plan" — acá ya está fijo. */}

            {isCup && (
              <>
                <Input
                  label="Número de cuenta con el que transferiste"
                  required
                  value={payerAccountNumber}
                  onChange={(e) => setPayerAccountNumber(e.target.value)}
                />
                <Input label="Teléfono de contacto" required value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} />
              </>
            )}

            <label className="flex w-fit cursor-pointer items-center gap-2 rounded border border-outline-variant px-4 py-2.5 text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container">
              <Upload className="h-4 w-4" />
              {proofFile ? proofFile.name : isCup ? "Adjuntar comprobante (opcional)" : "Adjuntar captura del pago"}
              <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} />
            </label>

            {/* Bloque 150 (pedido explícito — "en caso de que el cliente no
                pueda hacer la captura, podrá seleccionar que no pudo, solo
                que se pedirán algunos datos adicionales"): solo para
                tarjeta — CUP ya pide cuenta+teléfono siempre, alcanza igual
                sin captura. */}
            {!isCup && !proofFile && (
              <label className="flex items-center gap-2 text-[12.5px] text-on-surface-variant">
                <input type="checkbox" checked={proofUnavailable} onChange={(e) => setProofUnavailable(e.target.checked)} />
                No pude hacer la captura del pago
              </label>
            )}
            {!isCup && proofUnavailable && !proofFile && (
              <div className="flex flex-col gap-3.5 rounded-full border border-outline-variant p-3.5">
                <p className="text-[12px] text-outline">
                  Sin captura, estos datos nos ayudan a confirmar tu pago igual — nunca pedimos el número completo de la tarjeta.
                </p>
                <Input label="Teléfono" required value={payerPhone} onChange={(e) => setPayerPhone(e.target.value)} />
                <Input label="Dirección" required value={payerAddress} onChange={(e) => setPayerAddress(e.target.value)} />
                <Input label="País" required value={payerCountry} onChange={(e) => setPayerCountry(e.target.value)} />
                <Input
                  label="Últimos 4 dígitos de la tarjeta (opcional)"
                  value={payerCardLast4}
                  maxLength={4}
                  onChange={(e) => setPayerCardLast4(e.target.value.replace(/\D/g, "").slice(0, 4))}
                />
              </div>
            )}

            <Button className="w-fit" onClick={() => claimPayment.mutate()} disabled={!canSubmit}>
              {claimPayment.isPending ? "Enviando..." : "Ya pagué"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
