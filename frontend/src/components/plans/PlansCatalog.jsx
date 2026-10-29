import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { BadgeCheck, Check, MessageCircle, Minus } from "lucide-react";
import { api } from "../../lib/api.js";

// Los planes de las tiendas tal como los configura el admin (GET /settings/plans): tarjetas con precio, descuento por meses
// y lo que incluye cada plan (o lo que agrega sobre el anterior, si de verdad lo trae todo), y debajo la comparación
// completa, armada con el catálogo de funciones que manda el servidor. Aquí no hay ninguna lista fija de planes ni de
// funciones: un plan o una función nueva del admin aparece sola. Lo usan la página pública /planes y el panel del vendedor.
// Se vuelve a pedir al abrir la página, así un cambio del admin se ve al momento.
//
// `cta(plan)` decide el botón de cada tarjeta (crear tienda, elegir plan, plan actual...). `currentPlanType` marca el plan
// de la tienda que está mirando.

const MONTH_CHOICES = [1, 3, 6, 12];
// Grupo de la comparación donde va la fila de la insignia (el mismo nombre que usa el catálogo de funciones).
const BADGE_GROUP = "Visibilidad";
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

// Una función del catálogo cuenta como incluida si está encendida y, si es un tope, no vale 0 (un tope en 0 es "nada").
function isOn(feature) {
  return !!feature && feature.enabled && !(feature.kind === "limit" && feature.limit === 0);
}

// Filas de la comparación, armadas con el catálogo que manda el servidor en cada plan (`features`, ver planFeatureList en
// backend/src/lib/planFeatures.js). Antes eran dos listas fijas aquí y una función nueva del admin no salía en la tabla.
//  - Un interruptor con tope propio (usuarios, mesas, códigos, ofertas, correos) trae `pairedLimit`: no tiene fila; la fila
//    es la de su tope, con el nombre del interruptor ("Usuarios del equipo" se entiende mejor que "Tope de usuarios").
//  - Una fila que ningún plan incluye no se muestra: sería una línea entera de rayas.
//  - Se agrupan por `group` (Ventas, Equipo...) en el orden en que aparece cada grupo en el catálogo.
function comparisonGroups(plans) {
  const rows = new Map();
  const flagOfLimit = new Map();
  for (const plan of plans) {
    for (const f of plan.features ?? []) {
      if (f.pairedLimit) {
        if (!flagOfLimit.has(f.pairedLimit)) flagOfLimit.set(f.pairedLimit, f);
      } else if (!rows.has(f.key)) {
        rows.set(f.key, { key: f.key, label: f.label, group: f.group || "Otras", requiresBadge: !!f.requiresBadge });
      }
    }
  }
  const groups = new Map();
  for (const row of rows.values()) {
    const flag = flagOfLimit.get(row.key);
    if (flag) {
      row.label = flag.label;
      // Las ofertas de tienda exigen insignia por su interruptor, no por su tope.
      row.requiresBadge = row.requiresBadge || !!flag.requiresBadge;
    }
    // Una función que exige insignia solo cuenta en planes con insignia (ver la celda más abajo).
    if (!plans.some((p) => isOn(p.features?.find((f) => f.key === row.key)) && (!row.requiresBadge || p.grantsBadge))) continue;
    if (!groups.has(row.group)) groups.set(row.group, []);
    groups.get(row.group).push(row);
  }
  return [...groups.entries()].map(([name, groupRows]) => ({ name, rows: groupRows }));
}

// ¿Este plan trae de verdad todo lo del anterior? Solo entonces la tarjeta puede decir "Todo lo de X, más:" y listar lo
// nuevo; si no, lista todo lo que incluye. Se compara función por función (un tope cuenta si es igual o mayor, o sin tope)
// y, para los beneficios escritos a mano por el admin, que la misma línea también esté en este plan.
export function includesAllOf(plan, prev) {
  if (prev.grantsBadge && !plan.grantsBadge) return false;
  const mine = new Map((plan.features ?? []).map((f) => [f.key, f]));
  for (const pf of prev.features ?? []) {
    if (!isOn(pf)) continue;
    const f = mine.get(pf.key);
    if (!isOn(f)) return false;
    if (pf.kind === "limit" && f.limit != null && (pf.limit == null || f.limit < pf.limit)) return false;
  }
  const fromCatalog = new Set((prev.features ?? []).map((f) => f.publicText).filter(Boolean));
  const mineLines = new Set(plan.includes ?? []);
  return (prev.includes ?? []).every((line) => fromCatalog.has(line) || mineLines.has(line));
}

