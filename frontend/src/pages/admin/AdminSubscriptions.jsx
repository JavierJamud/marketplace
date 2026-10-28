import { useEffect, useMemo, useState } from "react";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { Link } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { CreditCard, Landmark, Clock, X, Plus, Sparkles, HandCoins } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { NotifyVendorCheckbox } from "../../components/admin/NotifyVendorCheckbox.jsx";
import { notifyVendorConfig } from "../../lib/notifyVendor.js";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

const PAYMENT_METHOD_ICON = { CARD: CreditCard, CUP_TRANSFER: Landmark, MANUAL: HandCoins };
const PAYMENT_METHOD_LABEL = { CARD: "Tarjeta (Stripe)", CUP_TRANSFER: "Transferencia CUP", MANUAL: "Registrado por el equipo" };

// Bloque 64: status ya viene calculado 1:1 desde Vendor.verificationStatus
// (ver listSubscriptions en admin.controller.js) — se agregan los 2 estados
// nuevos del cobro recurrente.
const STATUS_META = {
  active: { label: "Activa", bg: "rgba(12,174,83,0.12)", color: "#087A38" },
  // Prueba gratis: Premium completo sin pagar todavía.
  trial: { label: "Prueba gratis", bg: "rgba(51,116,117,0.12)", color: "#245a5b" },
  pending_payment: { label: "Pago pendiente", bg: "rgba(254,152,0,0.15)", color: "#8A5100" },
  rejected: { label: "Rechazada", bg: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
  payment_failed: { label: "Pago fallido", bg: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
  suspended: { label: "Suspendida", bg: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
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

// Bloque 52: límites numéricos de PlanConfig — vacío = sin límite (null en
// la base). Antes de este bloque, solo los 2 de ubicación eran editables
// (en AdminLocations.jsx); los demás eran constantes hardcodeadas en el
// backend o ni siquiera existían como tope.
const PLAN_LIMIT_FIELDS = [
  { key: "maxProducts", label: "Productos publicados" },
  { key: "maxProvinces", label: "Provincias de Cuba donde vende" },
  { key: "maxDeliveryCountries", label: "Países de entrega" },
  { key: "maxMonthlyOrderEmails", label: "Emails manuales a clientes (por mes)" },
  { key: "maxStaffUsers", label: "Usuarios de sistema (personal de tienda)" },
  { key: "maxTables", label: "Mesas con QR (restaurantes)" },
  { key: "maxActiveStoreOffers", label: "Ofertas de tienda activas a la vez" },
  { key: "maxDiscountCodes", label: "Códigos de descuento" },
];

// Bloque 52: interruptores de función de PlanConfig. allowPublicProfile
// decide si la tienda puede ELEGIR ponerse privada (true = puede elegir;
// false = siempre pública, no puede ocultarse) — no al revés.
// allowWhatsappOrders: si la tienda puede ofrecer el botón para que el cliente le mande el pedido por WhatsApp. El panel
// lo tienen todos los planes (todo pedido entra ahí), por eso allowPanelOrders ya no aparece.
const PLAN_TOGGLE_FIELDS = [
  { key: "allowAiChatbot", label: "Chatbot con IA para clientes" },
  { key: "allowStoreOffers", label: "Ofertas dentro de su tienda" },
  { key: "allowDiscountCodes", label: "Códigos de descuento" },
  { key: "allowQrTables", label: "Mesas con QR (restaurantes)" },
  { key: "allowStaffUsers", label: "Personal de tienda (usuarios de sistema)" },
  { key: "allowAdminChat", label: "Chat directo con el equipo" },
  { key: "allowReviewPhotos", label: "Clientes pueden adjuntar fotos en reseñas" },
  { key: "allowSchedules", label: "Horarios de atención" },
  { key: "allowPublicProfile", label: "Puede poner su perfil privado" },
  { key: "allowWhatsappOrders", label: "Botón para enviar el pedido también por WhatsApp" },
  { key: "featuredInHome", label: "Destacada en la Home / búsqueda" },
  { key: "allowLoyalty", label: "Programa de fidelidad (puntos) para sus clientes" },
  { key: "allowPos", label: "Caja con código de barras" },
  { key: "allowCustomerEmails", label: "Correos a clientes y avisos de gestión por correo" },
];

// Descuentos por pagar varios meses juntos: una fila por escalón (meses, % en CUP, % en USD).
function DiscountEditor({ rows, onChange }) {
  const set = (i, key, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [key]: value } : r)));
  const field = "h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent";
  return (
    <div>
      {rows.length > 0 && (
        <div className="mb-1 grid grid-cols-[1fr_1fr_1fr_40px] gap-2 text-[11.5px] font-semibold text-outline">
          <span>Desde (meses)</span>
          <span>Descuento CUP (%)</span>
          <span>Descuento USD (%)</span>
          <span />
        </div>
      )}
      {rows.map((r, i) => (
        <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_1fr_40px] items-center gap-2">
          <input aria-label={`Meses del descuento ${i + 1}`} inputMode="numeric" value={r.months} onChange={(e) => set(i, "months", e.target.value.replace(/\D/g, ""))} className={field} />
          <input aria-label={`Descuento en CUP ${i + 1}`} inputMode="numeric" value={r.cup} onChange={(e) => set(i, "cup", e.target.value.replace(/\D/g, ""))} className={field} />
          <input aria-label={`Descuento en USD ${i + 1}`} inputMode="numeric" value={r.usd} onChange={(e) => set(i, "usd", e.target.value.replace(/\D/g, ""))} className={field} />
          <button type="button" aria-label={`Quitar el descuento ${i + 1}`} onClick={() => onChange(rows.filter((_, j) => j !== i))} className="flex h-10 w-10 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        </div>
      ))}
      {rows.length < 6 && (
        <button type="button" onClick={() => onChange([...rows, { months: "", cup: "", usd: "" }])} className="flex min-h-10 items-center gap-1.5 text-[13px] font-bold text-tertiary-accent">
          <Plus className="h-4 w-4" aria-hidden="true" /> Agregar descuento
        </button>
      )}
      <p className="mt-1 text-[11.5px] text-outline">Se aplica el escalón más alto alcanzado: con descuentos en 3, 6 y 12 meses, quien paga 8 meses recibe el de 6.</p>
    </div>
  );
}

