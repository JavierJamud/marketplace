import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CreditCard, Landmark, Bot, Clock } from "lucide-react";
import { api } from "../../lib/api.js";

const PAYMENT_METHOD_ICON = { CARD: CreditCard, CUP_TRANSFER: Landmark };
const PAYMENT_METHOD_LABEL = { CARD: "Tarjeta (Stripe)", CUP_TRANSFER: "Transferencia CUP" };

const STATUS_META = {
  active: { label: "Activa", bg: "rgba(12,174,83,0.12)", color: "#0A8F42" },
  pending_payment: { label: "Pago pendiente", bg: "rgba(254,152,0,0.15)", color: "#8A5100" },
  rejected: { label: "Rechazada", bg: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
};

function fmtUsd(n) {
  return `US$ ${Number(n).toLocaleString("en-US")}`;
}

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

export default function AdminSubscriptions() {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState(null);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: async () => (await api.get("/admin/subscriptions")).data,
  });

  const revoke = useMutation({
    mutationFn: async (vendorId) => (await api.post(`/admin/vendors/${vendorId}/revoke-business`)).data,
    onSuccess: () => {
      toast.success("Plan Business revocado — se avisó a la tienda.");
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-vendors"] });
      setRevoking(null);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo revocar el Plan Business.");
      setRevoking(null);
    },
  });

  function handleRevoke(sub) {
    if (!window.confirm(`¿Revocar el Plan Business de "${sub.companyName}"? Vuelve a Regular, pierde el badge verificado y las funciones Business — se le avisa por correo. Podés volver a verificarla más adelante.`)) {
      return;
    }
    setRevoking(sub.vendorId);
    revoke.mutate(sub.vendorId);
  }

  const subscriptions = data?.subscriptions ?? [];
  const metrics = data
    ? [
        { label: "Suscripciones activas", value: String(data.metrics.active) },
        { label: "Pago pendiente", value: String(data.metrics.pendingPayment) },
        { label: "Rechazadas", value: String(data.metrics.rejected) },
        { label: "MRR estimado", value: fmtUsd(data.metrics.mrrUsd), delta: "USD, según Stripe" },
      ]
    : [];

  return (
    <div>
      <h1 className="mb-1 font-display text-[25px] font-bold text-on-surface">Suscripciones Business</h1>
      <p className="mb-2 text-[13.5px] text-outline">
        Estado de cobro de cada tienda Business, calculado en vivo a partir del plan y su verificación — nunca un valor guardado aparte.
      </p>
      <div className="mb-6 rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
        💡 Todavía no hay cobro recurrente automático (Stripe cobra una vez, al verificarse) — "Activa"/"Pago pendiente"/"Rechazada" reflejan el estado real de cada tienda, y "Revocar" es una decisión manual del admin, nunca un vencimiento solo.
      </div>

      <div className="mb-6 grid grid-cols-2 gap-[18px] lg:grid-cols-4">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5">
            <div className="mb-2 text-[12.5px] text-outline">{m.label}</div>
            <div className="font-display text-2xl font-extrabold text-on-surface">{m.value}</div>
            {m.delta && <div className="mt-1 text-[11.5px] font-semibold text-verified-dark">{m.delta}</div>}
          </div>
        ))}
      </div>

      <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest">
        <div className="grid grid-cols-[2fr_1.2fr_1fr_1.4fr_1fr] gap-3 bg-surface-container-low px-[22px] py-3.5 text-[11.5px] font-bold uppercase tracking-wide text-outline">
          <span>Tienda</span><span>Provincia</span><span>Estado</span><span>Pago</span><span className="text-right">Acciones</span>
        </div>
        {isLoading && <p className="p-5 text-body-md text-on-surface-variant">Cargando...</p>}
        {!isLoading && subscriptions.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">Todavía no hay tiendas en el Plan Business.</p>}
        {subscriptions.map((s) => {
          const status = STATUS_META[s.status];
          const PaymentIcon = PAYMENT_METHOD_ICON[s.paymentMethod];
          return (
            <div key={s.vendorId} className="grid grid-cols-[2fr_1.2fr_1fr_1.4fr_1fr] items-center gap-3 border-t border-surface-container px-[22px] py-3.5">
              <div className="flex items-center gap-2.5">
                <span
                  className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white"
                  style={{ background: s.color ?? "#232F3E" }}
                >
                  {s.companyName[0]}
                </span>
                <span className="text-[13.5px] font-semibold text-on-surface">{s.companyName}</span>
              </div>
              <span className="text-[13px] text-on-surface-variant">{s.province ?? "—"}</span>
              <span className="w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: status.bg, color: status.color }}>
                {status.label}
              </span>
              <div className="text-[12px] text-on-surface-variant">
                {s.paymentMethod ? (
                  <div className="flex items-center gap-1.5">
                    <PaymentIcon className="h-3.5 w-3.5 flex-shrink-0 text-tertiary-accent" />
                    <span>{PAYMENT_METHOD_LABEL[s.paymentMethod]}</span>
                  </div>
                ) : (
                  <span className="text-outline">Sin elegir todavía</span>
                )}
                {s.paymentConfirmedAt && <div className="mt-0.5 text-[11px] text-outline">Confirmado {fmtDate(s.paymentConfirmedAt)}</div>}
                {!s.paymentConfirmedAt && s.paymentMethod === "CARD" && (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-outline">
                    <Clock className="h-3 w-3 flex-shrink-0" />
                    {s.stripeCheckoutExpired ? "Link vencido" : "Esperando pago en Stripe"}
                  </div>
                )}
              </div>
              <div className="flex flex-wrap justify-end gap-1.5">
                <Link
                  to={`/tienda/${s.slug}`}
                  target="_blank"
                  className="rounded-[7px] bg-surface-container px-2.5 py-1.5 text-[12px] font-semibold text-on-surface-variant"
                >
                  Ver
                </Link>
                {s.status === "active" && (
                  <button
                    onClick={() => handleRevoke(s)}
                    disabled={revoke.isPending && revoking === s.vendorId}
                    className="flex items-center gap-1 rounded-[7px] border border-error px-2.5 py-1.5 text-[12px] font-semibold text-error disabled:opacity-50"
                  >
                    <Bot className="h-3.5 w-3.5" />
                    {revoke.isPending && revoking === s.vendorId ? "Revocando..." : "Revocar"}
                  </button>
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
