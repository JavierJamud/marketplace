import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Check, MessageCircle, Minus } from "lucide-react";
import { api } from "../../lib/api.js";

// Los planes de las tiendas tal como los configura el admin (GET /settings/plans): tarjetas con precio, descuento por meses
// y lo que agrega cada plan sobre el anterior, y debajo la comparación completa. Lo usan la página pública /planes y el
// panel del vendedor. Se vuelve a pedir al abrir la página, así un cambio del admin se ve al momento.
//
// `cta(plan)` decide el botón de cada tarjeta (crear tienda, elegir plan, plan actual...). `currentPlanType` marca el plan
// de la tienda que está mirando.

const MONTH_CHOICES = [1, 3, 6, 12];
const fmt = (n, currency) => `${Number(n).toLocaleString("es-CU", { maximumFractionDigits: currency === "USD" ? 2 : 0, minimumFractionDigits: currency === "USD" && n % 1 ? 2 : 0 })} ${currency}`;

function discountFor(plan, months, currency) {
  const key = currency === "USD" ? "usd" : "cup";
  return [...(plan.monthDiscounts ?? [])].reverse().find((d) => months >= d.months)?.[key] ?? 0;
}

// Mismo cálculo que planPrice en backend/src/lib/planConfig.js (el servidor es el que cobra).
export function planPrice(plan, months, currency) {
  const monthly = currency === "USD" ? plan.priceUsd : plan.priceCup;
  const pct = discountFor(plan, months, currency);
  const gross = monthly * months;
  const raw = gross * (1 - pct / 100);
  const total = currency === "USD" ? Math.round(raw * 100) / 100 : Math.round(raw);
  return { monthly, pct, gross, total, perMonth: currency === "USD" ? Math.round((total / months) * 100) / 100 : Math.round(total / months) };
}

export function usePublicPlans() {
  return useQuery({
    queryKey: ["public-plans"],
    queryFn: async () => (await api.get("/settings/plans")).data,
    staleTime: 0,
    refetchOnWindowFocus: true,
  });
}

// Filas de la comparación: primero los límites, después las funciones.
const LIMIT_ROWS = [
  ["maxProducts", "Productos publicados"],
  ["maxProvinces", "Provincias donde vendes"],
  ["maxDeliveryCountries", "Países de envío"],
  ["maxStaffUsers", "Usuarios del sistema"],
  ["maxTables", "Mesas con menú QR"],
  ["maxDiscountCodes", "Códigos de descuento"],
  ["maxActiveStoreOffers", "Ofertas de tienda a la vez"],
  ["maxMonthlyOrderEmails", "Correos a clientes por mes"],
];
const FLAG_ROWS = [
  ["allowWhatsappOrders", "Pedidos también por WhatsApp"],
  ["allowPos", "Caja con código de barras"],
  ["allowAiChatbot", "Chat con IA en tu tienda"],
  ["allowLoyalty", "Programa de puntos para clientes"],
  ["allowSchedules", "Horario de atención"],
  ["allowReviewPhotos", "Reseñas con fotos"],
  ["allowAdminChat", "Chat con el equipo de Baznova"],
  ["featuredInHome", "Destacada en la portada"],
];

function limitText(v) {
  if (v === null || v === undefined) return "Ilimitado";
  if (v === 0) return null;
  return Number(v).toLocaleString("es-CU");
}

function Yes({ label }) {
  return (
    <span className="inline-flex items-center justify-center">
      <Check className="h-4 w-4 text-verified-dark" aria-hidden="true" />
      <span className="sr-only">{label ?? "Incluido"}</span>
    </span>
  );
}
function No() {
  return (
    <span className="inline-flex items-center justify-center">
      <Minus className="h-4 w-4 text-outline" aria-hidden="true" />
      <span className="sr-only">No incluido</span>
    </span>
  );
}

function PriceBlock({ plan, months, currency, dark }) {
  const muted = dark ? "text-white/75" : "text-on-surface-variant";
  if (plan.contactOnly) {
    return (
      <div>
        <p className="text-[26px] font-extrabold leading-tight">A tu medida</p>
        <p className={`text-[12.5px] ${muted}`}>Precio según el volumen de tu negocio.</p>
      </div>
    );
  }
  if (plan.isFree) {
    const list = currency === "USD" ? plan.listPriceUsd : plan.listPriceCup;
    return (
      <div>
        <p className="flex items-baseline gap-2">
          <span className="text-[30px] font-extrabold leading-tight">Gratis</span>
          {list > 0 && <span className={`text-[14px] font-semibold line-through ${muted}`}>{fmt(list, currency)}/mes</span>}
        </p>
        <p className={`text-[12.5px] ${muted}`}>Por ahora no se cobra. Te avisaremos con tiempo si eso cambia.</p>
      </div>
    );
  }
  const p = planPrice(plan, months, currency);
  return (
    <div>
      <p className="flex flex-wrap items-baseline gap-x-2">
        <span className="text-[30px] font-extrabold leading-tight">{fmt(p.perMonth, currency)}</span>
        <span className={`text-[13px] font-semibold ${muted}`}>al mes</span>
        {p.pct > 0 && <span className={`text-[13px] font-semibold line-through ${muted}`}>{fmt(p.monthly, currency)}</span>}
      </p>
      <p className={`text-[12.5px] ${muted}`}>
        {months === 1 ? "Pago mensual." : `Pagas ${fmt(p.total, currency)} por ${months} meses${p.pct > 0 ? `: ahorras ${fmt(p.gross - p.total, currency)} (−${p.pct} %)` : ""}.`}
      </p>
    </div>
  );
}

