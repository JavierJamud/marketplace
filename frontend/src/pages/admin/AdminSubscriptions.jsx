import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { CreditCard, Landmark, Bot, Clock, X, Plus, ListChecks } from "lucide-react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

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

// Lista de chips de texto libre — mismo patrón que "Métodos de pago" en
// VendorSettings.jsx (~línea 405-443), acá sin la mitad de catálogo fijo
// porque no hay un set predefinido de features de plan.
function FeatureChipList({ items, onChange }) {
  const [draft, setDraft] = useState("");

  function addItem() {
    const value = draft.trim();
    if (!value || items.includes(value)) return;
    onChange([...items, value]);
    setDraft("");
  }

  return (
    <div>
      <div className="mb-2 flex flex-wrap gap-2">
        {items.map((item) => (
          <span
            key={item}
            className="flex items-center gap-1.5 rounded-full border border-tertiary-accent bg-tertiary-accent/10 px-3.5 py-2 text-[12.5px] font-semibold text-tertiary-accent"
          >
            {item}
            <button type="button" onClick={() => onChange(items.filter((x) => x !== item))}>
              <X className="h-3 w-3" />
            </button>
          </span>
        ))}
        {items.length === 0 && <span className="text-[12px] italic text-outline">Sin puntos todavía.</span>}
      </div>
      <div className="flex gap-2">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              addItem();
            }
          }}
          placeholder="Ej.: Productos ilimitados..."
          className="h-10 flex-1 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
        <Button variant="outline" className="rounded-lg" size="sm" disabled={!draft.trim()} onClick={addItem}>
          <Plus className="h-3.5 w-3.5" />
        </Button>
      </div>
    </div>
  );
}

// Qué incluye cada plan (Regular/Business) — se refleja en
// VendorVerification.jsx (Verificación y Suscripción se unificaron ahí) vía
// GET /settings. Antes era un array hardcodeado en
// frontend/src/lib/verificationMeta.js; ahora vive en SiteSettings y el
// admin lo edita acá.
function PlanFeaturesCard() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const [regular, setRegular] = useState([]);
  const [business, setBusiness] = useState([]);

  useEffect(() => {
    if (!settings) return;
    setRegular(settings.planFeaturesRegular ?? []);
    setBusiness(settings.planFeaturesBusiness ?? []);
  }, [settings]);

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch("/admin/settings/plan-features", { planFeaturesRegular: regular, planFeaturesBusiness: business })).data,
    onSuccess: () => {
      toast.success("Contenido de los planes actualizado.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  return (
    <div className="mb-6 rounded-lg border border-surface-container-high bg-surface-container-lowest p-6">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <ListChecks className="h-5 w-5 text-tertiary-accent" /> Qué incluye cada plan
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        Estos puntos son los que ven los vendedores en Verificación y Suscripción de su panel — se actualizan ahí apenas
        los guardas acá.
      </p>
      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2">
        <div>
          <div className="mb-2 text-label-md font-semibold text-on-surface-variant">Plan Regular</div>
          <FeatureChipList items={regular} onChange={setRegular} />
        </div>
        <div>
          <div className="mb-2 text-label-md font-semibold text-on-surface-variant">Plan Business</div>
          <FeatureChipList items={business} onChange={setBusiness} />
        </div>
      </div>
      <Button className="mt-4 rounded-xl font-bold" disabled={save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Guardando..." : "Guardar cambios"}
      </Button>
    </div>
  );
}

export default function AdminSubscriptions() {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null); // sub a revocar, para el modal de confirmación

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
      setConfirmRevoke(null);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo revocar el Plan Business.");
      setRevoking(null);
      setConfirmRevoke(null);
    },
  });

  function handleRevoke(sub) {
    setConfirmRevoke(sub);
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

      <PlanFeaturesCard />

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

      <ConfirmModal
        open={!!confirmRevoke}
        title={`¿Revocar el Plan Business de "${confirmRevoke?.companyName}"?`}
        message="Vuelve a Regular, pierde el badge verificado y las funciones Business — se le avisa por correo. Puedes volver a verificarla más adelante."
        confirmLabel={revoke.isPending ? "Revocando..." : "Sí, revocar"}
        danger
        onConfirm={() => {
          setRevoking(confirmRevoke.vendorId);
          revoke.mutate(confirmRevoke.vendorId);
        }}
        onCancel={() => setConfirmRevoke(null)}
      />
    </div>
  );
}
