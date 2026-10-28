import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, ChevronDown, Gift, Lightbulb, Plus, ShieldCheck, Trash2, X } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { SearchBox } from "../../components/ui/SearchBox.jsx";
import ToggleSwitch from "../../components/admin/ToggleSwitch.jsx";
import { canWriteSection } from "../../lib/vendorSections.js";
import { cardColor, costLevel, earnRuleText, fmtAmount, fmtPercent, fmtPoints, pointsForAmount, pointsValue, programCost, TX_LABEL, valueRuleText } from "../../lib/loyalty.js";
import { ListSkeleton, PanelSkeleton } from "../../components/ui/Skeleton.jsx";

// Programa de fidelidad de la tienda. La tienda decide cuántos puntos da, cuánto valen y cuánto se puede pagar con ellos.
// Los clientes con cuenta ganan los puntos cuando el pedido se marca Entregado y los usan en el checkout de esta tienda.
// La página está pensada para que nadie lo configure a ciegas: cada paso dice qué hace y con un ejemplo, y a la derecha se
// ve en todo momento cuánto le cuesta el programa a la tienda (el servidor no deja guardar uno que le haga perder dinero).
const inputCls =
  "h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface outline-none focus:border-tertiary-accent disabled:opacity-60";
const inlineInput = "h-11 w-24 rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-center text-[15px] font-bold text-on-surface outline-none focus:border-tertiary-accent disabled:opacity-60";
// Espera a que la persona deje de escribir antes de buscar en el servidor.
function useDebounced(value, delay = 300) {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), delay);
    return () => clearTimeout(t);
  }, [value, delay]);
  return v;
}

const dateText = (d) => new Date(d).toLocaleString("es-CU", { dateStyle: "medium", timeStyle: "short" });

const toForm = (p) => ({
  enabled: p.enabled,
  earnPerAmount: String(p.earnPerAmount),
  earnPoints: String(p.earnPoints),
  valuePoints: String(p.valuePoints),
  valueAmount: String(p.valueAmount),
  valueOrder: p.valueOrder ?? "AMOUNT_FIRST",
  minRedeemPoints: String(p.minRedeemPoints),
  maxRedeemPercent: String(p.maxRedeemPercent),
  marginPercent: p.marginPercent != null ? String(p.marginPercent) : "",
  bonusTiers: (p.bonusTiers ?? []).map((t) => ({ minTotal: String(t.minTotal), bonusPoints: String(t.bonusPoints) })),
});

const num = (v) => (v === "" || v == null ? NaN : Number(String(v).replace(",", ".")));

function fromForm(f) {
  return {
    enabled: f.enabled,
    earnPerAmount: num(f.earnPerAmount),
    earnPoints: Math.trunc(num(f.earnPoints)),
    valuePoints: Math.trunc(num(f.valuePoints)),
    valueAmount: num(f.valueAmount),
    valueOrder: f.valueOrder,
    minRedeemPoints: Math.trunc(num(f.minRedeemPoints)),
    maxRedeemPercent: Math.trunc(num(f.maxRedeemPercent)),
    marginPercent: f.marginPercent === "" ? null : Math.trunc(num(f.marginPercent)),
    bonusTiers: f.bonusTiers.filter((t) => t.minTotal !== "" || t.bonusPoints !== "").map((t) => ({ minTotal: num(t.minTotal), bonusPoints: Math.trunc(num(t.bonusPoints)) })),
  };
}

function formError(p, limits) {
  if (!(p.earnPerAmount > 0)) return "Escribe cada cuánto dinero se gana un punto.";
  if (!(p.earnPoints >= 1)) return "Da al menos 1 punto.";
  if (!(p.valuePoints >= 1)) return "Escribe cuántos puntos (1 o más).";
  if (!(p.valueAmount > 0)) return "Escribe cuánto dinero equivalen esos puntos.";
  if (p.valueAmount / p.valuePoints < 0.0001) return "Cada punto tiene que valer al menos 0,0001.";
  if (!(p.minRedeemPoints >= 1)) return "El mínimo de puntos para usarlos tiene que ser 1 o más.";
  if (!(p.maxRedeemPercent >= 1 && p.maxRedeemPercent <= limits.maxRedeemPercent)) return `La parte del pedido que se paga con puntos va de 1 % a ${limits.maxRedeemPercent} %.`;
  if (p.marginPercent != null && !(p.marginPercent >= 1 && p.marginPercent <= 95)) return "Tu ganancia por venta va de 1 % a 95 %, o déjala en blanco.";
  if (p.bonusTiers.some((t) => !(t.minTotal > 0) || !(t.bonusPoints >= 1))) return "Completa o quita los bonos a medias.";
  const cost = programCost(p);
  if (cost.max > limits.maxRewardPercent) return `Así devuelves hasta el ${fmtPercent(cost.max)} de la compra. El máximo es ${fmtPercent(limits.maxRewardPercent)}: da menos puntos, baja el valor del punto o el bono.`;
  if (p.marginPercent && cost.max > p.marginPercent / 2) return `Con una ganancia del ${fmtPercent(p.marginPercent)} por venta, el programa no debería costarte más del ${fmtPercent(p.marginPercent / 2)}. Ahora te costaría hasta el ${fmtPercent(cost.max)}.`;
  return null;
}