const toText = (v) => (v === null || v === undefined ? "" : String(v));
const numOrNull = (v) => (String(v).trim() === "" ? null : Number(String(v).replace(",", ".")));

// Una tarjeta por plan: precio y página pública, beneficios, límites y funciones. Guarda todo el plan en un solo pedido
// (PATCH /admin/plan-configs); pide el código de confirmación (PLAN_CONFIG_CHANGE).
function PlanConfigCard({ plan, vendorCount }) {
  const queryClient = useQueryClient();
  const [form, setForm] = useState(null);
  const [confirmPaid, setConfirmPaid] = useState(false);

  useEffect(() => {
    if (!plan) return;
    setForm({
      displayName: plan.displayName,
      tagline: plan.tagline ?? "",
      sortOrder: toText(plan.sortOrder),
      priceCup: toText(plan.priceCup),
      priceUsd: toText(plan.priceUsd),
      listPriceCup: toText(plan.listPriceCup),
      listPriceUsd: toText(plan.listPriceUsd),
      isFree: !!plan.isFree,
      contactOnly: !!plan.contactOnly,
      highlighted: !!plan.highlighted,
      grantsBadge: !!plan.grantsBadge,
      isPublic: plan.isPublic !== false,
      monthDiscounts: (plan.monthDiscounts ?? []).map((d) => ({ months: toText(d.months), cup: toText(d.cup), usd: toText(d.usd) })),
      features: plan.features ?? [],
      ...Object.fromEntries(PLAN_LIMIT_FIELDS.map((f) => [f.key, plan[f.key]])),
      ...Object.fromEntries(PLAN_TOGGLE_FIELDS.map((f) => [f.key, plan[f.key]])),
    });
  }, [plan]);

  const body = () => ({
    planType: plan.planType,
    ...form,
    tagline: form.tagline.trim() || null,
    sortOrder: Number(form.sortOrder) || 0,
    priceCup: Number(form.priceCup) || 0,
    priceUsd: Number(String(form.priceUsd).replace(",", ".")) || 0,
    listPriceCup: numOrNull(form.listPriceCup),
    listPriceUsd: numOrNull(form.listPriceUsd),
    monthDiscounts: form.monthDiscounts
      .filter((d) => String(d.months).trim() !== "")
      .map((d) => ({ months: Number(d.months), cup: Number(d.cup) || 0, usd: Number(d.usd) || 0 })),
  });

  const save = useMutation({
    mutationFn: async () => (await api.patch("/admin/plan-configs", body())).data,
    onSuccess: () => {
      toast.success(`Plan ${form.displayName} actualizado.`);
      setConfirmPaid(false);
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin-plan-configs"] });
      queryClient.invalidateQueries({ queryKey: ["public-plans"] });
    },
    onError: (err) => {
      if (!err.actionCodeCancelled) toast.error(err.response?.data?.error ?? "No se pudo guardar.");
    },
  });

  if (!form) return null;
  const set = (key) => (e) => setForm({ ...form, [key]: e.target.value });
  const toggle = (key) => (e) => setForm({ ...form, [key]: e.target.checked });
  const price = "h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent";
  const goingPaid = plan.isFree && !form.isFree && !form.contactOnly;
  const discountsInvalid = form.monthDiscounts.some((d) => String(d.months).trim() !== "" && (!(Number(d.months) >= 2 && Number(d.months) <= 36) || Number(d.cup) > 90 || Number(d.usd) > 90));
  const priceMissing = !form.isFree && !form.contactOnly && (!(Number(form.priceCup) > 0) || !(Number(String(form.priceUsd).replace(",", ".")) > 0));

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] sm:p-6">
      <div className="mb-5 grid gap-3 sm:grid-cols-[minmax(0,1fr)_minmax(0,2fr)_100px]">
        <Input label="Nombre visible del plan" value={form.displayName} onChange={set("displayName")} />
        <Input label="Frase corta (página de planes)" value={form.tagline} onChange={set("tagline")} placeholder="Ej.: Para empezar a vender en línea" />
        <Input label="Orden" inputMode="numeric" value={form.sortOrder} onChange={(e) => setForm({ ...form, sortOrder: e.target.value.replace(/\D/g, "") })} />
      </div>

      <section className="mb-5 rounded-xl bg-surface-container/50 p-4">
        <div className="mb-3 text-label-md font-bold text-on-surface">Precio y página pública</div>
        <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-2">
          {[
            ["isFree", "Gratis por ahora", "Se muestra el precio de lista tachado. Al apagarlo, se cobra y se avisa a sus tiendas."],
            ["contactOnly", "Se contrata por WhatsApp", "Sin precio publicado: el botón abre el WhatsApp de soporte."],
            ["highlighted", "Destacado como el más elegido", "Solo un plan a la vez; al marcar este se quita del otro."],
            ["grantsBadge", "Da la insignia de verificada", "La tienda tiene que pasar la verificación de documentos."],
            ["isPublic", "Se muestra en la página de planes", "Apágalo para ocultar un plan sin borrarlo."],
          ].map(([key, label, hint]) => (
            <label key={key} className="flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-outline-variant bg-surface-container-lowest p-2.5">
              <input type="checkbox" checked={!!form[key]} onChange={toggle(key)} className="mt-0.5 h-4 w-4 flex-shrink-0 accent-tertiary-accent" />
              <span>
                <span className="block text-[13px] font-semibold text-on-surface">{label}</span>
                <span className="block text-[11.5px] text-outline">{hint}</span>
              </span>
            </label>
          ))}
        </div>
        {!form.contactOnly && (
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-outline">Precio al mes (CUP)</label>
              <input inputMode="numeric" value={form.priceCup} onChange={(e) => setForm({ ...form, priceCup: e.target.value.replace(/\D/g, "") })} className={price} />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-outline">Precio al mes (USD)</label>
              <input inputMode="decimal" value={form.priceUsd} onChange={(e) => setForm({ ...form, priceUsd: e.target.value.replace(/[^\d.,]/g, "") })} className={price} />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-outline">Precio tachado (CUP)</label>
              <input inputMode="numeric" value={form.listPriceCup} placeholder="Sin tachado" onChange={(e) => setForm({ ...form, listPriceCup: e.target.value.replace(/\D/g, "") })} className={price} />
            </div>
            <div>
              <label className="mb-1 block text-[11.5px] font-semibold text-outline">Precio tachado (USD)</label>
              <input inputMode="decimal" value={form.listPriceUsd} placeholder="Sin tachado" onChange={(e) => setForm({ ...form, listPriceUsd: e.target.value.replace(/[^\d.,]/g, "") })} className={price} />
            </div>
          </div>
        )}
        {priceMissing && <p className="mt-2 text-[12px] font-semibold text-error">Para cobrar este plan escribe su precio en CUP y en USD.</p>}
        {!form.contactOnly && !form.isFree && (
          <div className="mt-4">
            <div className="mb-1 text-[12.5px] font-bold text-on-surface">Descuentos por pagar varios meses</div>
            <DiscountEditor rows={form.monthDiscounts} onChange={(monthDiscounts) => setForm({ ...form, monthDiscounts })} />
          </div>
        )}
        {goingPaid && (
          <p className="mt-3 rounded-lg bg-secondary-container/25 px-3 py-2 text-[12.5px] text-on-surface">
            Al guardar, este plan empieza a cobrarse. {vendorCount != null ? `Se avisará a ${vendorCount === 1 ? "la tienda" : `las ${vendorCount} tiendas`} de este plan` : "Se avisará a sus tiendas"} para que paguen antes de su fecha de cobro mensual (contada desde que se registraron).
          </p>
        )}
      </section>

      <div className="mb-5">
        <div className="mb-1 text-label-md font-semibold text-on-surface-variant">Beneficios extra (texto libre, lo ve la tienda)</div>
        <p className="mb-2 text-[12px] text-on-surface-variant">
          Los límites y las funciones de abajo ya se muestran solos con su valor real. Aquí escribe solo beneficios que no estén en esa lista y sin números: las líneas con números no se muestran, para que nunca contradigan un límite.
        </p>
        <FeatureChipList items={form.features} onChange={(features) => setForm({ ...form, features })} />
      </div>

      <div className="mb-5">
        <div className="mb-2 text-label-md font-semibold text-on-surface-variant">Límites (vacío = sin límite)</div>
        {plan.planType === "REGULAR" && (
          <p className="mb-3 rounded-lg bg-tertiary-accent/[0.07] px-3 py-2 text-[12px] text-on-surface">
            Estos límites se aplican también cuando una tienda termina su prueba gratis o baja de plan. Los productos que pasen del límite quedan ocultos, nunca se borran.
          </p>
        )}
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {PLAN_LIMIT_FIELDS.map((f) => (
            <div key={f.key}>
              <label className="mb-1 block text-[11.5px] font-semibold text-outline">{f.label}</label>
              <input
                type="number"
                min={0}
                value={form[f.key] ?? ""}
                placeholder="Sin límite"
                onChange={(e) => setForm({ ...form, [f.key]: e.target.value === "" ? null : Math.max(0, Number(e.target.value)) })}
                className="h-10 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
              />
            </div>
          ))}
        </div>
      </div>

      <div className="mb-5">
        <div className="mb-2 text-label-md font-semibold text-on-surface-variant">Funciones habilitadas</div>
        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
          {PLAN_TOGGLE_FIELDS.map((f) => (
            <label key={f.key} className="flex min-h-9 items-center gap-2 text-[12.5px] text-on-surface">
              <input type="checkbox" checked={!!form[f.key]} onChange={toggle(f.key)} className="h-4 w-4 flex-shrink-0 rounded border-outline-variant accent-tertiary-accent" />
              {f.label}
            </label>
          ))}
        </div>
      </div>

      <Button className="rounded-xl font-bold" disabled={save.isPending || discountsInvalid || priceMissing} onClick={() => (goingPaid ? setConfirmPaid(true) : save.mutate())}>
        {save.isPending ? "Guardando..." : `Guardar ${form.displayName}`}
      </Button>
      {discountsInvalid && <p className="mt-2 text-[12px] text-error">Cada descuento va de 2 a 36 meses y hasta 90 %.</p>}

      <ConfirmModal
        open={confirmPaid}
        title={`¿Empezar a cobrar el plan ${form.displayName}?`}
        message={`Dejará de ser gratis: costará ${Number(form.priceCup).toLocaleString("es-CU")} CUP o ${form.priceUsd} USD al mes. Cada tienda de este plan recibe un aviso con su fecha de pago (mensual, desde que se registró) y otros recordatorios antes y después. Si no paga, pasa a modo limitado y luego a suspendida, según los días que configures.`}
        confirmLabel={save.isPending ? "Guardando..." : "Sí, empezar a cobrar"}
        confirmDisabled={save.isPending}
        onConfirm={() => save.mutate()}
        onCancel={() => setConfirmPaid(false)}
      />
    </div>
  );
}