// Celda de la comparación para una fila: los topes muestran su texto público ("Hasta 50 productos publicados"); los
// interruptores y las personalizadas, una marca. Un tope sin texto público dice "Sin tope" solo si de verdad no tiene
// límite; con número y sin texto (el admin puede dejar vacío el texto público) se muestra el número, nunca "Sin tope".
function cellFor(plan, row) {
  const f = plan.features?.find((x) => x.key === row.key);
  if (!isOn(f)) return { included: false };
  if (f.kind !== "limit") return { included: true, text: null };
  return { included: true, text: f.publicText ?? (f.limit == null ? "Sin tope" : `Hasta ${Number(f.limit).toLocaleString("es-CU")}`) };
}

// Plan al que se puede subir pagando la verificación: cobrado, ni el de inicio, ni a medida, y con insignia (la
// verificación solo cobra planes con insignia: VendorVerification.jsx y verification.controller.js rechazan los demás).
export const isBadgeUpgrade = (p) => !!p && p.grantsBadge && !p.isDefault && !p.isFree && !p.contactOnly;

// El plan que se sugiere para subir: el elegido (`preferredKey`) si se puede pagar con la verificación; si no, el de la
// prueba gratis, el destacado o el primero, en ese orden. Una sola función para el registro (Account.jsx) y la comparación
// de bienvenida, así las dos pantallas sugieren siempre el mismo plan. null si no hay ninguno.
export function suggestedUpgradePlan(plans, preferredKey = null) {
  const options = (plans ?? []).filter(isBadgeUpgrade);
  return (
    (preferredKey ? options.find((p) => p.planType === preferredKey) : null) ??
    options.find((p) => p.isTrialPlan) ??
    options.find((p) => p.highlighted) ??
    options[0] ??
    null
  );
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

function PriceBlock({ plan, months, currency, dark, supportWhatsapp }) {
  const muted = dark ? "text-white/75" : "text-on-surface-variant";
  if (plan.contactOnly) {
    // El precio se habla con el equipo: por WhatsApp si el admin cargó el número (el botón abre ese chat); si no, por el
    // formulario de contacto, así que no se promete WhatsApp.
    const byWhatsapp = !!enterpriseWhatsappLink(supportWhatsapp, plan.name);
    return (
      <div>
        <p className="text-[26px] font-extrabold leading-tight">{byWhatsapp ? "Por WhatsApp" : "A tu medida"}</p>
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
  const monthChoices = useMemo(() => [...new Set([...MONTH_CHOICES, ...plans.flatMap((p) => (p.monthDiscounts ?? []).map((d) => d.months))])].sort((a, b) => a - b).filter((m) => m <= 24), [plans]);
  const groups = useMemo(() => comparisonGroups(plans), [plans]);

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

      {/* La cantidad de planes la decide el admin: la rejilla se ajusta a 1, 2, 3 o más tarjetas sin dejar huecos. */}
      <div className={`grid items-stretch gap-4 ${plans.length === 1 ? "mx-auto max-w-md" : plans.length === 2 ? "mx-auto max-w-3xl sm:grid-cols-2" : plans.length === 3 ? "sm:grid-cols-2 lg:grid-cols-3" : "sm:grid-cols-2 xl:grid-cols-4"}`}>
        {plans.map((plan, i) => {
          const prev = plans[i - 1];
          const lines = plan.includes ?? [];
          // "Todo lo de X, más:" solo si de verdad lo trae todo (ver includesAllOf); si no, la lista completa.
          const buildsOnPrev = !!prev && includesAllOf(plan, prev);
          const added = buildsOnPrev ? lines.filter((line) => !(prev.includes ?? []).includes(line)) : lines;
          const dark = plan.highlighted;
          const current = currentPlanType === plan.planType;
          return (
            <article
              key={plan.planType}
              className={`relative flex flex-col rounded-3xl p-5 ${dark ? "bg-primary text-white shadow-[0_24px_48px_-20px_rgba(14,26,40,0.6)] xl:-my-2 xl:py-7" : "border border-surface-container-high bg-surface-container-lowest text-on-surface"} ${current ? "ring-2 ring-tertiary-accent" : ""}`}
            >
              {/* "Destacado" lo marca el admin a mano: no es un dato de ventas, por eso no dice "el más elegido". */}
              {dark && <span className="absolute -top-3 left-5 rounded-full bg-secondary-container px-3 py-1 text-[11.5px] font-extrabold text-on-secondary-container">Recomendado</span>}
              {current && <span className={`absolute -top-3 ${dark ? "right-5" : "left-5"} rounded-full bg-tertiary-accent px-3 py-1 text-[11.5px] font-extrabold text-white`}>Tu plan</span>}
              <h3 className="flex items-center gap-1.5 font-display text-[20px] font-extrabold">
                {plan.name}
                {plan.grantsBadge && <BadgeCheck className={`h-5 w-5 ${dark ? "text-secondary-container" : "text-verified"}`} aria-label="Incluye la insignia de verificada" />}
              </h3>
              {plan.tagline && <p className={`mt-0.5 text-[13px] ${dark ? "text-white/80" : "text-on-surface-variant"}`}>{plan.tagline}</p>}
              <div className="mt-4">
                <PriceBlock plan={plan} months={months} currency={currency} dark={dark} supportWhatsapp={data.supportWhatsapp} />
              </div>
              <div className="mt-4">{cta?.(plan, { dark, current, months, currency, supportWhatsapp: data.supportWhatsapp })}</div>
              <div className={`mt-5 border-t pt-4 ${dark ? "border-white/15" : "border-surface-container-high"}`}>
                <p className={`mb-2 text-[12px] font-bold uppercase tracking-wide ${dark ? "text-white/70" : "text-outline"}`}>{buildsOnPrev ? `Todo lo de ${prev.name}, más:` : "Incluye:"}</p>
                <ul className="space-y-2">
                  {(compact ? added.slice(0, 6) : added).map((line) => (
                    <li key={line} className="flex items-start gap-2 text-[13.5px] leading-[19px]">
                      <Check className={`mt-0.5 h-4 w-4 flex-shrink-0 ${dark ? "text-secondary-container" : "text-verified-dark"}`} aria-hidden="true" /> {line}
                    </li>
                  ))}
                  {added.length === 0 && buildsOnPrev && <li className={`text-[13px] ${dark ? "text-white/75" : "text-on-surface-variant"}`}>Las mismas funciones que {prev.name}.</li>}
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
          {/* La caja recibe foco para poder desplazar la tabla con las flechas del teclado cuando no cabe (390 px). */}
          <div tabIndex={0} role="region" aria-label="Comparación de planes" className="relative overflow-x-auto rounded-2xl border border-surface-container-high bg-surface-container-lowest focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-tertiary-accent">
            {/* Ancho mínimo según la cantidad de planes: con más columnas la tabla se desplaza dentro de su caja y la
                página nunca se desborda (390 px). */}
            <table className="w-full text-[13.5px]" style={{ minWidth: 200 + plans.length * 150 }}>
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
              {/* Cada grupo es su propio <tbody> con un encabezado scope="rowgroup": así los lectores de pantalla asocian el
                  nombre del grupo con sus filas. La fila de la insignia va al final del grupo "Visibilidad" (o en uno
                  propio con ese nombre si el catálogo no lo trae), nunca suelta dentro del último grupo pintado. */}
              {[...groups, ...(groups.some((g) => g.name === BADGE_GROUP) ? [] : [{ name: BADGE_GROUP, rows: [] }])].map((group) => (
                <tbody key={group.name} className="divide-y divide-surface-container">
                  <tr className="bg-surface-container/50">
                    {/* El nombre del grupo va en un span pegajoso: la celda ocupa todo el ancho y no podría quedarse quieta. */}
                    <th scope="rowgroup" colSpan={plans.length + 1} className="py-2 text-left">
                      <span className="sticky left-0 inline-block px-4 text-[12.5px] font-bold text-on-surface-variant">{group.name}</span>
                    </th>
                  </tr>
                  {group.rows.map((row) => (
                    <tr key={row.key}>
                      <th scope="row" className="sticky left-0 bg-surface-container-lowest px-4 py-2.5 text-left font-semibold text-on-surface">{row.label}</th>
                      {plans.map((p) => {
                        const cell = cellFor(p, row);
                        // El servidor solo activa estas funciones en tiendas verificadas, y la verificación solo se paga en
                        // un plan con insignia: en un plan sin ella la función no se puede usar nunca, así que no cuenta.
                        const needsBadge = cell.included && row.requiresBadge && !p.grantsBadge;
                        return (
                          <td key={p.planType} className="px-3 py-2.5 text-center text-on-surface">
                            {!cell.included || needsBadge ? <No /> : cell.text ? cell.text : <Yes label={row.label} />}
                            {needsBadge && <span className="mt-0.5 block text-[11.5px] text-on-surface-variant">Requiere un plan con insignia</span>}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                  {group.name === BADGE_GROUP && (
                    <tr>
                      <th scope="row" className="sticky left-0 bg-surface-container-lowest px-4 py-2.5 text-left font-semibold text-on-surface">Insignia de tienda verificada</th>
                      {plans.map((p) => (
                        <td key={p.planType} className="px-3 py-2.5 text-center">{p.grantsBadge ? <Yes label="Insignia de tienda verificada" /> : <No />}</td>
                      ))}
                    </tr>
                  )}
                </tbody>
              ))}
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
  return `https://wa.me/${digits}?text=${encodeURIComponent(`Hola, quiero información del plan ${planName} para mi negocio.`)}`;
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