// Valor del punto como un par que la tienda escribe en el orden que le resulte natural: "10 USD equivalen a 1 punto" o
// "1000 puntos equivalen a 10 USD".
const VALUE_ORDERS = [
  { key: "POINTS_FIRST", label: "Puntos por dinero" },
  { key: "AMOUNT_FIRST", label: "Dinero por puntos" },
];

function ValueEditor({ form, setForm, currency, parsed }) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const pointsInput = <input id="lp-vpoints" aria-label="Puntos" inputMode="numeric" value={form.valuePoints} onChange={set("valuePoints")} className={inlineInput} />;
  const amountInput = <input id="lp-vamount" aria-label={`Monto en ${currency}`} inputMode="decimal" value={form.valueAmount} onChange={set("valueAmount")} className={inlineInput} />;
  const each = parsed.valuePoints >= 1 && parsed.valueAmount > 0 ? parsed.valueAmount / parsed.valuePoints : null;
  const pointsFirst = form.valueOrder === "POINTS_FIRST";
  return (
    <div>
      <div role="radiogroup" aria-label="Cómo escribir el valor" className="mb-3 inline-flex gap-1 rounded-full bg-surface-container p-1">
        {VALUE_ORDERS.map((o) => (
          <button
            key={o.key}
            type="button"
            role="radio"
            aria-checked={form.valueOrder === o.key}
            onClick={() => setForm((f) => ({ ...f, valueOrder: o.key }))}
            className={`min-h-9 rounded-full px-3 text-[12.5px] font-bold transition-colors ${form.valueOrder === o.key ? "bg-tertiary-accent text-white" : "text-on-surface-variant hover:text-on-surface"}`}
          >
            {o.label}
          </button>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-2 text-[14.5px] text-on-surface">
        {pointsFirst ? pointsInput : amountInput}
        <span className="font-semibold">{pointsFirst ? "puntos descuentan" : `${currency} de descuento por`}</span>
        {pointsFirst ? amountInput : pointsInput}
        <span className="font-semibold">{pointsFirst ? currency : "puntos"}</span>
      </div>
      <p className="mt-2 text-[12.5px] text-on-surface-variant">
        {each ? (
          <>
            Cada punto vale <strong className="text-on-surface">{each.toLocaleString("es-CU", { maximumFractionDigits: 4 })} {currency}</strong> de descuento.
          </>
        ) : (
          "Escribe los dos números para ver cuánto vale cada punto."
        )}
      </p>
    </div>
  );
}

// Un paso numerado de la configuración: qué es, el control y un ejemplo o advertencia.
function Step({ n, title, optional, why, children }) {
  return (
    <section className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:p-5">
      <div className="mb-3 flex items-start gap-3">
        <span className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full bg-primary text-[13px] font-extrabold text-on-primary">{n}</span>
        <div className="min-w-0">
          <h2 className="text-[15px] font-bold text-on-surface">
            {title}
            {optional && <span className="ml-2 rounded-full bg-surface-container px-2 py-0.5 align-middle text-[11px] font-bold text-on-surface-variant">Opcional</span>}
          </h2>
          <p className="mt-0.5 text-[12.5px] leading-[18px] text-on-surface-variant">{why}</p>
        </div>
      </div>
      <div className="pl-0 sm:pl-11">{children}</div>
    </section>
  );
}

function Note({ children, tone = "neutral" }) {
  const tones = { neutral: "bg-surface-container/70 text-on-surface-variant", warn: "bg-secondary-container/20 text-on-surface", good: "bg-verified/10 text-on-surface" };
  return <p className={`mt-3 rounded-xl px-3 py-2 text-[12.5px] leading-[18px] ${tones[tone]}`}>{children}</p>;
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest px-3.5 py-3">
      <div className="text-[11.5px] font-semibold text-outline">{label}</div>
      <div className="mt-0.5 text-[20px] font-extrabold text-on-surface">{value}</div>
      {sub && <div className="text-[11.5px] text-on-surface-variant">{sub}</div>}
    </div>
  );
}

// Tarjeta con el aspecto que ve el cliente en la tienda: el color de la tienda, cómo se ganan y cuánto valen.
function CustomerPreview({ vendor, parsed, currency, valid }) {
  const color = cardColor(vendor?.color);
  return (
    <div className="relative overflow-hidden rounded-2xl p-4 text-white shadow-[0_12px_28px_-12px_rgba(14,26,40,0.5)]" style={{ background: color }}>
      <span className="pointer-events-none absolute -right-8 -top-10 h-32 w-32 rounded-full bg-white/10" aria-hidden="true" />
      <p className="text-[11px] font-bold uppercase tracking-wide text-white/80">Así lo ve tu cliente</p>
      <p className="mt-1 flex items-center gap-1.5 text-[16px] font-extrabold">
        <Award className="h-4 w-4" aria-hidden="true" /> {vendor?.companyName ?? "Tu tienda"} te da puntos
      </p>
      {valid ? (
        <ul className="mt-2 space-y-1 text-[13px] text-white/95">
          <li>Gana {earnRuleText(parsed, currency)}.</li>
          <li>Al usarlos, {valueRuleText(parsed, currency)}.</li>
          <li>Se usan desde {fmtPoints(parsed.minRedeemPoints)}, hasta el {parsed.maxRedeemPercent} % del pedido.</li>
        </ul>
      ) : (
        <p className="mt-2 text-[13px] text-white/90">Completa los pasos para ver cómo queda.</p>
      )}
    </div>
  );
}

// Medidor de cuánto le cuesta el programa a la tienda, con un ejemplo que la tienda puede cambiar.
function CostSummary({ parsed, valid, currency, limits, defaultAmount }) {
  const [amount, setAmount] = useState(String(defaultAmount));
  const cost = valid ? programCost(parsed) : null;
  const level = cost ? costLevel(cost.max, limits.maxRewardPercent) : null;
  const a = num(amount);
  const earned = valid && a > 0 ? pointsForAmount(parsed, a) : 0;
  const worth = valid ? pointsValue(parsed, earned) : 0;
  const ordersToUse = valid && earned > 0 ? Math.ceil(parsed.minRedeemPoints / earned) : null;
  return (
    <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
      <p className="text-[12.5px] font-bold text-on-surface-variant">Cuánto te cuesta</p>
      {cost ? (
        <>
          <p className="mt-1 flex items-baseline gap-2">
            <span className={`text-[30px] font-extrabold leading-none ${level.tone}`}>{fmtPercent(cost.max)}</span>
            <span className={`text-[12.5px] font-bold ${level.tone}`}>{level.label}</span>
          </p>
          <p className="mt-1 text-[12px] text-on-surface-variant">de cada compra vuelve al cliente como descuento{cost.tiers.length ? " (en el peor caso, con el bono)" : ""}.</p>
          <div className="mt-2 h-2 overflow-hidden rounded-full bg-surface-container" role="meter" aria-valuemin={0} aria-valuemax={limits.maxRewardPercent} aria-valuenow={Math.round(cost.max * 10) / 10} aria-label="Costo del programa">
            <div className={`h-full rounded-full ${level.bar}`} style={{ width: `${Math.min(100, (cost.max / limits.maxRewardPercent) * 100)}%` }} />
          </div>
          <p className="mt-1 flex justify-between text-[10.5px] text-outline">
            <span>0 %</span>
            <span>Tope {fmtPercent(limits.maxRewardPercent)}</span>
          </p>
          {cost.tiers.length > 0 && <p className="mt-2 text-[12px] text-on-surface-variant">Sin bono: {fmtPercent(cost.base)}.</p>}
        </>
      ) : (
        <p className="mt-1 text-[13px] text-on-surface-variant">Completa los pasos 1 y 2.</p>
      )}

      <div className="mt-4 border-t border-surface-container-high pt-3">
        <label htmlFor="lp-example" className="text-[12.5px] font-bold text-on-surface-variant">Prueba con un pedido de</label>
        <div className="mt-1 flex items-center gap-2">
          <input id="lp-example" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} className={`${inputCls} w-32`} />
          <span className="text-[13px] font-semibold text-on-surface">{currency}</span>
        </div>
        {valid && a > 0 && (
          <p className="mt-2 text-[13px] leading-[19px] text-on-surface">
            El cliente gana <strong>{fmtPoints(earned)}</strong>, que le descuentan <strong>{fmtAmount(worth, currency)}</strong> en una próxima compra.
            {ordersToUse ? ` Necesita ${ordersToUse === 1 ? "1 pedido así" : `${ordersToUse} pedidos así`} para poder usarlos.` : " Ese pedido es muy chico para dar puntos."}
          </p>
        )}
      </div>
    </div>
  );
}