export function PlanConfigTab() {
  const [active, setActive] = useState(null);
  const { data: plans } = useQuery({
    queryKey: ["admin-plan-configs"],
    queryFn: async () => (await api.get("/admin/plan-configs")).data.plans,
  });
  const { data: counts } = useQuery({
    queryKey: ["admin-plan-vendor-counts"],
    queryFn: async () => (await api.get("/admin/plan-configs/vendor-counts")).data.counts,
  });
  const current = plans?.find((p) => p.planType === active) ?? plans?.[0];

  return (
    <div>
      <p className="mb-4 text-[13px] text-outline">
        Lo que configures aquí es lo que de verdad aplica el sistema y lo que ven todos en la{" "}
        <Link to="/planes" target="_blank" className="font-bold text-tertiary-accent underline">página de planes</Link>, en el registro y en el panel de cada tienda.
      </p>
      <div role="tablist" aria-label="Planes" className="mb-4 flex flex-wrap gap-1.5">
        {(plans ?? []).map((p) => {
          const on = current?.planType === p.planType;
          return (
            <button
              key={p.planType}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => setActive(p.planType)}
              className={`flex min-h-11 flex-shrink-0 items-center gap-2 rounded-xl border px-4 text-[13.5px] font-bold ${on ? "border-tertiary-accent bg-tertiary-accent/10 text-tertiary-accent" : "border-outline-variant text-on-surface hover:bg-surface-container"}`}
            >
              {p.displayName}
              <span className="rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-semibold text-on-surface-variant">
                {p.contactOnly ? "WhatsApp" : p.isFree ? "Gratis" : `${Number(p.priceCup).toLocaleString("es-CU")} CUP`}
              </span>
              {counts && <span className="text-[11px] font-semibold text-outline">{counts[p.planType] ?? 0} tiendas</span>}
            </button>
          );
        })}
      </div>
      {current && <PlanConfigCard key={current.planType} plan={current} vendorCount={counts?.[current.planType]} />}
    </div>
  );
}

