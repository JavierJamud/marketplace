import { useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Check, CreditCard, Landmark } from "lucide-react";
import { api } from "../../lib/api.js";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { STAGE_META, PLANS, BENEFITS } from "../../lib/verificationMeta.js";

const PAYMENT_METHOD_LABEL = { CARD: "Tarjeta (Stripe)", CUP_TRANSFER: "Transferencia CUP" };

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "long", year: "numeric" });
}

// Bloque 47 (ver decisión A del bloque): NO existe cobro recurrente real
// todavía (Stripe cobra una vez, al verificarse) — esta pantalla es de solo
// lectura + acciones que ya existen (verificar / cancelar), nunca inventa
// una fecha de "próxima renovación" que no está en ningún lado del schema.
export default function VendorSubscription() {
  const queryClient = useQueryClient();
  const { vendor } = useOutletContext();
  const [confirmingCancel, setConfirmingCancel] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["my-verification"],
    queryFn: async () => (await api.get("/verification/me")).data.verification,
  });

  // Qué incluye cada plan — editable por el admin desde AdminSubscriptions.jsx
  // (ver PlanFeaturesCard), ya no un array hardcodeado en verificationMeta.js.
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const mergedPlans = PLANS.map((p) => ({
    ...p,
    features: settings ? (p.id === "regular" ? settings.planFeaturesRegular : settings.planFeaturesBusiness) : p.features,
  }));

  const cancelPlan = useMutation({
    mutationFn: async () => (await api.patch("/vendors/me", { planType: "REGULAR" })).data,
    onSuccess: () => {
      toast.success("Volviste al Plan Regular.");
      setConfirmingCancel(false);
      queryClient.invalidateQueries({ queryKey: ["my-vendor"] });
      queryClient.invalidateQueries({ queryKey: ["my-verification"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo cancelar la suscripción."),
  });

  if (isLoading) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;

  const stage = data?.stage ?? "REGULAR";
  const meta = STAGE_META[stage];
  const isBusiness = vendor?.planType === "BUSINESS";

  return (
    <div className="max-w-[820px]">
      <h1 className="mb-1 text-display-sm font-extrabold text-on-surface">Suscripción</h1>
      <p className="mb-6 text-body-md text-on-surface-variant">Estado real de tu plan — sin cobro recurrente automático todavía.</p>

      <div className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-6 shadow-sm">
        <div className="flex items-center gap-3.5">
          <div className="flex h-12 w-12 flex-shrink-0 items-center justify-center rounded-md" style={{ background: meta.bg }}>
            <meta.Icon className="h-6 w-6" style={{ color: meta.color }} />
          </div>
          <div>
            <div className="text-[16px] font-bold text-on-surface">Plan {isBusiness ? "Business" : "Regular"}</div>
            <div className="text-[13px] text-outline">{meta.label}</div>
          </div>
        </div>

        {stage === "VERIFICADO" && data?.paymentConfirmedAt && (
          <p className="mt-4 text-[13px] text-on-surface-variant">
            Business activo desde el <strong className="text-on-surface">{fmtDate(data.paymentConfirmedAt)}</strong>.
          </p>
        )}

        {stage === "PENDIENTE_PAGO" && data?.paymentMethod && (
          <div className="mt-4 flex items-center gap-2 text-[13px] text-on-surface-variant">
            {data.paymentMethod === "CARD" ? <CreditCard className="h-4 w-4 text-tertiary-accent" /> : <Landmark className="h-4 w-4 text-tertiary-accent" />}
            Método de pago elegido: <strong className="text-on-surface">{PAYMENT_METHOD_LABEL[data.paymentMethod]}</strong>
          </div>
        )}

        {stage === "PENDIENTE_PAGO" && (
          <Link to="/vendedor/verificacion" className="mt-4 inline-block text-[12.5px] font-semibold text-tertiary-accent hover:underline">
            Continuar el pago →
          </Link>
        )}

        {isBusiness && stage === "VERIFICADO" && (
          <button
            onClick={() => setConfirmingCancel(true)}
            className="mt-5 rounded-xl border border-error px-4 py-2.5 text-[13px] font-bold text-error hover:bg-error/5"
          >
            Cancelar suscripción
          </button>
        )}
      </div>

      {!isBusiness && (
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

          <div className="mb-5 grid grid-cols-1 gap-4 sm:grid-cols-2">
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

          <Link to="/vendedor/verificacion" className="inline-flex items-center rounded-xl bg-secondary-container px-5 py-3 text-[13.5px] font-bold text-on-secondary-container hover:brightness-95">
            Verificar mi empresa
          </Link>
        </>
      )}

      <ConfirmModal
        open={confirmingCancel}
        title="¿Cancelar la suscripción Business?"
        message="Volvés al Plan Regular de inmediato: perdés el badge de verificación, la IA para clientes, el destacado en la home y el límite de productos vuelve a 20. Podés volver a verificarte cuando quieras."
        confirmLabel={cancelPlan.isPending ? "Cancelando..." : "Sí, cancelar"}
        danger
        onConfirm={() => cancelPlan.mutate()}
        onCancel={() => setConfirmingCancel(false)}
      />
    </div>
  );
}
