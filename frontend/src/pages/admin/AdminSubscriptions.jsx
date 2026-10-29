import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { CreditCard, Landmark, Clock, BadgeCheck, HandCoins, Gift } from "lucide-react";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Select } from "../../components/ui/Select.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";
import { NotifyVendorCheckbox } from "../../components/admin/NotifyVendorCheckbox.jsx";
import { notifyVendorConfig } from "../../lib/notifyVendor.js";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";
import { PlansSection } from "../../components/admin/plans/PlansSection.jsx";

const PAYMENT_METHOD_ICON = { CARD: CreditCard, CUP_TRANSFER: Landmark, MANUAL: HandCoins };
const PAYMENT_METHOD_LABEL = { CARD: "Tarjeta (Stripe)", CUP_TRANSFER: "Transferencia CUP", MANUAL: "Registrado por el equipo" };

// Bloque 64: status ya viene calculado 1:1 desde Vendor.verificationStatus
// (ver listSubscriptions en admin.controller.js) — se agregan los 2 estados
// nuevos del cobro recurrente. Más los del cobro de planes sin insignia
// (planBilling.service.js): billing_overdue y billing_suspended. Sin ellos esas
// tiendas salían como "Pago pendiente".
const STATUS_META = {
  active: { label: "Activa", bg: "rgba(12,174,83,0.12)", color: "#087A38" },
  // Prueba gratis: el plan de prueba completo sin pagar todavía.
  trial: { label: "Prueba gratis", bg: "rgba(51,116,117,0.12)", color: "#245a5b" },
  pending_payment: { label: "Pago pendiente", bg: "rgba(254,152,0,0.15)", color: "#8A5100" },
  billing_overdue: { label: "Cobro atrasado", bg: "rgba(254,152,0,0.15)", color: "#8A5100" },
  billing_suspended: { label: "Suspendida por falta de pago", bg: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
  rejected: { label: "Rechazada", bg: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
  payment_failed: { label: "Pago fallido", bg: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
  suspended: { label: "Suspendida", bg: "rgba(186,26,26,0.12)", color: "#ba1a1a" },
};

// Estados en los que la tienda tiene un plan que se le puede quitar ("Revocar"). El servidor además rechaza las que ya
// están en el plan por defecto (revokeBusinessPlan), así que esas tampoco muestran el botón.
const REVOCABLE = ["active", "trial", "payment_failed", "suspended", "billing_overdue", "billing_suspended"];

function fmtUsd(n) {
  return `US$ ${Number(n).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;
}

function fmtCup(n) {
  return `${Math.round(Number(n) || 0).toLocaleString("es-CU")} CUP`;
}

// Duraciones de "Activar un plan a mano": de 1 a 24 meses (grantPlanSchema del servidor) o sin vencimiento.
const GRANT_MONTHS = Array.from({ length: 24 }, (_, i) => i + 1);

function fmtDate(iso) {
  return new Date(iso).toLocaleDateString("es-CU", { day: "2-digit", month: "short", year: "numeric" });
}

// Planes de /settings (los no archivados, también los ocultos) y sus papeles por bandera: nunca por clave fija, porque el
// admin puede crear planes y mover el plan por defecto o el de prueba a otro. Mismo queryKey ["site-settings"] que el
// resto del sitio: una sola copia en caché.
function usePlanRoles() {
  const { data: settings, isError } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
    staleTime: 5 * 60 * 1000,
  });
  const plans = settings?.plans ?? [];
  const defaultPlan = plans.find((p) => p.isDefault) ?? null;
  const trialPlan = plans.find((p) => p.isTrialPlan) ?? null;
  const nameOf = (key) => plans.find((p) => p.planType === key)?.displayName ?? key;
  // settingsError solo si no hay copia: con datos en caché un fallo al refrescar no cambia lo que se muestra. Sin esto,
  // los selectores que esperan a /settings se quedaban en "Cargando..." para siempre cuando la petición fallaba.
  return { loaded: !!settings, settingsError: isError && !settings, plans, defaultPlan, trialPlan, nameOf };
}

// Sección de planes de Configuración > Planes y pagos. Antes aquí vivía una tarjeta por plan con listas fijas de límites
// e interruptores (PLAN_LIMIT_FIELDS / PLAN_TOGGLE_FIELDS) contra PATCH /admin/plan-configs. Ahora los planes se crean,
// configuran y archivan desde components/admin/plans (rejilla + ventana Configurar), con el catálogo de funciones del
// servidor. Se conserva el nombre PlanConfigTab porque AdminSettings.jsx lo importa así.
export function PlanConfigTab() {
  return <PlansSection />;
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
    unpaidSuspendDays: 30,
  });

  useEffect(() => {
    if (!settings) return;
    setForm({
      cupBankAccountNumber: settings.cupBankAccountNumber ?? "",
      cupBankAccountHolder: settings.cupBankAccountHolder ?? "",
      cupBankInstructions: settings.cupBankInstructions ?? "",
      cupBankPhone: settings.cupBankPhone ?? "",
      unpaidSuspendDays: settings.unpaidSuspendDays ?? 30,
    });
  }, [settings]);

  // Los precios de cada plan se editan en la sección Planes (arriba) y la prueba gratis en su propia tarjeta.
  const unpaidDays = Number(form.unpaidSuspendDays);
  const unpaidDaysError = form.unpaidSuspendDays === "" || !Number.isInteger(unpaidDays) || unpaidDays < 1 || unpaidDays > 365 ? "Escribe un número de días entre 1 y 365." : null;

  const save = useMutation({
    mutationFn: async () =>
      (await api.patch("/admin/settings/cup-payment", { ...form, unpaidSuspendDays: unpaidDays })).data,
    onSuccess: () => {
      toast.success("Datos de pago de la suscripción actualizados.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar."),
  });

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
      <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
        <Landmark className="h-5 w-5 text-tertiary-accent" /> Datos de pago de la suscripción
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        Los precios de cada plan y sus descuentos por meses están arriba, en Planes. Aquí van los datos de
        transferencia CUP que el vendedor copia al pagar (si están vacíos, le pedimos que contacte al equipo) y cuántos días
        sin pagar pasan antes de suspender una tienda.
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
      <Button className="rounded-xl font-bold" disabled={save.isPending || !!unpaidDaysError} onClick={() => save.mutate()}>
        {save.isPending ? "Guardando..." : "Guardar cambios"}
      </Button>
    </div>
  );
}

// Prueba gratis que se ofrece a las tiendas nuevas: qué plan y cuántos días. Antes los días estaban mezclados con los datos
// bancarios y el plan se elegía dentro de la ventana de un plan. La fecha de fin se fija a cada tienda al empezar su prueba
// (trialEligibility.service.js), así que cambiar esto solo afecta a las pruebas que empiecen después.
// Solo pueden ser plan de prueba los de pago que no son el plan por defecto (el servidor rechaza los gratis y los "por WhatsApp").
export function TrialSettingsCard() {
  const queryClient = useQueryClient();
  const { loaded, settingsError, plans, trialPlan } = usePlanRoles();
  const { data: settings } = useQuery({ queryKey: ["site-settings"], queryFn: async () => (await api.get("/settings")).data.settings });
  const eligible = plans.filter((p) => !p.isDefault && !p.isFree && !p.contactOnly);
  const [planKey, setPlanKey] = useState("");
  const [days, setDays] = useState("");
  useEffect(() => {
    if (trialPlan) setPlanKey(trialPlan.planType);
  }, [trialPlan]);
  useEffect(() => {
    if (settings) setDays(String(settings.trialDays ?? 30));
  }, [settings]);

  const n = Number(days);
  const daysError = days === "" || !Number.isInteger(n) || n < 1 || n > 365 ? "Escribe un número de días entre 1 y 365." : null;
  const planChanged = !!planKey && planKey !== trialPlan?.planType;
  const daysChanged = !!settings && n !== (settings.trialDays ?? 30);

  const save = useMutation({
    mutationFn: async () => {
      // El plan va primero: si el servidor lo rechaza (o se cancela el código de acción) no se cambian los días a medias.
      if (planChanged) await api.patch(`/admin/plans/${encodeURIComponent(planKey)}`, { isTrialPlan: true });
      if (daysChanged) await api.patch("/admin/settings/cup-payment", { trialDays: n });
    },
    onSuccess: () => {
      toast.success("Prueba gratis actualizada. Vale para las tiendas que empiecen su prueba desde ahora.");
      queryClient.invalidateQueries({ queryKey: ["site-settings"] });
      queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
    },
    onError: (err) => {
      if (err.actionCodeCancelled) return;
      toast.error(err.response?.data?.error ?? "No se pudo guardar.");
    },
  });

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-5 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] sm:p-6">
      <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
        <Gift className="h-5 w-5 text-tertiary-accent" aria-hidden="true" /> Prueba gratis para tiendas nuevas
      </div>
      <p className="mb-4 text-[12.5px] leading-relaxed text-outline">
        El plan y los días que se ofrecen a cada tienda nueva. Las tiendas que ya están en su prueba conservan su fecha de fin.
      </p>
      {settingsError ? (
        <p role="alert" className="text-[13px] text-error">No se pudieron cargar los planes. Recarga la página.</p>
      ) : !loaded ? (
        <p className="text-[13px] text-outline">Cargando...</p>
      ) : eligible.length === 0 ? (
        <p className="text-[13px] text-on-surface-variant">No hay ningún plan de pago que se pueda ofrecer como prueba. Crea uno en Planes.</p>
      ) : (
        <>
          <div className="mb-4 grid grid-cols-1 gap-3.5 sm:grid-cols-2">
            <Select label="Plan que se prueba" value={planKey} onChange={(e) => setPlanKey(e.target.value)}>
              {eligible.map((p) => (
                <option key={p.planType} value={p.planType}>
                  {p.displayName}
                  {p.isPublic ? "" : " (oculto)"}
                </option>
              ))}
            </Select>
            <Input label="Días gratis" inputMode="numeric" value={days} error={daysError} onChange={(e) => setDays(e.target.value.replace(/\D/g, ""))} />
          </div>
          <Button className="rounded-xl font-bold" disabled={save.isPending || !!daysError || (!planChanged && !daysChanged)} onClick={() => save.mutate()}>
            {save.isPending ? "Guardando..." : "Guardar prueba gratis"}
          </Button>
        </>
      )}
    </div>
  );
}

// Bloque 52 (pedido explícito: "también podemos activar la suscripción
// manualmente... se debe justificar y poner el motivo"): la tabla de abajo
// solo lista tiendas que ya están en un plan de pago (ver listSubscriptions,
// admin.controller.js). Una tienda del plan por defecto nunca aparece ahí, así
// que esto vive aparte, con su propio selector de tienda.
function GrantBusinessCard() {
  const queryClient = useQueryClient();
  // Bloque 243: GET /admin/vendors ahora pagina — en vez de bajar todas las
  // tiendas y filtrar acá, se busca en el servidor (plan = clave del plan por defecto)
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
  const { loaded, settingsError, plans, defaultPlan, trialPlan, nameOf } = usePlanRoles();
  const defaultKey = defaultPlan?.planType;
  const { data: vendors, isLoading: vendorsLoading, isError: vendorsError } = useQuery({
    queryKey: ["admin-vendor-pick", defaultKey, debouncedSearch],
    queryFn: async () =>
      (await api.get("/admin/vendors", { params: { plan: defaultKey, q: debouncedSearch || undefined, pageSize: 20, sort: "name", dir: "asc" } })).data.vendors,
    enabled: !!defaultKey,
  });
  const regularVendors = vendors ?? [];
  const vendorOptions =
    selectedVendor && !regularVendors.some((v) => v.id === selectedVendor.id) ? [selectedVendor, ...regularVendors] : regularVendors;

  // Plan a activar: cualquiera menos el por defecto (los que se contratan por WhatsApp solo se activan así). La lista sale
  // de /settings: un plan creado en Planes aparece aquí sin tocar código. Los ocultos también, marcados, para acuerdos
  // que no se publican. Si no se eligió nada, se propone el plan de prueba.
  // Fuera los que el servidor rechaza (grantBusinessPlan): un plan sin insignia que tampoco se cobra no vencería nunca.
  const grantable = plans.filter((p) => !p.isDefault && (p.grantsBadge || (!p.isFree && !p.contactOnly)));
  const [grantChoice, setGrantChoice] = useState("");
  const grantPlan = grantable.some((p) => p.planType === grantChoice)
    ? grantChoice
    : ((grantable.find((p) => p.planType === trialPlan?.planType) ?? grantable[0])?.planType ?? "");
  const grantConfig = grantable.find((p) => p.planType === grantPlan) ?? null;
  // Duración: "1".."24" (meses) o "none" (sin vencimiento, solo en planes con insignia). Un plan por WhatsApp obliga a
  // elegirla (el servidor responde 400 sin ella); en los demás se propone 1 mes, lo de siempre.
  const [durationChoice, setDurationChoice] = useState("");
  const mustChooseDuration = !!grantConfig?.contactOnly;
  const durationValid = durationChoice !== "" && (durationChoice !== "none" || !!grantConfig?.grantsBadge);
  const duration = durationValid ? durationChoice : mustChooseDuration ? "" : "1";
  const grant = useMutation({
    mutationFn: async () => {
      const body = { reason: reason.trim(), planType: grantPlan, ...(duration === "none" ? { noExpiry: true } : { months: Number(duration) }) };
      return (await api.post(`/admin/vendors/${vendorId}/grant-business`, body, notifyVendorConfig(notifyVendor))).data;
    },
    onSuccess: (data) => {
      const name = data?.planName ?? nameOf(grantPlan);
      toast.success(
        data?.noExpiry
          ? `Plan ${name} activado a mano, sin vencimiento.`
          : data?.periodEnd
            ? `Plan ${name} activado a mano hasta el ${fmtDate(data.periodEnd)}.`
            : `Plan ${name} activado a mano.`
      );
      setNotifyVendor(false);
      setVendorId("");
      setSelectedVendor(null);
      setReason("");
      setDurationChoice("");
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
      queryClient.invalidateQueries({ queryKey: ["admin-vendor-pick"] });
      queryClient.invalidateQueries({ queryKey: ["admin-plans"] });
      queryClient.invalidateQueries({ queryKey: ["admin-plan-stats"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo activar el plan."),
  });

  return (
    <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] p-6">
      <div className="mb-1 flex items-center gap-2 text-[17px] font-bold leading-snug text-on-surface sm:text-title-lg">
        <BadgeCheck className="h-5 w-5 text-tertiary-accent" aria-hidden="true" /> Activar un plan a mano
      </div>
      <p className="mb-4 text-[12.5px] text-outline">
        Para casos excepcionales o para los planes que se contratan por WhatsApp: activa el plan que elijas (y la insignia de
        verificada si el plan la da) sin pasar por los documentos ni el pago. Queda registrado con el motivo que escribas,
        visible en su historial.
      </p>
      <div className="mb-3 grid grid-cols-1 gap-3 sm:grid-cols-[1.4fr_2fr]">
        <div className="flex flex-col gap-2">
          <Input label={defaultPlan ? `Buscar tienda (plan ${defaultPlan.displayName})` : "Buscar tienda"} value={vendorSearch} onChange={(e) => setVendorSearch(e.target.value)} placeholder="Nombre de la tienda" />
          <Select
            aria-label="Tienda a la que activar el plan"
            value={vendorId}
            onChange={(e) => {
              setVendorId(e.target.value);
              setSelectedVendor(vendorOptions.find((v) => v.id === e.target.value) ?? null);
            }}
          >
            {/* Mientras carga o si falla, no decir "Ninguna tienda coincide": no sería verdad. La lista espera al plan por
                defecto de /settings (enabled: !!defaultKey): si /settings falla o no trae plan por defecto, la consulta no
                sale nunca y "Cargando tiendas..." sería falso. */}
            <option value="">
              {vendorOptions.length
                ? "Elige una tienda..."
                : vendorsError || settingsError
                  ? "No se pudieron cargar las tiendas"
                  : !loaded || vendorsLoading
                    ? "Cargando tiendas..."
                    : !defaultKey
                      ? "No hay plan por defecto"
                      : "Ninguna tienda coincide"}
            </option>
            {vendorOptions.map((v) => (
              <option key={v.id} value={v.id}>
                {v.companyName}
              </option>
            ))}
          </Select>
        </div>
        <div className="flex flex-col gap-2">
        <Select aria-label="Plan a activar" value={grantPlan} disabled={!grantable.length} onChange={(e) => setGrantChoice(e.target.value)}>
          {!grantable.length && <option value="">{settingsError ? "No se pudieron cargar los planes" : loaded ? "No hay planes para activar" : "Cargando planes..."}</option>}
          {grantable.map((p) => (
            <option key={p.planType} value={p.planType}>
              Plan {p.displayName}
              {p.isPublic === false ? " (oculto)" : ""}
            </option>
          ))}
        </Select>
        <Select aria-label="Cuánto dura" value={duration} disabled={!grantConfig} onChange={(e) => setDurationChoice(e.target.value)}>
          {mustChooseDuration && <option value="">Elige cuánto dura...</option>}
          {GRANT_MONTHS.map((m) => (
            <option key={m} value={String(m)}>
              {m === 1 ? "1 mes" : `${m} meses`}
            </option>
          ))}
          {grantConfig?.grantsBadge && <option value="none">Sin vencimiento</option>}
        </Select>
        {grantConfig && (
          <p className="text-[12px] text-on-surface-variant">
            {grantConfig.grantsBadge
              ? `${mustChooseDuration ? "Se contrata por WhatsApp: elige cuánto dura. " : ""}Sin vencimiento: la tienda conserva el plan hasta que se lo quites.`
              : "Este plan no da la insignia: sus funciones duran mientras tenga tiempo pagado."}
          </p>
        )}
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
          disabled={!vendorId || !grantPlan || !duration || reason.trim().length < 5 || grant.isPending}
          onClick={() => grant.mutate()}
        >
          {grant.isPending ? "Activando..." : grantPlan ? `Activar plan ${nameOf(grantPlan)}` : "Activar plan"}
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
  const { defaultPlan, trialPlan } = usePlanRoles();
  const defaultName = defaultPlan?.displayName ?? "el plan por defecto";
  const trialName = trialPlan?.displayName ?? "el plan de prueba";

  // isError: si la lista fallaba se veía "Todavía no hay tiendas en un plan de pago", como si no hubiera ninguna.
  const { data, isLoading, isError, isFetching, refetch } = useQuery({
    queryKey: ["admin-subscriptions"],
    queryFn: async () => (await api.get("/admin/subscriptions")).data,
  });
  const loadFailed = isError && !data;

  const revoke = useMutation({
    mutationFn: async ({ vendorId, reason }) => (await api.post(`/admin/vendors/${vendorId}/revoke-business`, { reason }, notifyVendorConfig(notifyVendor))).data,
    onSuccess: () => {
      toast.success(`Plan revocado: la tienda pasó a ${defaultName}.`);
      queryClient.invalidateQueries({ queryKey: ["admin-subscriptions"] });
      queryClient.invalidateQueries({ queryKey: ["admin-list-vendors"] });
      queryClient.invalidateQueries({ queryKey: ["admin-vendor-pick"] });
      setRevoking(null);
      setConfirmRevoke(null);
      setRevokeReason("");
      setNotifyVendor(false);
    },
    onError: (err) => {
      toast.error(err.response?.data?.error ?? "No se pudo revocar el plan.");
      setRevoking(null);
    },
  });

  const subscriptions = data?.subscriptions ?? [];
  const [filter, setFilter] = useState("all");
  const [search, setSearch] = useState("");
  // Filtro por plan, guardado en la URL (?plan=CLAVE) para poder llegar filtrado desde la tarjeta de un plan. Las opciones
  // salen de los planes que de verdad tienen tiendas en la lista (también uno archivado que aún tenga alguna).
  const [params, setParams] = useSearchParams();
  const planFilter = params.get("plan") ?? "";
  const setPlanFilter = (key) => {
    const next = new URLSearchParams(params);
    if (key) next.set("plan", key);
    else next.delete("plan");
    setParams(next, { replace: true });
  };
  const planOptions = useMemo(() => {
    const byKey = new Map();
    for (const s of subscriptions) {
      const row = byKey.get(s.planType) ?? { key: s.planType, name: s.planName ?? s.planType, count: 0 };
      row.count += 1;
      byKey.set(s.planType, row);
    }
    return [...byKey.values()].sort((a, b) => a.name.localeCompare(b.name, "es"));
  }, [subscriptions]);
  // Filtros por estado: "Con problemas" junta pago fallido y suspendida, que piden la misma acción (revisar el cobro).
  const FILTERS = [
    { id: "all", label: "Todas", match: () => true },
    { id: "active", label: "Pagando", match: (s) => s.status === "active" },
    { id: "trial", label: "Prueba gratis", match: (s) => s.status === "trial" },
    { id: "pending_payment", label: "Pago pendiente", match: (s) => s.status === "pending_payment" },
    { id: "problems", label: "Con problemas", match: (s) => ["payment_failed", "suspended", "rejected", "billing_overdue", "billing_suspended"].includes(s.status) },
  ];
  const visible = useMemo(() => {
    const f = FILTERS.find((x) => x.id === filter) ?? FILTERS[0];
    const q = search.trim().toLowerCase();
    return subscriptions.filter((s) => f.match(s) && (!planFilter || s.planType === planFilter) && (!q || s.companyName.toLowerCase().includes(q)));
  }, [subscriptions, filter, search, planFilter]); // eslint-disable-line react-hooks/exhaustive-deps
  const metrics = data
    ? [
        { label: "Pagando", value: String(data.metrics.active) },
        { label: "Prueba gratis", value: String(data.metrics.trial ?? 0), delta: `${trialName} completo, no suma al ingreso mensual` },
        { label: "Pago pendiente", value: String(data.metrics.pendingPayment) },
        {
          label: "Problemas de cobro",
          value: String((data.metrics.paymentFailed ?? 0) + (data.metrics.suspended ?? 0) + (data.metrics.billingOverdue ?? 0) + (data.metrics.billingSuspended ?? 0)),
          delta: "Pago fallido, cobro atrasado o suspendidas",
        },
        // Ingreso mensual real por moneda (computeSubscriptionMetrics): cada una aparte, nunca se convierte CUP a USD.
        { label: "Ingreso mensual en CUP", value: fmtCup(data.metrics.mrrByCurrency?.CUP ?? 0), delta: "Solo tiendas que pagan" },
        { label: "Ingreso mensual en USD", value: fmtUsd(data.metrics.mrrByCurrency?.USD ?? data.metrics.mrrUsd ?? 0), delta: "Solo tiendas que pagan" },
      ]
    : [];
  // Los conteos de los filtros de estado respetan el plan elegido: "Pagando 3" es de ese plan, no de todos.
  const countFor = (f) => subscriptions.filter((s) => f.match(s) && (!planFilter || s.planType === planFilter)).length;

  return (
    <div>
      <div className="mb-6 rounded-[10px] bg-tertiary-accent/[0.08] px-3.5 py-2.5 text-[12px] text-tertiary-accent">
        El cobro es recurrente: Stripe cobra cada mes solo (factura fallida = "Pago fallido", suscripción cancelada = "Suspendida"); CUP se
        renueva a mano cada ciclo, con recordatorio automático 7 días antes de vencer. Las tiendas en "Prueba gratis" tienen todas las funciones
        de {trialName}, reciben aviso 7, 3 y 1 día antes de que termine la prueba y al terminar pasan solas a {defaultName}, sin insignia y con sus límites.
      </div>

      <div className="mb-6">
        <GrantBusinessCard />
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 sm:gap-[18px] lg:grid-cols-3 2xl:grid-cols-6">
        {metrics.map((m) => (
          <div key={m.label} className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest p-4 shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)] sm:p-5">
            <div className="mb-2 text-[12.5px] text-outline">{m.label}</div>
            <div className="break-words font-display text-2xl font-extrabold text-on-surface">{m.value}</div>
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
              className={`min-h-11 flex-shrink-0 rounded-full border px-3.5 text-[12.5px] font-bold ${filter === f.id ? "border-primary bg-primary text-on-primary" : "border-outline-variant text-on-surface-variant hover:bg-surface-container"}`}
            >
              {/* Sin datos (cargando o con error) no hay conteo que dar: "Todas 0" junto al aviso de error sería falso. */}
              {f.label} {data && <span className="opacity-70">{countFor(f)}</span>}
            </button>
          ))}
        </div>
        <div className="flex w-full flex-col gap-2 sm:w-auto sm:flex-row">
          <select
            value={planFilter}
            onChange={(e) => setPlanFilter(e.target.value)}
            aria-label="Filtrar por plan"
            className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none focus:border-tertiary-accent sm:w-52"
          >
            <option value="">Todos los planes</option>
            {planOptions.map((p) => (
              <option key={p.key} value={p.key}>
                {p.name} ({p.count})
              </option>
            ))}
          </select>
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar tienda"
            aria-label="Buscar tienda"
            className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none focus:border-tertiary-accent sm:w-56"
          />
        </div>
      </div>

      <div className="rounded-2xl border border-surface-container-high/70 bg-surface-container-lowest shadow-[0_1px_2px_rgba(15,23,42,0.04),0_12px_28px_-10px_rgba(15,23,42,0.12)]">
        <div className="hidden grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] gap-3 rounded-t-2xl bg-surface-container-low px-5 py-3 text-[11.5px] font-bold uppercase tracking-wide text-outline md:grid">
          <span>Tienda</span>
          <span>Plan</span>
          <span>Estado</span>
          <span>Pago</span>
          <span className="text-right">Acciones</span>
        </div>
        {isLoading && <ListSkeleton />}
        {loadFailed && (
          <div className="flex flex-col items-center gap-3 p-6 text-center">
            <p className="text-body-md text-error">No se pudieron cargar las suscripciones.</p>
            <Button variant="outline" disabled={isFetching} onClick={() => refetch()}>
              {isFetching ? "Reintentando..." : "Reintentar"}
            </Button>
          </div>
        )}
        {!isLoading && !loadFailed && subscriptions.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">Todavía no hay tiendas en un plan de pago.</p>}
        {!isLoading && !loadFailed && subscriptions.length > 0 && visible.length === 0 && <p className="p-5 text-body-md text-on-surface-variant">Ninguna tienda con este filtro.</p>}
        {visible.map((s) => {
          const status = STATUS_META[s.status] ?? STATUS_META.pending_payment;
          const PaymentIcon = PAYMENT_METHOD_ICON[s.paymentMethod];
          return (
            <div key={s.vendorId} className="flex flex-col gap-2.5 border-t border-surface-container px-4 py-3.5 first:border-t-0 md:grid md:grid-cols-[minmax(0,2fr)_minmax(0,1.1fr)_minmax(0,1fr)_minmax(0,1.5fr)_auto] md:items-center md:gap-3 md:px-5 md:first:border-t">
              <div className="flex min-w-0 items-center gap-2.5">
                <span className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full font-display text-sm font-bold text-white" style={{ background: s.color ?? "#232F3E" }} aria-hidden="true">
                  {s.companyName[0]}
                </span>
                <div className="min-w-0">
                  <Link to={`/admin/tiendas/${s.vendorId}`} className="block truncate text-[13.5px] font-semibold text-on-surface hover:underline">
                    {s.companyName}
                  </Link>
                  <span className="block truncate text-[11.5px] text-on-surface-variant">{s.province ?? "Sin provincia"}</span>
                </div>
              </div>
              <div>
                <button
                  type="button"
                  onClick={() => setPlanFilter(planFilter === s.planType ? "" : s.planType)}
                  title={planFilter === s.planType ? "Quitar el filtro de plan" : `Ver solo ${s.planName ?? s.planType}`}
                  className="inline-flex min-h-8 max-w-full items-center rounded-full bg-tertiary-accent/10 px-2.5 text-[12px] font-bold text-tertiary-accent hover:bg-tertiary-accent/20"
                >
                  <span className="truncate">{s.planName ?? s.planType}</span>
                </button>
              </div>
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
                {s.noExpiry && <div className="mt-0.5 text-[11px] text-outline">Activado a mano, sin vencimiento</div>}
                {s.status === "billing_overdue" && s.nextPaymentDueDate && <div className="mt-0.5 text-[11px] text-outline">Venció el {fmtDate(s.nextPaymentDueDate)}</div>}
                {s.status === "billing_suspended" && s.billingSuspendedAt && <div className="mt-0.5 text-[11px] text-outline">Suspendida el {fmtDate(s.billingSuspendedAt)}</div>}
              </div>
              <div className="flex flex-wrap gap-2 md:justify-end">
                <Link to={`/admin/tiendas/${s.vendorId}`} className="flex min-h-11 items-center rounded-lg bg-surface-container px-3 text-[12.5px] font-semibold text-on-surface">
                  Gestionar
                </Link>
                {REVOCABLE.includes(s.status) && (!defaultPlan || s.planType !== defaultPlan.planType) && (
                  <button
                    type="button"
                    onClick={() => setConfirmRevoke(s)}
                    disabled={revoke.isPending && revoking === s.vendorId}
                    className="flex min-h-11 items-center gap-1 rounded-lg border border-error px-3 text-[12.5px] font-semibold text-error disabled:opacity-50"
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
        title={`¿Revocar el plan de "${confirmRevoke?.companyName}"?`}
        message={`Vuelve a ${defaultName}, pierde la insignia de verificada y las funciones de su plan. Se le avisa por correo con el motivo que escribas.`}
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
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Suscripciones</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">
        Las suscripciones de las tiendas. Lo que incluye cada plan y los datos de pago se cambian en Configuración.
      </p>

      <SubscriptionsTab />
    </div>
  );
}