// Bloque 64: cuenta/monto/instrucciones que ve el vendedor en /vendedor/pago-manual
// al pagar por transferencia CUP — antes hardcodeado a mano en el frontend
// ("CI: 9205-XXXX-XXXX"), ahora editable acá sin redeploy. Bloque 150: suma
// el precio mensual del cobro con tarjeta. Bloque 52: suma el teléfono de
// contacto para verificar/notificar el pago (pedido explícito, opcional).
export function CupPaymentSettingsCard() {
  const queryClient = useQueryClient();
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const [form, setForm] = useState({
    cupBankAccountNumber: "",
    cupBankAccountHolder: "",
    cupBankInstructions: "",
    cupBankPhone: "",
    trialDays: 30,
    unpaidSuspendDays: 30,
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      cupBankAccountNumber: settings.cupBankAccountNumber ?? "",
      cupBankAccountHolder: settings.cupBankAccountHolder ?? "",
      cupBankInstructions: settings.cupBankInstructions ?? "",
      cupBankPhone: settings.cupBankPhone ?? "",
      trialDays: settings.trialDays ?? 30,
      unpaidSuspendDays: settings.unpaidSuspendDays ?? 30,
    });
  }, [settings]);

  // Los precios de cada plan se editan en "Configuración de planes".
  const unpaidDays = Number(form.unpaidSuspendDays);
  const unpaidDaysError = form.unpaidSuspendDays === "" || !Number.isInteger(unpaidDays) || unpaidDays < 1 || unpaidDays > 365 ? "Escribe un número de días entre 1 y 365." : null;

  const trialDays = Number(form.trialDays);
  const trialDaysError = form.trialDays === "" || !Number.isInteger(trialDays) || trialDays < 1 || trialDays > 365 ? "Escribe un número de días entre 1 y 365." : null;

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch("/admin/settings/cup-payment", { ...form, trialDays, unpaidSuspendDays: unpaidDays })).data,
    onSuccess: () => {
      toast.success("Datos de pago de la suscripción actualizados.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <Landmark className="h-5 w-5 text-tertiary-accent" /> Datos de pago de la suscripción
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        Los precios de cada plan y sus descuentos por meses están en "Configuración de planes". Aquí van los datos de
        transferencia CUP que el vendedor copia al pagar (si están vacíos, le pedimos que contacte al equipo), los días de la
        prueba gratis (valen para las pruebas nuevas) y cuántos días sin pagar pasan antes de suspender una tienda.
      </p>
      <div className="mb-3.5 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
        <Input
          label="Días sin pagar antes de suspender la tienda"
          inputMode="numeric"
          value={form.unpaidSuspendDays}
          error={unpaidDaysError}
          onChange={(e) => setForm({ ...form, unpaidSuspendDays: e.target.value.replace(/\D/g, "") })}
        />
        <Input
          label="Días de la prueba gratis de Premium"
          inputMode="numeric"
          value={form.trialDays}
          error={trialDaysError}
          onChange={(e) => setForm({ ...form, trialDays: e.target.value.replace(/\D/g, "") })}
        />
        <Input
          label="Número de cuenta"
          value={form.cupBankAccountNumber}
          onChange={(e) => setForm({ ...form, cupBankAccountNumber: e.target.value })}
        />
        <Input
          label="A nombre de"
          value={form.cupBankAccountHolder}
          onChange={(e) => setForm({ ...form, cupBankAccountHolder: e.target.value })}
        />
        <Input
          label="Teléfono de verificación/notificación (opcional)"
          value={form.cupBankPhone}
          onChange={(e) => setForm({ ...form, cupBankPhone: e.target.value })}
          placeholder="+5355512345"
        />
      </div>
      <label className="mb-1 block text-label-md font-semibold text-on-surface-variant">Instrucciones adicionales (CUP)</label>
      <textarea
        value={form.cupBankInstructions}
        onChange={(e) => setForm({ ...form, cupBankInstructions: e.target.value })}
        rows={3}
        placeholder="Ej.: incluir el nombre de la tienda como referencia..."
        className="mb-4 w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
      />
      <Button className="rounded-xl font-bold" disabled={save.isPending || !!unpaidDaysError || !!trialDaysError} onClick={() => save.mutate()}>
        {save.isPending ? "Guardando..." : "Guardar cambios"}
      </Button>
    </div>
  );
}