function MemberModal({ member, currency, canWrite, onClose }) {
  const queryClient = useQueryClient();
  const [points, setPoints] = useState("");
  const [note, setNote] = useState("");
  const { data, isLoading, isError } = useQuery({
    queryKey: ["vendor-loyalty-history", member.userId],
    queryFn: async () => (await api.get(`/loyalty/store/members/${member.userId}/history`)).data.transactions,
  });
  const adjust = useMutation({
    mutationFn: async () => (await api.post("/loyalty/store/adjust", { userId: member.userId, points: Math.trunc(Number(points)), note: note.trim() })).data,
    onSuccess: ({ balance }) => {
      toast.success("Puntos ajustados", `Nuevo saldo: ${fmtPoints(balance)}.`);
      setPoints("");
      setNote("");
      queryClient.invalidateQueries({ queryKey: ["vendor-loyalty-history", member.userId] });
      queryClient.invalidateQueries({ queryKey: ["vendor-loyalty-members"] });
      queryClient.invalidateQueries({ queryKey: ["vendor-loyalty"] });
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo ajustar."),
  });
  const pts = Math.trunc(Number(points));

  return (
    <div className="fixed inset-0 z-[65] flex items-end justify-center bg-inverse-surface/50 sm:items-center sm:p-4" onClick={onClose}>
      <div role="dialog" aria-modal="true" aria-label={`Puntos de ${member.name ?? "cliente"}`} onClick={(e) => e.stopPropagation()} className="flex max-h-[92dvh] w-full max-w-lg flex-col overflow-hidden rounded-t-2xl bg-surface-container-lowest sm:rounded-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-surface-container-high px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate font-display text-[19px] font-extrabold text-on-surface">{member.name ?? "Cliente"}</h2>
            <p className="truncate text-[12.5px] text-on-surface-variant">{member.email}</p>
          </div>
          <button type="button" onClick={onClose} aria-label="Cerrar" className="flex h-11 w-11 flex-shrink-0 items-center justify-center rounded-full hover:bg-surface-container">
            <X className="h-5 w-5" />
          </button>
        </div>
        <div className="flex-1 overflow-y-auto overscroll-contain px-5 py-4 pb-[max(1rem,env(safe-area-inset-bottom))]">
          {canWrite && (
            <form
              className="mb-5 rounded-xl border border-surface-container-high p-3"
              onSubmit={(e) => {
                e.preventDefault();
                adjust.mutate();
              }}
            >
              <p className="mb-2 text-[13px] font-bold text-on-surface">Sumar o quitar puntos</p>
              <div className="grid gap-2 sm:grid-cols-[120px_1fr]">
                <input aria-label="Puntos" inputMode="numeric" data-allow-negative placeholder="Ej.: 50 o -20" value={points} onChange={(e) => setPoints(e.target.value.replace(/[^\d-]/g, ""))} className={inputCls} />
                <input aria-label="Motivo" placeholder="Motivo (lo verá el cliente)" maxLength={200} value={note} onChange={(e) => setNote(e.target.value)} className={inputCls} />
              </div>
              <Button type="submit" size="sm" className="mt-2" disabled={!pts || note.trim().length < 3 || adjust.isPending}>
                {adjust.isPending ? "Guardando..." : pts < 0 ? `Quitar ${fmtPoints(-pts)}` : pts > 0 ? `Sumar ${fmtPoints(pts)}` : "Ajustar"}
              </Button>
            </form>
          )}
          <p className="mb-2 text-[13px] font-bold text-on-surface">Movimientos</p>
          {isLoading && <ListSkeleton />}
          {isError && <p className="text-[13px] text-error">No se pudo cargar el historial.</p>}
          {data && data.length === 0 && <p className="text-[13px] text-on-surface-variant">Todavía no hay movimientos.</p>}
          {data && data.length > 0 && (
            <ul className="divide-y divide-surface-container-high">
              {data.map((t) => (
                <li key={t.id} className="flex items-start justify-between gap-3 py-2.5">
                  <div className="min-w-0">
                    <p className="text-[13px] font-semibold text-on-surface">{TX_LABEL[t.type] ?? t.type}{t.orderCode ? ` · ${t.orderCode}` : ""}</p>
                    {t.note && <p className="text-[12px] text-on-surface-variant">{t.note}</p>}
                    <p className="text-[11.5px] text-outline">{dateText(t.createdAt)}</p>
                  </div>
                  <div className="flex-shrink-0 text-right">
                    <p className={`text-[13.5px] font-extrabold ${t.points >= 0 ? "text-verified-dark" : "text-error"}`}>{t.points > 0 ? "+" : ""}{t.points.toLocaleString("es-CU")}</p>
                    <p className="text-[11.5px] text-outline">Saldo {t.balanceAfter.toLocaleString("es-CU")}</p>
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="mt-3 text-[11.5px] text-outline">Saldo actual: {fmtPoints(member.balance)} ({fmtAmount(member.balanceValue, currency)}).</p>
        </div>
      </div>
    </div>
  );
}

function Members({ currency, program, canWrite }) {
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(null);
  const [giftQ, setGiftQ] = useState("");
  const searchQ = useDebounced(q.trim());
  const giftSearch = useDebounced(giftQ.trim());
  const { data, isLoading, isError } = useQuery({
    queryKey: ["vendor-loyalty-members", searchQ],
    queryFn: async () => (await api.get("/loyalty/store/members", { params: { q: searchQ || undefined } })).data.members,
    placeholderData: (prev) => prev,
  });
  const eligible = useQuery({
    queryKey: ["vendor-loyalty-eligible", giftSearch],
    queryFn: async () => (await api.get("/loyalty/store/eligible", { params: { q: giftSearch } })).data.customers,
    enabled: canWrite && giftSearch.length >= 2,
  });
  const withValue = (m) => ({ ...m, balanceValue: pointsValue(program, m.balance) });

  return (
    <section className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:p-5">
      <h2 className="mb-1 text-[15px] font-bold text-on-surface">Clientes con puntos</h2>
      <p className="mb-3 text-[12.5px] text-outline">Toca un cliente para ver sus movimientos{canWrite ? " o ajustarle puntos" : ""}.</p>
      <SearchBox value={q} onChange={setQ} placeholder="Buscar por nombre o correo" />
      {isLoading && <ListSkeleton />}
      {isError && <p className="mt-3 text-[13px] text-error">No se pudo cargar la lista.</p>}
      {data && data.length === 0 && (
        <p className="mt-3 text-[13px] text-on-surface-variant">{q ? "Ningún cliente coincide con la búsqueda." : "Todavía ningún cliente tiene puntos. Aparecen aquí cuando entregas su primer pedido con el programa encendido."}</p>
      )}
      {data && data.length > 0 && (
        <ul className="mt-2 divide-y divide-surface-container-high">
          {data.map((m) => (
            <li key={m.userId}>
              <button type="button" onClick={() => setOpen(withValue(m))} className="flex min-h-14 w-full items-center justify-between gap-3 rounded-lg px-1 py-2 text-left hover:bg-surface-container/60">
                <span className="min-w-0">
                  <span className="block truncate text-[13.5px] font-semibold text-on-surface">{m.name ?? "Cliente"}</span>
                  <span className="block truncate text-[12px] text-on-surface-variant">{m.email}</span>
                </span>
                <span className="flex-shrink-0 text-right">
                  <span className="block text-[14px] font-extrabold text-on-surface">{m.balance.toLocaleString("es-CU")}</span>
                  <span className="block text-[11.5px] text-outline">{fmtAmount(pointsValue(program, m.balance), currency)}</span>
                </span>
              </button>
            </li>
          ))}
        </ul>
      )}

      {canWrite && (
        <div className="mt-4 border-t border-surface-container-high pt-3">
          <p className="mb-1 text-[13px] font-bold text-on-surface">Regalar puntos a otro cliente</p>
          <p className="mb-2 text-[12px] text-outline">Solo clientes que ya te compraron con su cuenta.</p>
          <SearchBox value={giftQ} onChange={setGiftQ} placeholder="Nombre o correo del cliente" />
          {eligible.data?.length === 0 && <p className="mt-2 text-[12.5px] text-on-surface-variant">No hay clientes con ese nombre o correo que te hayan comprado.</p>}
          {eligible.data?.length > 0 && (
            <ul className="mt-2 divide-y divide-surface-container-high">
              {eligible.data.map((c) => (
                <li key={c.userId}>
                  <button type="button" onClick={() => setOpen({ ...c, balance: 0, balanceValue: 0 })} className="flex min-h-12 w-full items-center justify-between gap-3 px-1 text-left hover:bg-surface-container/60">
                    <span className="min-w-0 truncate text-[13px] text-on-surface">{c.name ?? c.email} <span className="text-on-surface-variant">· {c.email}</span></span>
                    <span className="flex-shrink-0 text-[12.5px] font-bold text-tertiary-accent">Elegir</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
      {open && <MemberModal member={open} currency={currency} canWrite={canWrite} onClose={() => setOpen(null)} />}
    </section>
  );
}

const PERCENT_CHOICES = [20, 30, 40, 50];

export default function VendorLoyalty() {
  const { staffSectionPermissions, vendor } = useOutletContext() ?? {};
  const canWrite = canWriteSection(staffSectionPermissions, "puntos");
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["vendor-loyalty"], queryFn: async () => (await api.get("/loyalty/store")).data });
  const [form, setForm] = useState(null);
  const [showTips, setShowTips] = useState(false);

  useEffect(() => {
    if (data && !form) setForm(toForm(data.configured ? data.program : { ...data.program, ...data.suggestions.suggested, enabled: false }));
  }, [data, form]);

  const limits = data?.limits ?? { maxRewardPercent: 15, maxRedeemPercent: 50 };
  const parsed = useMemo(() => (form ? fromForm(form) : null), [form]);
  const error = parsed ? formError(parsed, limits) : null;
  const valid = parsed && !formError({ ...parsed, marginPercent: null, maxRedeemPercent: 1 }, { maxRewardPercent: Infinity, maxRedeemPercent: 100 });
  const currency = data?.currency ?? "CUP";
  const dirty = data && form && JSON.stringify(parsed) !== JSON.stringify(fromForm(toForm(data.program)));

  const save = useMutation({
    mutationFn: async (body) => (await api.put("/loyalty/store", body)).data,
    onSuccess: ({ program, cost }) => {
      queryClient.setQueryData(["vendor-loyalty"], (old) => (old ? { ...old, program, cost, configured: true } : old));
      setForm(toForm(program));
      toast.success(program.enabled ? "Programa de fidelidad guardado y activo." : "Programa de fidelidad guardado (apagado).");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el programa."),
  });

  if (isLoading || (data && !form)) return <PanelSkeleton />;
  if (isError) return <p className="text-body-md text-error">No se pudo cargar el programa de fidelidad. Recarga la página.</p>;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setTier = (i, key) => (e) => setForm((f) => ({ ...f, bonusTiers: f.bonusTiers.map((t, j) => (j === i ? { ...t, [key]: e.target.value } : t)) }));
  const { stats, suggestions } = data;
  const presets = suggestions.presets ?? [];
  const exampleAmount = suggestions.stats.orders >= 5 ? Math.round(suggestions.stats.avgTicket) : (parsed.earnPerAmount || 100) * 5;
  const disabled = !canWrite || save.isPending;
  // El nivel elegido es el que coincide con lo que dice el formulario; si la tienda cambia algo, queda "a tu medida".
  const sameValues = (v) => ["earnPerAmount", "earnPoints", "valuePoints", "valueAmount"].every((k) => Number(v[k]) === Number(parsed[k]));
  const activePreset = presets.find((pr) => sameValues(pr.values))?.key;
  const applyPreset = (pr) => setForm((f) => ({ ...toForm({ ...pr.values, enabled: f.enabled, marginPercent: f.marginPercent === "" ? null : f.marginPercent, bonusTiers: [] }) }));
  const tierCost = (t) => {
    const tier = { minTotal: num(t.minTotal), bonusPoints: Math.trunc(num(t.bonusPoints)) };
    if (!valid || !(tier.minTotal > 0) || !(tier.bonusPoints >= 1)) return null;
    return programCost({ ...parsed, bonusTiers: [tier] }).tiers[0]?.percent ?? null;
  };

  return (
    <div className="mx-auto max-w-5xl">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Award} tone="teal" />
        <h1 className="font-display text-[24px] font-extrabold tracking-tight text-on-surface sm:text-[26px]">Programa de fidelidad</h1>
      </div>
      <p className="mb-5 max-w-2xl text-[13.5px] text-outline">
        Premia a quien vuelve a comprarte. Tus clientes con cuenta ganan puntos al recibir sus pedidos y los usan como descuento en su próxima compra en tu tienda. Tú decides cuánto dar, y nunca te deja perder dinero.
      </p>

      {!data.planAllows && (
        <div className="mb-4 rounded-2xl border border-secondary/40 bg-secondary-container/20 p-4 text-[13px] text-on-surface">
          Tu plan actual no incluye el programa de fidelidad. Puedes dejarlo configurado y encenderlo cuando cambies de plan.{" "}
          <Link to="/vendedor/verificacion" className="font-bold text-tertiary-accent underline">Ver planes</Link>
        </div>
      )}

      <div className="mb-4 grid gap-3 lg:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
        <div className={`flex items-start justify-between gap-3 rounded-2xl border p-4 ${form.enabled ? "border-verified/40 bg-verified/[0.06]" : "border-surface-container-high bg-surface-container-lowest"}`}>
          <div>
            <p className="text-[16px] font-extrabold text-on-surface">{form.enabled ? "Programa encendido" : "Programa apagado"}</p>
            <p className="mt-0.5 text-[12.5px] leading-[18px] text-on-surface-variant">
              {form.enabled ? "Tus clientes ven cuántos puntos ganan en tu tienda y en el carrito, y pueden usarlos al pagar." : "Nadie gana ni usa puntos. Los saldos que ya existen se conservan."}
            </p>
            {dirty && <p className="mt-1.5 text-[12px] font-semibold text-secondary">Tienes cambios sin guardar.</p>}
          </div>
          <ToggleSwitch isActive={form.enabled} label="Programa de fidelidad" disabled={disabled || (!data.planAllows && !form.enabled)} onToggle={() => setForm((f) => ({ ...f, enabled: !f.enabled }))} />
        </div>
        <CustomerPreview vendor={vendor} parsed={parsed} currency={currency} valid={valid} />
      </div>

      <div className="mb-5 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Puntos de tus clientes" value={stats.pointsOutstanding.toLocaleString("es-CU")} sub={`Valen ${fmtAmount(pointsValue(data.program, stats.pointsOutstanding), currency)}`} />
        <Stat label="Clientes con puntos" value={stats.membersWithPoints} />
        <Stat label="Dados en 30 días" value={stats.earnedPoints30d.toLocaleString("es-CU")} />
        <Stat label="Usados en 30 días" value={stats.redeemedPoints30d.toLocaleString("es-CU")} sub={`${stats.ordersWithPoints30d} ${stats.ordersWithPoints30d === 1 ? "pedido" : "pedidos"}`} />
      </div>

      <form
        className="mb-5 grid items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]"
        onSubmit={(e) => {
          e.preventDefault();
          if (!error) save.mutate(parsed);
        }}
      >
        <fieldset disabled={disabled} className="grid min-w-0 gap-3">
          {presets.length > 0 && (
            <section className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:p-5">
              <h2 className="text-[15px] font-bold text-on-surface">Empieza con un nivel</h2>
              <p className="mb-3 mt-0.5 text-[12.5px] text-on-surface-variant">Llena los pasos de abajo con valores probados. Después puedes ajustar lo que quieras.</p>
              <div role="radiogroup" aria-label="Nivel del programa" className="grid gap-2 sm:grid-cols-3">
                {presets.map((pr) => {
                  const on = activePreset === pr.key;
                  return (
                    <button
                      key={pr.key}
                      type="button"
                      role="radio"
                      aria-checked={on}
                      onClick={() => applyPreset(pr)}
                      className={`rounded-xl border p-3 text-left transition-colors ${on ? "border-tertiary-accent bg-tertiary-accent/[0.07] ring-2 ring-tertiary-accent/20" : "border-outline-variant hover:bg-surface-container/60"}`}
                    >
                      <span className="flex items-baseline justify-between gap-2">
                        <span className="text-[14px] font-extrabold text-on-surface">{pr.label}</span>
                        <span className="text-[13px] font-bold text-tertiary-accent">{pr.percent} %</span>
                      </span>
                      <span className="mt-1 block text-[12px] leading-[17px] text-on-surface-variant">{pr.hint}</span>
                    </button>
                  );
                })}
              </div>
              {!activePreset && <p className="mt-2 text-[12px] text-outline">Ahora tienes valores a tu medida.</p>}
            </section>
          )}

          <Step n={1} title="Cuántos puntos gana el cliente" why="Se cuentan sobre lo que el cliente paga con dinero, sin el envío. Llegan cuando marcas el pedido como Entregado; si después lo anulas, se quitan solos.">
            <div className="flex flex-wrap items-center gap-2 text-[14.5px] text-on-surface">
              <span className="font-semibold">Por cada</span>
              <input id="lp-amount" aria-label={`Monto de compra en ${currency}`} inputMode="decimal" value={form.earnPerAmount} onChange={set("earnPerAmount")} className={inlineInput} />
              <span className="font-semibold">{currency} de compra, gana</span>
              <input id="lp-points" aria-label="Puntos que gana" inputMode="numeric" value={form.earnPoints} onChange={set("earnPoints")} className={inlineInput} />
              <span className="font-semibold">{parsed.earnPoints === 1 ? "punto" : "puntos"}</span>
            </div>
            {valid && <Note>Un pedido de {fmtAmount(exampleAmount, currency)} da {fmtPoints(pointsForAmount({ ...parsed, bonusTiers: [] }, exampleAmount))}.</Note>}
          </Step>

          <Step n={2} title="Cuánto vale cada punto" why="Es el descuento que da cada punto en la próxima compra. Junto con el paso 1 decide cuánto te cuesta el programa: lo ves a la derecha mientras lo cambias.">
            <ValueEditor form={form} setForm={setForm} currency={currency} parsed={parsed} />
          </Step>

          <Step n={3} title="Cómo los usa" why="Cuándo puede empezar a usarlos y qué parte del pedido puede pagar con puntos. El resto siempre lo paga con dinero.">
            <div className="grid gap-4 sm:grid-cols-2">
              <div>
                <label htmlFor="lp-min" className="mb-1 block text-[12.5px] font-bold text-on-surface">Puede usarlos desde</label>
                <div className="flex items-center gap-2">
                  <input id="lp-min" inputMode="numeric" value={form.minRedeemPoints} onChange={set("minRedeemPoints")} className={inlineInput} />
                  <span className="text-[13.5px] font-semibold text-on-surface">puntos juntados</span>
                </div>
                <p className="mt-1 text-[12px] leading-[17px] text-outline">Un mínimo bajo motiva más. Uno alto hace que vuelva varias veces antes de usarlos.</p>
              </div>
              <div>
                <span id="lp-pct-label" className="mb-1 block text-[12.5px] font-bold text-on-surface">Paga con puntos hasta el</span>
                <div role="radiogroup" aria-labelledby="lp-pct-label" className="flex flex-wrap gap-1.5">
                  {PERCENT_CHOICES.filter((p) => p <= limits.maxRedeemPercent).map((p) => (
                    <button
                      key={p}
                      type="button"
                      role="radio"
                      aria-checked={parsed.maxRedeemPercent === p}
                      onClick={() => setForm((f) => ({ ...f, maxRedeemPercent: String(p) }))}
                      className={`min-h-11 min-w-[56px] rounded-xl border px-3 text-[13.5px] font-bold ${parsed.maxRedeemPercent === p ? "border-tertiary-accent bg-tertiary-accent text-white" : "border-outline-variant text-on-surface hover:bg-surface-container"}`}
                    >
                      {p} %
                    </button>
                  ))}
                </div>
                <p className="mt-1 text-[12px] leading-[17px] text-outline">
                  En un pedido de {fmtAmount(100, currency)}, paga como mucho {fmtAmount(Math.min(parsed.maxRedeemPercent || 0, limits.maxRedeemPercent), currency)} con puntos.
                </p>
              </div>
            </div>
          </Step>

          <Step n={4} title="Bonos por compras grandes" optional why="Puntos extra cuando el pedido llega a un monto. Ayudan a que el cliente compre un poco más. Si alcanza varios, recibe solo el más alto.">
            {form.bonusTiers.length === 0 && <p className="text-[12.5px] text-on-surface-variant">No tienes bonos.</p>}
            {form.bonusTiers.map((t, i) => {
              const pct = tierCost(t);
              return (
                <div key={i} className="mb-2 rounded-xl border border-surface-container-high p-3">
                  <div className="flex flex-wrap items-center gap-2 text-[14px] text-on-surface">
                    <Gift className="h-4 w-4 text-tertiary-accent" aria-hidden="true" />
                    <span className="font-semibold">Si compra desde</span>
                    <input aria-label={`Monto mínimo del bono ${i + 1}`} inputMode="decimal" value={t.minTotal} onChange={setTier(i, "minTotal")} className={inlineInput} />
                    <span className="font-semibold">{currency}, gana</span>
                    <input aria-label={`Puntos extra del bono ${i + 1}`} inputMode="numeric" value={t.bonusPoints} onChange={setTier(i, "bonusPoints")} className={inlineInput} />
                    <span className="font-semibold">puntos extra</span>
                    <button type="button" aria-label={`Quitar bono ${i + 1}`} onClick={() => setForm((f) => ({ ...f, bonusTiers: f.bonusTiers.filter((_, j) => j !== i) }))} className="ml-auto flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container">
                      <Trash2 className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                  {pct != null && <p className={`mt-1.5 text-[12px] ${costLevel(pct, limits.maxRewardPercent).tone}`}>En un pedido de justo ese monto devuelves el {fmtPercent(pct)} en puntos.</p>}
                </div>
              );
            })}
            {form.bonusTiers.length < 5 && (
              <button type="button" onClick={() => setForm((f) => ({ ...f, bonusTiers: [...f.bonusTiers, { minTotal: "", bonusPoints: "" }] }))} className="flex min-h-11 items-center gap-1.5 text-[13px] font-bold text-tertiary-accent">
                <Plus className="h-4 w-4" aria-hidden="true" /> Agregar bono
              </button>
            )}
          </Step>

          <Step n={5} title="Protege tu ganancia" optional why="Si nos dices cuánto ganas más o menos por cada venta, no te dejamos guardar un programa que se coma más de la mitad. Solo lo ves tú.">
            <div className="flex flex-wrap items-center gap-2 text-[14px] text-on-surface">
              <ShieldCheck className="h-4 w-4 text-tertiary-accent" aria-hidden="true" />
              <span className="font-semibold">Gano más o menos el</span>
              <input id="lp-margin" aria-label="Ganancia por venta en porcentaje" inputMode="numeric" placeholder="—" value={form.marginPercent} onChange={set("marginPercent")} className={inlineInput} />
              <span className="font-semibold">% de cada venta</span>
            </div>
            {parsed.marginPercent > 0 && valid && (
              <Note tone={programCost(parsed).max <= parsed.marginPercent / 2 ? "good" : "warn"}>
                El programa puede costarte hasta el {fmtPercent(parsed.marginPercent / 2)}. Ahora te cuesta el {fmtPercent(programCost(parsed).max)}.
              </Note>
            )}
          </Step>
        </fieldset>

        <div className="grid gap-3 lg:sticky lg:top-24">
          <CostSummary parsed={parsed} valid={valid} currency={currency} limits={limits} defaultAmount={exampleAmount} />
          {error && <p className="rounded-xl bg-error/5 px-3 py-2 text-[12.5px] font-semibold text-error">{error}</p>}
          {canWrite && (
            <div className="flex flex-col gap-2">
              <Button type="submit" className="w-full" disabled={!!error || save.isPending || (!dirty && data.configured)}>
                {save.isPending ? "Guardando..." : "Guardar programa"}
              </Button>
              {dirty && data.configured && (
                <Button type="button" variant="ghost" className="w-full" onClick={() => setForm(toForm(data.program))}>
                  Deshacer cambios
                </Button>
              )}
            </div>
          )}
          <p className="text-[11.5px] leading-[16px] text-outline">
            Tope de la plataforma: el programa devuelve como mucho el {fmtPercent(limits.maxRewardPercent)} de cada compra, y con puntos se paga como mucho el {limits.maxRedeemPercent} % del pedido.
          </p>
        </div>
      </form>

      <section className="mb-5 rounded-2xl border border-surface-container-high bg-surface-container-lowest">
        <button type="button" onClick={() => setShowTips((v) => !v)} aria-expanded={showTips} className="flex min-h-12 w-full items-center justify-between gap-3 px-4 py-3 text-left sm:px-5">
          <span className="flex items-center gap-2 text-[15px] font-bold text-on-surface">
            <Lightbulb className="h-4 w-4 text-secondary" aria-hidden="true" /> Consejos con los datos de tu tienda
          </span>
          <ChevronDown className={`h-4 w-4 text-outline transition-transform ${showTips ? "rotate-180" : ""}`} aria-hidden="true" />
        </button>
        {showTips && (
          <ul className="list-disc space-y-1.5 px-4 pb-4 pl-9 text-[13px] leading-[19px] text-on-surface-variant sm:px-5 sm:pl-10">
            {suggestions.tips.map((t) => (
              <li key={t}>{t}</li>
            ))}
          </ul>
        )}
      </section>

      <Members currency={currency} program={data.program} canWrite={canWrite} />
    </div>
  );
}