export function PlansCatalog({ cta, currentPlanType, compact = false }) {
  const { data, isLoading, isError, refetch } = usePublicPlans();
  const [currency, setCurrency] = useState("CUP");
  const [months, setMonths] = useState(1);
  const plans = data?.plans ?? [];
  const maxDiscount = useMemo(() => Math.max(0, ...plans.flatMap((p) => (p.monthDiscounts ?? []).map((d) => (currency === "USD" ? d.usd : d.cup)))), [plans, currency]);
  const monthChoices = useMemo(() => [...new Set([...MONTH_CHOICES, ...plans.flatMap((p) => (p.monthDiscounts ?? []).map((d) => d.months))])].sort((a, b) => a - b).filter((m) => m <= 12), [plans]);

  if (isLoading) {
    return (
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4" aria-busy="true">
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-[420px] animate-pulse rounded-3xl bg-surface-container" />
        ))}
      </div>
    );
  }
  if (isError) {
    return (
      <div className="rounded-2xl border border-surface-container-high p-6 text-center">
        <p className="text-body-md text-error">No se pudieron cargar los planes.</p>
        <button type="button" onClick={() => refetch()} className="mt-2 min-h-11 rounded-xl px-4 font-bold text-tertiary-accent underline">Reintentar</button>
      </div>
    );
  }
  if (!plans.length) return <p className="text-body-md text-on-surface-variant">Todavía no hay planes publicados.</p>;

  return (
    <div>
      <div className="mb-6 flex flex-col items-center gap-3 sm:flex-row sm:justify-center">
        <div role="radiogroup" aria-label="Moneda" className="inline-flex rounded-full bg-surface-container p-1">
          {[
            ["CUP", "CUP · transferencia"],
            ["USD", "USD · tarjeta"],
          ].map(([c, label]) => (
            <button key={c} type="button" role="radio" aria-checked={currency === c} onClick={() => setCurrency(c)} className={`min-h-10 rounded-full px-4 text-[13px] font-bold transition-colors ${currency === c ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"}`}>
              {label}
            </button>
          ))}
        </div>
        <div role="radiogroup" aria-label="Meses a pagar" className="inline-flex flex-wrap justify-center rounded-full bg-surface-container p-1">
          {monthChoices.map((m) => (
            <button key={m} type="button" role="radio" aria-checked={months === m} onClick={() => setMonths(m)} className={`min-h-10 rounded-full px-3.5 text-[13px] font-bold transition-colors ${months === m ? "bg-primary text-on-primary" : "text-on-surface-variant hover:text-on-surface"}`}>
              {m === 1 ? "1 mes" : `${m} meses`}
            </button>
          ))}
        </div>
        {maxDiscount > 0 && <span className="rounded-full bg-secondary-container/25 px-3 py-1.5 text-[12.5px] font-bold text-secondary">Hasta −{maxDiscount} % pagando varios meses</span>}
      </div>

      <div className={`grid items-stretch gap-4 sm:grid-cols-2 ${plans.length >= 4 ? "xl:grid-cols-4" : "lg:grid-cols-3"}`}>
        {plans.map((plan, i) => {
          const prev = plans[i - 1];
          const added = prev ? plan.includes.filter((line) => !prev.includes.includes(line)) : plan.includes;
          const dark = plan.highlighted;
          const current = currentPlanType === plan.planType;
          return (
            <article
              key={plan.planType}
              className={`relative flex flex-col rounded-3xl p-5 ${dark ? "bg-primary text-white shadow-[0_24px_48px_-20px_rgba(14,26,40,0.6)] xl:-my-2 xl:py-7" : "border border-surface-container-high bg-surface-container-lowest text-on-surface"} ${current ? "ring-2 ring-tertiary-accent" : ""}`}
            >
              {dark && <span className="absolute -top-3 left-5 rounded-full bg-secondary-container px-3 py-1 text-[11.5px] font-extrabold text-on-secondary-container">El más elegido</span>}
              {current && <span className={`absolute -top-3 ${dark ? "right-5" : "left-5"} rounded-full bg-tertiary-accent px-3 py-1 text-[11.5px] font-extrabold text-white`}>Tu plan</span>}
              <h3 className="flex items-center gap-1.5 font-display text-[20px] font-extrabold">
                {plan.name}
                {plan.grantsBadge && <BadgeCheck className={`h-5 w-5 ${dark ? "text-secondary-container" : "text-verified"}`} aria-label="Incluye la insignia de verificada" />}
              </h3>
              {plan.tagline && <p className={`mt-0.5 text-[13px] ${dark ? "text-white/80" : "text-on-surface-variant"}`}>{plan.tagline}</p>}
              <div className="mt-4">
                <PriceBlock plan={plan} months={months} currency={currency} dark={dark} />
              </div>
              <div className="mt-4">{cta?.(plan, { dark, current, months, currency, supportWhatsapp: data.supportWhatsapp })}</div>
              <div className={`mt-5 border-t pt-4 ${dark ? "border-white/15" : "border-surface-container-high"}`}>
                <p className={`mb-2 text-[12px] font-bold uppercase tracking-wide ${dark ? "text-white/70" : "text-outline"}`}>{prev ? `Todo lo de ${prev.name}, más:` : "Incluye:"}</p>
                <ul className="space-y-2">
                  {(compact ? added.slice(0, 6) : added).map((line) => (
                    <li key={line} className="flex items-start gap-2 text-[13.5px] leading-[19px]">
                      <Check className={`mt-0.5 h-4 w-4 flex-shrink-0 ${dark ? "text-secondary-container" : "text-verified-dark"}`} aria-hidden="true" /> {line}
                    </li>
                  ))}
                  {added.length === 0 && <li className={`text-[13px] ${dark ? "text-white/75" : "text-on-surface-variant"}`}>Más volumen en todo.</li>}
                </ul>
              </div>
            </article>
          );
        })}
      </div>

      {!compact && (
        <section className="mt-12">
          <h2 className="mb-1 text-center font-display text-[24px] font-extrabold text-on-surface">Compara los planes</h2>
          <p className="mb-5 text-center text-[13.5px] text-on-surface-variant">Todo lo que incluye cada uno, lado a lado.</p>
          <div className="overflow-x-auto rounded-2xl border border-surface-container-high bg-surface-container-lowest">
            <table className="w-full min-w-[640px] text-[13.5px]">
              <caption className="sr-only">Comparación de planes</caption>
              <thead>
                <tr className="border-b border-surface-container-high bg-surface-container/50">
                  <th scope="col" className="sticky left-0 bg-surface-container px-4 py-3 text-left text-[12px] font-bold uppercase tracking-wide text-outline">Función</th>
                  {plans.map((p) => (
                    <th key={p.planType} scope="col" className={`px-3 py-3 text-center text-[14px] font-extrabold ${p.highlighted ? "text-secondary" : "text-on-surface"}`}>
                      {p.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-surface-container">
                {LIMIT_ROWS.map(([key, label]) => (
                  <tr key={key}>
                    <th scope="row" className="sticky left-0 bg-surface-container-lowest px-4 py-2.5 text-left font-semibold text-on-surface">{label}</th>
                    {plans.map((p) => {
                      const t = limitText(p.limits[key]);
                      return <td key={p.planType} className="px-3 py-2.5 text-center text-on-surface">{t ?? <No />}</td>;
                    })}
                  </tr>
                ))}
                {FLAG_ROWS.map(([key, label]) => (
                  <tr key={key}>
                    <th scope="row" className="sticky left-0 bg-surface-container-lowest px-4 py-2.5 text-left font-semibold text-on-surface">{label}</th>
                    {plans.map((p) => (
                      <td key={p.planType} className="px-3 py-2.5 text-center">{p.flags[key] ? <Yes label={label} /> : <No />}</td>
                    ))}
                  </tr>
                ))}
                <tr>
                  <th scope="row" className="sticky left-0 bg-surface-container-lowest px-4 py-2.5 text-left font-semibold text-on-surface">Insignia de tienda verificada</th>
                  {plans.map((p) => (
                    <td key={p.planType} className="px-3 py-2.5 text-center">{p.grantsBadge ? <Yes label="Insignia de tienda verificada" /> : <No />}</td>
                  ))}
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

// Enlace de WhatsApp para pedir el plan Empresarial, con el mensaje escrito.
export function enterpriseWhatsappLink(supportWhatsapp, planName) {
  const digits = String(supportWhatsapp ?? "").replace(/\D/g, "");
  if (!digits) return null;
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Hola, quiero información del plan ${planName} de Baznova para mi negocio.`)}`;
}

export function EnterpriseCta({ plan, supportWhatsapp, dark }) {
  const href = enterpriseWhatsappLink(supportWhatsapp, plan.name);
  const cls = `flex min-h-12 w-full items-center justify-center gap-2 rounded-2xl px-4 text-[14px] font-extrabold ${dark ? "bg-white text-primary" : "border border-outline text-on-surface hover:bg-surface-container"}`;
  if (!href) return <Link to="/contacto" className={cls}>Escríbenos</Link>;
  return (
    <a href={href} target="_blank" rel="noreferrer" className={cls}>
      <MessageCircle className="h-4 w-4" aria-hidden="true" /> Hablar por WhatsApp
    </a>
  );
}