// Bloque 52 (pedido explícito — "también podemos activar la suscripción
// manualmente... se debe justificar y poner el motivo"): la tabla de abajo
// solo lista tiendas YA en el Plan Business (ver listSubscriptions,
// admin.controller.js) — una tienda Regular nunca aparece ahí, así que esto
// vive aparte, con su propio selector de tienda.
function GrantBusinessCard() {
  const queryClient = useQueryClient();
  // Bloque 243: GET /admin/vendors ahora pagina — en vez de bajar todas las
  // tiendas y filtrar las Regular acá, se busca en el servidor (plan=REGULAR)
  // con un campo de texto y se muestran las 20 primeras coincidencias. La
  // tienda ya elegida se conserva aunque la búsqueda cambie.
  const [vendorId, setVendorId] = useState("");
  const [selectedVendor, setSelectedVendor] = useState(null);
  const [vendorSearch, setVendorSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [reason, setReason] = useState("");
  const [notifyVendor, setNotifyVendor] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(vendorSearch.trim()), 300);
    return () => clearTimeout(timer);
  }, [vendorSearch]);
  const { data: vendors } = useQuery({
    queryKey: ["admin-vendor-pick", debouncedSearch],
    queryFn: async () =>
      (await api.get("/admin/vendors", { params: { plan: "REGULAR", q: debouncedSearch || undefined, pageSize: 20, sort: "name", dir: "asc" } })).data.vendors,
  });
  const regularVendors = vendors ?? [];
  const vendorOptions =
    selectedVendor && !regularVendors.some((v) => v.id === selectedVendor.id) ? [selectedVendor, ...regularVendors] : regularVendors;

  // Plan a activar: cualquiera de pago (Empresarial solo se activa así, porque se contrata hablando con el equipo).
  const { planNames } = usePlatformSettings();
  const [grantPlan, setGrantPlan] = useState("BUSINESS");
  const grant = useMutation({
    mutationFn: async () => (await api.post(`/admin/vendors/${vendorId}/grant-business`, { reason: reason.trim(), planType: grantPlan }, notifyVendorConfig(notifyVendor))).data,
    onSuccess: () => {
      toast.success(`Plan ${planNames[grantPlan]} activado a mano.`);
      setNotifyVendor(false);
      setVendorId("");
      setSelectedVendor(null);
      setReason("");
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
      queryClient.invalidateQueries({ queryKey: ["admin-vendor-pick"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo activar el plan."),
  });

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
      <div className="mb-1 flex items-center gap-2 text-title-lg font-bold text-on-surface">
        <Sparkles className="h-5 w-5 text-tertiary-accent" /> Activar un plan a mano
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        Para casos excepcionales o para el plan {planNames.ENTERPRISE}: activa la insignia de verificada y el plan que elijas sin pasar por los
        documentos ni el pago. Queda registrado con el motivo que escribas, visible en su historial.
      </p>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_2fr]">
        <div className="flex flex-col gap-2">
          <Input label={`Buscar tienda (plan ${planNames.REGULAR})`} value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)} placeholder="Nombre de la tienda" />
          <Select
            aria-label="Tienda a la que activar el plan"
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              setSelectedVendor(vendorOptions.find((v) => v.id === e.target.value) ?? null);
            }}
          >
            <option value="">{vendorOptions.length ? "Elige una tienda..." : "Ninguna tienda coincide"}</option>
            {vendorOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.companyName}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
        <Select aria-label="Plan a activar" value={grantPlan} onChange={(e) => setGrantPlan(e.target.value)}>
          {["STANDARD", "BUSINESS", "ENTERPRISE"].map((p) => (
            <option key={p} value={p}>
              Plan {planNames[p]}
            </option>
          ))}
        </Select>
        <Input
          label="Motivo (obligatorio)"
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="Ej.: acuerdo comercial directo con el vendedor..."
        />
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1">
        <Button
          className="rounded-xl font-bold"
          disabled={!vendorId || reason.trim().length < 5 || grant.isPending}
          onClick={() => grant.mutate()}
        >
          {grant.isPending ? "Activando..." : `Activar plan ${planNames[grantPlan]}`}
        </Button>
        <NotifyVendorCheckbox checked={notifyVendor} onChange={setNotifyVendor} />
      </div>
    </div>
  );
}

