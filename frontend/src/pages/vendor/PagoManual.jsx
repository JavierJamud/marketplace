import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Landmark, Upload, Check, ArrowLeft } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";

const ELIGIBLE_STATUSES = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"];

// Bloque 64: página propia para la transferencia CUP recurrente — antes
// vivía inline en VendorVerification.jsx (una sola vez, en la fase de pago
// inicial). Ahora también sirve para RENOVAR cada mes (PAYMENT_FAILED por
// vencimiento) o reactivar después de SUSPENDED, sin rehacer documentos.
export default function PagoManual() {
  const queryClient = useQueryClient();
  const [proofFile, setProofFile] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["my-verification"],
    queryFn: async () => (await api.get("/verification/me")).data.verification,
  });

  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });

  // Bloque 66 (pedido explícito, confirmado con el usuario): "Ya pagué" ya
  // no exige ningún archivo — el comprobante queda opcional, solo ayuda al
  // admin a confirmar más rápido si se adjunta.
  const claimPayment = useMutation({
    mutationFn: async () => {
      const form = new FormData();
      if (proofFile) form.append("proof", proofFile);
      return (await api.post("/verification/me/payment-proof", form, { headers: { "Content-Type": "multipart/form-data" } })).data;
    },
    onSuccess: () => {
      toast.success(`Aviso enviado — el equipo de ${settings?.siteName || "ZeuDin"} confirma tu pago en unas horas.`);
      setProofFile(null);
      queryClient.invalidateQueries({ queryKey: ["my-verification"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo enviar el aviso de pago."),
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;

  const eligible = ELIGIBLE_STATUSES.includes(data?.verificationStatus) && data?.paymentMethod === "CUP_TRANSFER";

  if (!eligible) {
    return (
      <div className="max-w-[560px]">
        <Link to="/vendedor/verificacion" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-surface-variant">
          <ArrowLeft className="h-4 w-4" /> Volver a Verificación y plan
        </Link>
        <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
          <p className="text-[13.5px] text-on-surface-variant">
            No tienes ningún pago por transferencia CUP pendiente ahora mismo. Si necesitas verificarte o elegir tu método de pago, hazlo
            desde "Verificación y plan".
          </p>
        </div>
      </div>
    );
  }

  const price = settings?.cupSubscriptionPriceCup ?? 2500;

  return (
    <div className="max-w-[560px]">
      <Link to="/vendedor/verificacion" className="mb-4 inline-flex items-center gap-1.5 text-[13px] font-semibold text-on-surface-variant">
        <ArrowLeft className="h-4 w-4" /> Volver a Verificación y plan
      </Link>

      <h1 className="mb-1 font-display text-[22px] font-bold text-on-surface">Pago por transferencia CUP</h1>
      <p className="mb-5 text-[13px] text-on-surface-variant">
        {data.verificationStatus === "PAYMENT_FAILED"
          ? "Tu ciclo anterior venció — renueva subiendo un comprobante nuevo para recuperar el badge de verificación."
          : "Completa la transferencia y sube el comprobante para activar tu Plan Business."}
      </p>

      <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
        <div className="mb-4 flex items-center gap-2 text-[14px] font-bold text-on-surface">
          <Landmark className="h-4.5 w-4.5 text-tertiary-accent" /> Datos para transferir
        </div>

        {settings?.cupBankAccountNumber ? (
          <div className="mb-4 flex flex-col gap-2 rounded-md bg-surface-container p-4 text-[13px]">
            <div>
              <span className="text-outline">Monto: </span>
              <strong className="text-on-surface">{price.toLocaleString("es-CU")} CUP</strong>
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
            Todavía no hay una cuenta bancaria cargada — contacta al equipo de {settings?.siteName || "ZeuDin"} para coordinar el pago.
          </p>
        )}

        {data.paymentClaimedAt ? (
          <p className="flex items-center gap-2 text-[13px] font-semibold text-verified-dark">
            <Check className="h-4 w-4" /> Avisaste que ya pagaste — el equipo de {settings?.siteName || "ZeuDin"} confirma en unas horas.
          </p>
        ) : (
          <div className="flex flex-col gap-3">
            <label className="flex w-fit cursor-pointer items-center gap-2 rounded border border-outline-variant px-4 py-2.5 text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container">
              <Upload className="h-4 w-4" />
              {proofFile ? proofFile.name : "Adjuntar comprobante (opcional)"}
              <input type="file" accept="image/*,.pdf" className="hidden" onChange={(e) => setProofFile(e.target.files?.[0] ?? null)} />
            </label>
            <Button className="w-fit" onClick={() => claimPayment.mutate()} disabled={claimPayment.isPending}>
              {claimPayment.isPending ? "Enviando..." : "Ya pagué"}
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
