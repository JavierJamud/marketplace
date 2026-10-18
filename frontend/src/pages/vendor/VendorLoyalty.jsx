import { useEffect, useMemo, useState } from "react";
import { Link, useOutletContext } from "react-router-dom";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Award, Lightbulb, Plus, Trash2, X } from "lucide-react";
import toast from "../../lib/toast.jsx";
import { api } from "../../lib/api.js";
import { IconCircle } from "../../components/dashboard/DashboardCard.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { SearchBox } from "../../components/ui/SearchBox.jsx";
import ToggleSwitch from "../../components/admin/ToggleSwitch.jsx";
import { canWriteSection } from "../../lib/vendorSections.js";
import { fmtAmount, fmtPoints, pointsForAmount, pointsValue, TX_LABEL } from "../../lib/loyalty.js";

// Programa de fidelidad de la tienda. La tienda decide cuántos puntos da, cuánto valen y cuánto se puede pagar con ellos.
// Los clientes con cuenta ganan los puntos cuando el pedido se marca Entregado y los usan en el checkout de esta tienda.
const inputCls =
  "h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[14px] text-on-surface outline-none focus:border-tertiary-accent disabled:opacity-60";
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
    bonusTiers: f.bonusTiers.filter((t) => t.minTotal !== "" || t.bonusPoints !== "").map((t) => ({ minTotal: num(t.minTotal), bonusPoints: Math.trunc(num(t.bonusPoints)) })),
  };
}

function formError(p) {
  if (!(p.earnPerAmount > 0)) return "Escribe cada cuánto dinero se gana un punto.";
  if (!(p.earnPoints >= 1)) return "Da al menos 1 punto.";
  if (!(p.valuePoints >= 1)) return "Escribe cuántos puntos (1 o más).";
  if (!(p.valueAmount > 0)) return "Escribe cuánto dinero equivalen esos puntos.";
  if (p.valueAmount / p.valuePoints < 0.0001) return "Cada punto tiene que valer al menos 0,0001.";
  if (!(p.minRedeemPoints >= 1)) return "El mínimo de puntos para canjear tiene que ser 1 o más.";
  if (!(p.maxRedeemPercent >= 1 && p.maxRedeemPercent <= 100)) return "La parte del pedido que se paga con puntos va de 1 % a 100 %.";
  if (p.bonusTiers.some((t) => !(t.minTotal > 0) || !(t.bonusPoints >= 1))) return "Completa o quita los bonos a medias.";
  return null;
}

// Valor del punto como un par que la tienda escribe en el orden que le resulte natural: "10 USD equivalen a 1 punto" o
// "1000 puntos equivalen a 10 USD". Abajo se muestra cuánto vale un punto para que el resultado se vea antes de guardar.
const VALUE_ORDERS = [
  { key: "AMOUNT_FIRST", label: "Dinero por puntos" },
  { key: "POINTS_FIRST", label: "Puntos por dinero" },
];

function ValueEditor({ form, setForm, currency, parsed }) {
  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const pointsInput = (
    <input id="lp-vpoints" aria-label="Puntos" inputMode="numeric" value={form.valuePoints} onChange={set("valuePoints")} className={inputCls.replace("w-full", "w-24")} />
  );
  const amountInput = (
    <input id="lp-vamount" aria-label={`Monto en ${currency}`} inputMode="decimal" value={form.valueAmount} onChange={set("valueAmount")} className={inputCls.replace("w-full", "w-24")} />
  );
  const each = parsed.valuePoints >= 1 && parsed.valueAmount > 0 ? parsed.valueAmount / parsed.valuePoints : null;
  const pointsFirst = form.valueOrder === "POINTS_FIRST";

  return (
    <div className="rounded-xl border border-surface-container-high p-3">
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
      <div className="flex flex-wrap items-center gap-2 text-[14px] text-on-surface">
        {pointsFirst ? pointsInput : amountInput}
        <span className="font-semibold">{pointsFirst ? "puntos equivalen a" : `${currency} equivalen a`}</span>
        {pointsFirst ? amountInput : pointsInput}
        <span className="font-semibold">{pointsFirst ? currency : "puntos"}</span>
      </div>
      <p className="mt-2 text-[12px] leading-[17px] text-outline">
        {each ? `Cada punto vale ${each.toLocaleString("es-CU", { maximumFractionDigits: 4 })} ${currency} al canjearlo.` : "Escribe los dos números para ver cuánto vale cada punto."}
      </p>
    </div>
  );
}

