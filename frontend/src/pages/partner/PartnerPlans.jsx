import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Wallet, Store } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { CARD, IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ListSkeleton } from "../../components/ui/Skeleton.jsx";

const fmt = (n) => Number(n ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 2 });
const FIELD = "min-h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface focus:border-tertiary-accent focus:outline-none focus:ring-2 focus:ring-tertiary-accent/30";

// Bloque 300: el socio ve los planes de Baznova con su precio base y fija su precio final. Nunca puede
// quedar por debajo del base: lo que pone por encima es su ganancia por cada tienda en ese plan.
//
// Qué papel tiene cada plan (el de registro, gratis, a medida) lo dicen sus banderas, que llegan en `info` desde
// GET /settings; nunca su clave. Antes "REGULAR" era el gratis aunque el admin cambiara el plan por defecto.
function PlanCard({ plan, info }) {
  const qc = useQueryClient();
  const { user } = useAuth();
  const [cup, setCup] = useState(String(plan.finalMonthly.cup));
  const [usd, setUsd] = useState(String(plan.finalMonthly.usd));
  useEffect(() => {
    setCup(String(plan.finalMonthly.cup));
    setUsd(String(plan.finalMonthly.usd));
  }, [plan.finalMonthly.cup, plan.finalMonthly.usd]);

  const cupNum = Number(cup);
  const usdNum = Number(usd);
  const belowBase = cupNum < plan.baseMonthly.cup || usdNum < plan.baseMonthly.usd;
  const invalid = !Number.isFinite(cupNum) || !Number.isFinite(usdNum) || cup === "" || usd === "";
  const extraCup = Math.max(0, cupNum - plan.baseMonthly.cup) || 0;
  const extraUsd = Math.max(0, usdNum - plan.baseMonthly.usd) || 0;
  const dirty = cupNum !== plan.finalMonthly.cup || usdNum !== plan.finalMonthly.usd;

  const save = useMutation({
    mutationFn: async () => (await api.put(`/partner-portal/plans/${plan.planType}`, { finalCup: cupNum, finalUsd: usdNum })).data,
    onSuccess: () => {
      toast.success("Precio guardado.");
      qc.invalidateQueries({ queryKey: ["partner-portal-plans", user?.id] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el precio."),
  });

  const isDefault = info?.isDefault ?? plan.isDefault ?? false;
  const contactOnly = info?.contactOnly ?? plan.contactOnly ?? false;
  // Sin datos de /settings (falló o aún carga) se deduce del precio base: el servidor manda 0 en un plan gratis.
  const free = info?.isFree ?? plan.isFree ?? (!contactOnly && plan.baseMonthly.cup === 0 && plan.baseMonthly.usd === 0);
  const role = isDefault ? "El plan que reciben las tiendas al crearse" : contactOnly ? "Plan a medida: Baznova acuerda el precio con cada tienda" : free ? "Plan gratis de Baznova por ahora" : "Plan de pago de Baznova";
  const basePrice = free ? "Gratis" : contactOnly ? "A medida" : `${fmt(plan.baseMonthly.cup)} CUP · ${fmt(plan.baseMonthly.usd)} USD`;
  // En un plan a medida el servidor manda base 0 (el precio lo acuerda Baznova con cada tienda), así que el "precio final"
  // es solo el extra del socio: se muestra como "A medida + extra", nunca "Gratis", y los campos piden el extra.
  const hasExtra = plan.extraMonthly?.cup > 0 || plan.extraMonthly?.usd > 0;
  const finalPrice = contactOnly
    ? hasExtra
      ? `A medida + ${fmt(plan.extraMonthly.cup)} CUP · ${fmt(plan.extraMonthly.usd)} USD`
      : "A medida"
    : plan.finalMonthly.cup === 0 && plan.finalMonthly.usd === 0
      ? "Gratis"
      : `${fmt(plan.finalMonthly.cup)} CUP · ${fmt(plan.finalMonthly.usd)} USD`;
  const fieldLabel = (currency, min) => (contactOnly ? `Tu extra al mes en ${currency}, sobre el precio acordado` : `Tu precio final en ${currency} (mínimo ${fmt(min)})`);
  return (
    <section className={`${CARD} p-5`}>
      <div className="mb-3 flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-display text-[19px] font-extrabold text-on-surface">{plan.name}</h2>
          <p className="text-[12px] text-outline">{role}</p>
        </div>
        <span className="flex items-center gap-1.5 rounded-full bg-surface-container px-3 py-1 text-[12px] font-semibold text-on-surface-variant">
          <Store className="h-3.5 w-3.5" aria-hidden="true" /> {plan.stores} {plan.stores === 1 ? "tienda tuya" : "tiendas tuyas"}
        </span>
      </div>

      {plan.features.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-1.5">
          {plan.features.slice(0, 6).map((f) => (
            <li key={f} className="rounded-full bg-surface-container px-2.5 py-0.5 text-[11.5px] font-semibold text-on-surface-variant">{f}</li>
          ))}
        </ul>
      )}

      <dl className="mb-4 grid grid-cols-2 gap-3 text-[13px]">
        <div>
          <dt className="text-[11.5px] text-on-surface-variant">Precio de Baznova al mes</dt>
          <dd className="font-semibold text-on-surface">{basePrice}</dd>
        </div>
        <div>
          <dt className="text-[11.5px] text-on-surface-variant">Tu precio hoy</dt>
          <dd className="font-semibold text-on-surface">{finalPrice}</dd>
        </div>
      </dl>

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-on-surface-variant">{fieldLabel("CUP", plan.baseMonthly.cup)}</span>
          <input type="number" inputMode="decimal" min={plan.baseMonthly.cup} step="0.01" className={FIELD} value={cup} onChange={(e) => setCup(e.target.value)} />
        </label>
        <label className="block">
          <span className="mb-1 block text-[12px] font-semibold text-on-surface-variant">{fieldLabel("USD", plan.baseMonthly.usd)}</span>
          <input type="number" inputMode="decimal" min={plan.baseMonthly.usd} step="0.01" className={FIELD} value={usd} onChange={(e) => setUsd(e.target.value)} />
        </label>
      </div>
      {belowBase && !invalid && (
        <p role="alert" className="mt-2 text-[12.5px] font-semibold text-error">No puedes cobrar menos que el precio de Baznova. Sube el precio o déjalo igual al mínimo.</p>
      )}

      <div className="mt-4 rounded-xl bg-surface-container p-3.5">
        <p className="text-[11.5px] font-bold uppercase tracking-wide text-outline">Tu ganancia</p>
        <div className="mt-1.5 grid grid-cols-1 gap-2 text-[13px] sm:grid-cols-2">
          <p className="text-on-surface-variant">Por cada tienda, al mes: <b className="text-on-surface">{fmt(extraCup)} CUP · {fmt(extraUsd)} USD</b></p>
          <p className="text-on-surface-variant">Con tus {plan.stores} {plan.stores === 1 ? "tienda" : "tiendas"} hoy: <b className="text-on-surface">{fmt(extraCup * plan.stores)} CUP · {fmt(extraUsd * plan.stores)} USD</b> al mes</p>
        </div>
      </div>

      <Button className="mt-4" disabled={!dirty || belowBase || invalid || save.isPending} onClick={() => save.mutate()}>
        {save.isPending ? "Guardando..." : "Guardar precio"}
      </Button>
    </section>
  );
}

export default function PartnerPlans() {
  const { user } = useAuth();
  const { data, isLoading, isError } = useQuery({
    queryKey: ["partner-portal-plans", user?.id],
    queryFn: async () => (await api.get("/partner-portal/plans")).data,
  });
  // Banderas de cada plan (isDefault, isFree, contactOnly), de la misma consulta que usa el resto del sitio.
  const { data: settings } = useQuery({
    queryKey: ["site-settings"],
    queryFn: async () => (await api.get("/settings")).data.settings,
  });
  const infoByKey = new Map((settings?.plans ?? []).map((p) => [p.planType, p]));

  return (
    <div className="max-w-[980px]">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Wallet} tone="teal" />
        <h1 className="font-display text-[22px] font-extrabold leading-tight tracking-tight text-on-surface sm:text-[26px]">Planes y ganancias</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">
        Estos son los planes actuales de Baznova. Puedes sumarle un extra al precio de cada uno, nunca restarlo. Lo que sumas es tu ganancia por cada tienda que tenga ese plan. Tus precios finales también salen en tu API, en <code>GET /plans</code>.
      </p>

      {isLoading && <ListSkeleton />}
      {isError && <div className={`${CARD} p-6 text-[13.5px] text-error`}>No se pudieron cargar los planes. Intenta de nuevo en un momento.</div>}
      {data && data.plans.length === 0 && <div className={`${CARD} p-6 text-[13.5px] text-outline`}>Todavía no hay planes configurados en Baznova.</div>}

      <div className="space-y-4">{data?.plans.map((p) => <PlanCard key={p.planType} plan={p} info={infoByKey.get(p.planType)} />)}</div>

      <p className="mt-5 text-[12px] text-outline">
        La ganancia mostrada es una estimación con las tiendas que hoy llegaron por tu enlace. El cobro del extra a cada tienda lo define Baznova contigo.
      </p>
    </div>
  );
}