function SubscriptionsTab() {
  const queryClient = useQueryClient();
  const [revoking, setRevoking] = useState(null);
  const [confirmRevoke, setConfirmRevoke] = useState(null);
  const [revokeReason, setRevokeReason] = useState("");
  const [notifyVendor, setNotifyVendor] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: async () => (await api.get("/admin/subscriptions")).data,
  });

  const revoke = useMutation({
    mutationFn: async ({ vendorId, reason }) => (await api.post(`/admin/vendors/${vendorId}/revoke-business`, { reason }, notifyVendorConfig(notifyVendor))).data,
    onSuccess: () => {
      toast.success("Plan Premium revocado.");
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
      queryClient.invalidateQueries({ queryKey: ["admin-vendor-pick"] });
      setRevoking(null);
      setConfirmRevoke(null);
      setRevokeReason("");
      setNotifyVendor(false);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo revocar el Plan Premium.");
      setRevoking(null);
    },
  });

  const subscriptions = data?.subscriptions ?? [];
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  // Filtros por estado: "Con problemas" junta pago fallido y suspendida, que piden la misma acción (revisar el cobro).
  const FILTERS = [
    { id: "all", label: "Todas", match: () => true },
    { id: "active", label: "Pagando", match: (s) => s.status === "active" },
    { id: "trial", label: "Prueba gratis", match: (s) => s.status === "trial" },
    { id: "pending_payment", label: "Pago pendiente", match: (s) => s.status === "pending_payment" },
    { id: "problems", label: "Con problemas", match: (s) => ["payment_failed", "suspended", "rejected"].includes(s.status) },
  ];
  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
    const q = search.trim().toLowerCase();
    return subscriptions.filter((s) => f.match(s) && (!q || s.companyName.toLowerCase().includes(q)));
  }, [subscriptions, filter, search]); // eslint-disable-line react-hooks/exhaustive-deps
  const metrics = data
    ? [
        { label: "Pagando", value: String(data.metrics.active) },
        { label: "Prueba gratis", value: String(data.metrics.trial ?? 0), delta: "Premium completo, no suma al MRR" },
        { label: "Pago pendiente", value: String(data.metrics.pendingPayment) },
        { label: "Problemas de cobro", value: String(data.metrics.paymentFailed + data.metrics.suspended) },
        { label: "MRR estimado", value: fmtUsd(data.metrics.mrrUsd), delta: "USD, solo tiendas que pagan" },
      ]
    : [];
  const countFor = (f) => subscriptions.filter(f.match).length;

  return (
    <div>
      <div className="mb-6 rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
        El cobro es recurrente: Stripe cobra cada mes solo (factura fallida = "Pago fallido", suscripción cancelada = "Suspendida"); CUP se
        renueva a mano cada ciclo, con recordatorio automático 7 días antes de vencer. Las tiendas en "Prueba gratis" tienen todas las funciones
        Premium, reciben aviso 7, 3 y 1 día antes de que termine la prueba y al terminar pasan solas al Básico, sin insignia y con sus límites.
      </div>

      <div className="mb-6">
        <GrantBusinessCard />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-[18px] lg:grid-cols-5">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] sm:p-5">
            <div className="mb-2 text-[12.5px] text-outline">{m.label}</div>
            <div className="font-display text-2xl font-extrabold text-on-surface">{m.value}</div>
            {m.delta && <div className="mt-1 text-[11.5px] font-semibold text-on-surface-variant">{m.delta}</div>}
          </div>
        ))}
      </div>

      <div className="mb-3 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex flex-wrap gap-1.5" role="tablist" aria-label="Filtrar suscripciones">
          {FILTERS.map((f) => (
            <button
              key={f.id}
              type="button"
              role="tab"
              aria-selected={filter === f.id}
              onClick={() => setFilter(f.id)}
              className={`min-h-10 flex-shrink-0 rounded-full border px-3.5 text-[12.5px] font-bold ${filter === f.id ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"}`}
            >
              {f.label} <span className="opacity-70">{countFor(f)}</span>
            </button>
          ))}
        </div>
        <input
          type="search"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          placeholder="Buscar tienda"
          aria-label="Buscar tienda"
          className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none focus:border-tertiary-accent sm:w-64"
        />
      </div>

      <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-3 rounded-t-2xl bg-surface-container-low px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-outline md:grid">
          <span>Tienda</span>
          <span>Provincia</span>
          <span>Estado</span>
          <span>Pago</span>
          <span className="text-right">Acciones</span>
        </div>
        {isLoading && <ListSkeleton />}
        {!isLoading && subscriptions.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">Todavía no hay tiendas en el Plan Premium.</p>}
        {!isLoading && subscriptions.length > 0 && visible.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">Ninguna tienda con este filtro.</p>}
        {visible.map((s) => {
          const status = STATUS_META[s.status] ?? STATUS_META.pending_payment;
          const PaymentIcon = PAYMENT_METHOD_ICON[s.paymentMethod];
          return (
            <div key={s.vendorId} className="flex flex-col gap-2.5 border-t border-surface-container px-4 py-3.5 first:border-t-0 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-center md:gap-3 md:px-5 md:first:border-t">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white" style={{ background: s.color ?? "#232F3E" }} aria-hidden="true">
                  {s.companyName[0]}
                </span>
                <Link to={`/admin/tiendas/${s.vendorId}`} className="min-w-0 truncate text-[13.5px] font-semibold text-on-surface hover:underline">
                  {s.companyName}
                </Link>
              </div>
              <span className="text-[12.5px] text-on-surface-variant md:text-[13px]">{s.province ?? "Sin provincia"}</span>
              <div className="flex flex-col items-start gap-0.5">
                <span className="w-fit rounded-full px-2.5 py-1 text-[11.5px] font-bold" style={{ background: status.bg, color: status.color }}>
                  {status.label}
                </span>
                {s.status === "trial" && s.trialDaysLeft != null && (
                  <span className={`text-[11.5px] font-semibold ${s.trialDaysLeft <= 7 ? "text-error" : "text-on-surface-variant"}`}>
                    {s.trialDaysLeft === 1 ? "Queda 1 día" : `Quedan ${s.trialDaysLeft} días`}
                  </span>
                )}
              </div>
              <div className="text-[12px] text-on-surface-variant">
                {s.paymentMethod ? (
                  <div className="flex items-center gap-1.5">
                    <PaymentIcon className="h-3.5 w-3.5 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />
                    <span>{PAYMENT_METHOD_LABEL[s.paymentMethod]}</span>
                  </div>
                ) : (
                  <span className="text-outline">{s.status === "trial" ? "Todavía no elige cómo pagar" : "Sin elegir todavía"}</span>
                )}
                {s.paymentConfirmedAt && <div className="mt-0.5 text-[11px] text-outline">Confirmado {fmtDate(s.paymentConfirmedAt)}</div>}
                {!s.paymentConfirmedAt && s.paymentMethod === "CARD" && (
                  <div className="mt-0.5 flex items-center gap-1 text-[11px] text-outline">
                    <Clock className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
                    {s.stripeCheckoutExpired ? "Link vencido" : "Esperando pago en Stripe"}
                  </div>
                )}
                {s.status === "active" && s.nextPaymentDueDate && <div className="mt-0.5 text-[11px] text-outline">Próximo vencimiento: {fmtDate(s.nextPaymentDueDate)}</div>}
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Link to={`/admin/tiendas/${s.vendorId}`} className="flex min-h-10 items-center rounded-lg bg-surface-container px-3 text-[12.5px] font-semibold text-on-surface">
                  Gestionar
                </Link>
                {["active", "trial", "payment_failed", "suspended"].includes(s.status) && (
                  <button
                    type="button"
                    onClick={() => setConfirmRevoke(s)}
                    disabled={revoke.isPending && revoking === s.vendorId}
                    className="flex min-h-10 items-center gap-1 rounded-lg border border-error px-3 text-[12.5px] font-semibold text-error disabled:opacity-50"
                  >
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
        title={`¿Revocar el Plan Premium de "${confirmRevoke?.companyName}"?`}
        message="Vuelve al Básico, pierde el badge verificado y las funciones Premium — se le avisa por correo con el motivo que escribas."
        confirmLabel={revoke.isPending ? "Revocando..." : "Sí, revocar"}
        danger
        confirmDisabled={revokeReason.trim().length < 5 || revoke.isPending}
        onConfirm={() => {
          setRevoking(confirmRevoke.vendorId);
          revoke.mutate({ vendorId: confirmRevoke.vendorId, reason: revokeReason.trim() });
        }}
        onCancel={() => {
          setConfirmRevoke(null);
          setRevokeReason("");
          setNotifyVendor(false);
        }}
      >
        <textarea
          value={revokeReason}
          onChange={(e) => setRevokeReason(e.target.value)}
          placeholder="Motivo de la revocación (obligatorio)..."
          rows={3}
          className="w-full rounded-lg border border-outline-variant bg-surface-container-lowest p-3 text-[13px] outline-none focus:border-tertiary-accent"
        />
        <NotifyVendorCheckbox checked={notifyVendor} onChange={setNotifyVendor} />
      </ConfirmModal>
    </div>
  );
}

export default function AdminSubscriptions() {
  return (
    <div>
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={CreditCard} tone="teal" />
        <h1 className="font-display text-[26px] font-extrabold tracking-tight text-on-surface">Suscripciones</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">
        Las suscripciones de las tiendas. Lo que incluye cada plan y los datos de pago se cambian en Configuración.
      </p>

      <SubscriptionsTab />
    </div>
  );
}