function Field({ label, hint, children, id }) {
  return (
    <div>
      <label htmlFor={id} className="mb-1 block text-[12.5px] font-bold text-on-surface">{label}</label>
      {children}
      {hint && <p className="mt-1 text-[12px] leading-[17px] text-outline">{hint}</p>}
    </div>
  );
}

function Stat({ label, value, sub }) {
  return (
    <div className="rounded-xl bg-surface-container/60 px-3 py-2.5">
      <div className="text-[11.5px] font-semibold text-outline">{label}</div>
      <div className="mt-0.5 text-[16px] font-extrabold text-on-surface">{value}</div>
      {sub && <div className="text-[11.5px] text-on-surface-variant">{sub}</div>}
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
          {isLoading && <p className="text-[13px] text-on-surface-variant">Cargando...</p>}
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
      {isLoading && <p className="mt-3 text-[13px] text-on-surface-variant">Cargando...</p>}
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

export default function VendorLoyalty() {
  const { staffSectionPermissions } = useOutletContext() ?? {};
  const canWrite = canWriteSection(staffSectionPermissions, "puntos");
  const queryClient = useQueryClient();
  const { data, isLoading, isError } = useQuery({ queryKey: ["vendor-loyalty"], queryFn: async () => (await api.get("/loyalty/store")).data });
  const [form, setForm] = useState(null);

  useEffect(() => {
    if (data && !form) setForm(toForm(data.configured ? data.program : { ...data.program, ...data.suggestions.suggested, enabled: false }));
  }, [data, form]);

  const parsed = useMemo(() => (form ? fromForm(form) : null), [form]);
  const error = parsed ? formError(parsed) : null;
  const currency = data?.currency ?? "CUP";
  const dirty = data && form && JSON.stringify(parsed) !== JSON.stringify(fromForm(toForm(data.program)));

  const save = useMutation({
    mutationFn: async (body) => (await api.put("/loyalty/store", body)).data,
    onSuccess: ({ program }) => {
      queryClient.setQueryData(["vendor-loyalty"], (old) => (old ? { ...old, program, configured: true } : old));
      setForm(toForm(program));
      toast.success(program.enabled ? "Programa de fidelidad guardado y activo." : "Programa de fidelidad guardado (apagado).");
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo guardar el programa."),
  });

  if (isLoading || (data && !form)) return <p className="text-body-md text-on-surface-variant">Cargando...</p>;
  if (isError) return <p className="text-body-md text-error">No se pudo cargar el programa de fidelidad. Recarga la página.</p>;

  const set = (key) => (e) => setForm((f) => ({ ...f, [key]: e.target.value }));
  const setTier = (i, key) => (e) => setForm((f) => ({ ...f, bonusTiers: f.bonusTiers.map((t, j) => (j === i ? { ...t, [key]: e.target.value } : t)) }));
  const { stats, suggestions } = data;
  const exampleAmount = suggestions.stats.orders >= 5 ? Math.round(suggestions.stats.avgTicket) : parsed.earnPerAmount * 5 || 500;
  const examplePoints = error ? 0 : pointsForAmount(parsed, exampleAmount);
  const disabled = !canWrite || save.isPending;

  return (
    <div className="mx-auto max-w-3xl">
      <div className="mb-1 flex items-center gap-3">
        <IconCircle icon={Award} tone="teal" />
        <h1 className="font-display text-[24px] font-extrabold tracking-tight text-on-surface sm:text-[26px]">Programa de fidelidad</h1>
      </div>
      <p className="mb-5 text-[13.5px] text-outline">Tus clientes con cuenta ganan puntos al recibir sus pedidos y los usan para pagar parte de la próxima compra en tu tienda.</p>

      {!data.planAllows && (
        <div className="mb-4 rounded-2xl border border-secondary/40 bg-secondary-container/20 p-4 text-[13px] text-on-surface">
          Tu plan actual no incluye el programa de fidelidad. Puedes dejarlo configurado y encenderlo cuando cambies de plan.{" "}
          <Link to="/vendedor/verificacion" className="font-bold text-tertiary-accent underline">Ver planes</Link>
        </div>
      )}

      <div className="mb-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
        <Stat label="Puntos de tus clientes" value={stats.pointsOutstanding.toLocaleString("es-CU")} sub={fmtAmount(pointsValue(data.program, stats.pointsOutstanding), currency)} />
        <Stat label="Clientes con puntos" value={stats.membersWithPoints} />
        <Stat label="Dados en 30 días" value={stats.earnedPoints30d.toLocaleString("es-CU")} />
        <Stat label="Usados en 30 días" value={stats.redeemedPoints30d.toLocaleString("es-CU")} sub={`${stats.ordersWithPoints30d} ${stats.ordersWithPoints30d === 1 ? "pedido" : "pedidos"}`} />
      </div>

      <form
        className="mb-4 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:p-5"
        onSubmit={(e) => {
          e.preventDefault();
          if (!error) save.mutate(parsed);
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-surface-container-high pb-3">
          <div>
            <p className="text-[15px] font-bold text-on-surface">{form.enabled ? "Programa encendido" : "Programa apagado"}</p>
            <p className="text-[12.5px] text-outline">{form.enabled ? "Los clientes ven cuántos puntos ganan y pueden usarlos." : "Nadie gana ni usa puntos. Los saldos que ya existen se conservan."}</p>
          </div>
          <ToggleSwitch isActive={form.enabled} label="Programa de fidelidad" disabled={disabled || (!data.planAllows && !form.enabled)} onToggle={() => setForm((f) => ({ ...f, enabled: !f.enabled }))} />
        </div>

        <fieldset disabled={disabled} className="mt-4 grid gap-5">
          <div>
            <legend className="mb-2 text-[13.5px] font-bold text-on-surface">Cómo se ganan</legend>
            <div className="grid grid-cols-2 gap-3">
              <Field id="lp-amount" label={`Cada (${currency})`}>
                <input id="lp-amount" inputMode="decimal" value={form.earnPerAmount} onChange={set("earnPerAmount")} className={inputCls} />
              </Field>
              <Field id="lp-points" label="da (puntos)">
                <input id="lp-points" inputMode="numeric" value={form.earnPoints} onChange={set("earnPoints")} className={inputCls} />
              </Field>
            </div>
            <p className="mt-2 text-[12.5px] font-semibold text-on-surface">Bonos por pedidos grandes</p>
            <p className="mb-2 text-[12px] text-outline">Puntos extra si el pedido llega a un monto. Se aplica el bono más alto alcanzado.</p>
            {form.bonusTiers.map((t, i) => (
              <div key={i} className="mb-2 grid grid-cols-[1fr_1fr_44px] items-end gap-2">
                <Field id={`lp-tier-${i}`} label={`Desde (${currency})`}>
                  <input id={`lp-tier-${i}`} inputMode="decimal" value={t.minTotal} onChange={setTier(i, "minTotal")} className={inputCls} />
                </Field>
                <Field id={`lp-tierp-${i}`} label="Puntos extra">
                  <input id={`lp-tierp-${i}`} inputMode="numeric" value={t.bonusPoints} onChange={setTier(i, "bonusPoints")} className={inputCls} />
                </Field>
                <button type="button" aria-label="Quitar bono" onClick={() => setForm((f) => ({ ...f, bonusTiers: f.bonusTiers.filter((_, j) => j !== i) }))} className="flex h-11 w-11 items-center justify-center rounded-lg text-on-surface-variant hover:bg-surface-container">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
            {form.bonusTiers.length < 5 && (
              <button type="button" onClick={() => setForm((f) => ({ ...f, bonusTiers: [...f.bonusTiers, { minTotal: "", bonusPoints: "" }] }))} className="flex min-h-11 items-center gap-1.5 text-[13px] font-bold text-tertiary-accent">
                <Plus className="h-4 w-4" /> Agregar bono
              </button>
            )}
          </div>

          <div>
            <legend className="mb-2 text-[13.5px] font-bold text-on-surface">Cuánto valen y cómo se usan</legend>
            <ValueEditor form={form} setForm={setForm} currency={currency} parsed={parsed} />
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <Field id="lp-min" label="Mínimo de puntos para canjear" hint="El cliente tiene que juntar al menos estos puntos en tu tienda para poder usarlos aquí.">
                <input id="lp-min" inputMode="numeric" value={form.minRedeemPoints} onChange={set("minRedeemPoints")} className={inputCls} />
              </Field>
              <Field
                id="lp-pct"
                label="Parte del pedido que se puede pagar con puntos (%)"
                hint={`Con ${parsed.maxRedeemPercent >= 1 && parsed.maxRedeemPercent <= 100 ? parsed.maxRedeemPercent : 50} %, en un pedido de ${fmtAmount(100, currency)} se pagan como mucho ${fmtAmount(parsed.maxRedeemPercent >= 1 && parsed.maxRedeemPercent <= 100 ? parsed.maxRedeemPercent : 50, currency)} con puntos y el resto con dinero.`}
              >
                <input id="lp-pct" inputMode="numeric" value={form.maxRedeemPercent} onChange={set("maxRedeemPercent")} className={inputCls} />
              </Field>
            </div>
          </div>
        </fieldset>

        {!error && (
          <p className="mt-4 rounded-xl bg-surface-container/60 px-3 py-2.5 text-[12.5px] leading-[18px] text-on-surface">
            Ejemplo: un pedido de {fmtAmount(exampleAmount, currency)} da {fmtPoints(examplePoints)}. Con {fmtPoints(Math.max(parsed.minRedeemPoints, 100))} el cliente paga {fmtAmount(pointsValue(parsed, Math.max(parsed.minRedeemPoints, 100)), currency)} de su pedido, sin pasar del {parsed.maxRedeemPercent} % del total. Puede canjear cuando junte {fmtPoints(parsed.minRedeemPoints)}.
          </p>
        )}
        {error && <p className="mt-4 text-[12.5px] font-semibold text-error">{error}</p>}
        {canWrite && (
          <div className="mt-4 flex flex-wrap gap-2">
            <Button type="submit" disabled={!!error || save.isPending || (!dirty && data.configured)}>{save.isPending ? "Guardando..." : "Guardar programa"}</Button>
            {dirty && data.configured && (
              <Button type="button" variant="ghost" onClick={() => setForm(toForm(data.program))}>Deshacer cambios</Button>
            )}
          </div>
        )}
      </form>

      <section className="mb-4 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:p-5">
        <div className="mb-2 flex items-center gap-2 text-[15px] font-bold text-on-surface">
          <Lightbulb className="h-4 w-4 text-secondary" aria-hidden="true" /> Sugerencias para tu tienda
        </div>
        <ul className="mb-3 list-disc space-y-1.5 pl-5 text-[13px] leading-[19px] text-on-surface-variant">
          {suggestions.tips.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
        {canWrite && (
          <Button type="button" variant="outline" size="sm" onClick={() => setForm((f) => ({ ...toForm({ ...suggestions.suggested, enabled: f.enabled }) }))}>
            Usar los valores sugeridos
          </Button>
        )}
      </section>

      <Members currency={currency} program={data.program} canWrite={canWrite} />
    </div>
  );
}
