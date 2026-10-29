import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Search, MessageCircle, Store, MapPin, CreditCard, Package, XCircle, Check, RefreshCw } from "lucide-react";
import { api } from "../../lib/api.js";
import { imgUrl, thumbUrl } from "../../lib/imgUrl.js";
import { waLink } from "../../lib/whatsapp.js";
import { formatElapsed } from "../../lib/duration.js";
import { useAuth } from "../../context/AuthContext.jsx";
import { Input } from "../../components/ui/Input.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { Breadcrumbs } from "../../components/Breadcrumbs.jsx";
import { AutoClosedOrderHelp } from "../../components/AutoClosedOrderHelp.jsx";

// Rastreo de un pedido sin cuenta: correo + número del pedido (POST /orders/track, que exige que los dos coincidan). Muestra
// el avance en 4 pasos, el historial con fecha y hora de cada movimiento, la tienda, los productos, el total y la entrega.
// Mientras la página está abierta se vuelve a consultar cada minuto, así un cambio de la tienda aparece solo.

const STATUS = {
  NEW: { label: "Esperando confirmación", tone: "bg-secondary-container/25 text-on-secondary-container" },
  PREPARING: { label: "Confirmado", tone: "bg-tertiary-accent/15 text-tertiary-accent" },
  READY: { label: "En camino", tone: "bg-tertiary-accent/15 text-tertiary-accent" },
  DELIVERED: { label: "Entregado", tone: "bg-verified/15 text-verified-dark" },
  CANCELLED: { label: "Cancelado", tone: "bg-error/10 text-error" },
};

const STEPS = [
  { key: "received", label: "Recibido" },
  { key: "confirmed", label: "Confirmado" },
  { key: "onTheWay", label: "En camino" },
  { key: "delivered", label: "Entregado" },
];
const STEP_INDEX = { NEW: 0, PREPARING: 1, READY: 2, DELIVERED: 3 };

const dateTime = (iso) => new Date(iso).toLocaleString("es-CU", { day: "numeric", month: "short", year: "numeric", hour: "numeric", minute: "2-digit" });
const shortDate = (iso) => new Date(iso).toLocaleString("es-CU", { day: "numeric", month: "short", hour: "numeric", minute: "2-digit" });

export default function OrderTracking() {
  const { user } = useAuth();
  const [params] = useSearchParams();
  const [email, setEmail] = useState(user?.email ?? "");
  const [code, setCode] = useState(() => params.get("pedido")?.slice(0, 40) ?? "");
  const [query, setQuery] = useState(null);

  const { data: order, error, isFetching, isLoading, dataUpdatedAt, refetch } = useQuery({
    queryKey: ["track-order", query?.email, query?.code],
    queryFn: async () => (await api.post("/orders/track", query)).data.order,
    enabled: !!query,
    retry: false,
    refetchInterval: (q) => (q.state.data && !["DELIVERED", "CANCELLED"].includes(q.state.data.status) ? 60_000 : false),
  });

  const submit = (e) => {
    e.preventDefault();
    const next = { email: email.trim(), code: code.trim() };
    if (query && next.email === query.email && next.code === query.code) refetch();
    else setQuery(next);
  };

  const errorText = error ? error.response?.data?.error ?? "No pudimos buscar el pedido. Revisa tu conexión y vuelve a intentarlo." : null;

  return (
    <div className="container-app max-w-[1040px] py-10 md:py-14">
      <Breadcrumbs className="mb-2" items={[{ label: "Rastrear pedido" }]} />
      <h1 className="mb-2 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">Rastrear pedido</h1>
      <p className="mb-6 max-w-[620px] text-body-md text-on-surface-variant">
        Escribe el correo con el que compraste y el número del pedido. El número aparece al terminar la compra y en el correo de
        confirmación (empieza con Z-).
      </p>

      <form onSubmit={submit} className="mb-8 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4 sm:p-5">
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1.3fr_1fr_auto] sm:items-end">
          <Input label="Correo" type="email" required autoComplete="email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="tucorreo@ejemplo.com" className="h-12" />
          <Input
            label="Número del pedido"
            required
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase())}
            placeholder="Z-XXXXXXXXXX"
            autoCapitalize="characters"
            spellCheck={false}
            className="h-12 font-mono tracking-wide"
          />
          <Button type="submit" size="lg" disabled={isFetching} className="h-12 w-full sm:w-auto sm:px-6">
            {isFetching && !order ? <Spinner /> : <Search className="h-4 w-4" aria-hidden="true" />}
            {isFetching && !order ? "Buscando..." : "Buscar pedido"}
          </Button>
        </div>
        {errorText && (
          <p role="alert" className="mt-3 flex items-start gap-2 rounded-xl bg-error/10 px-3.5 py-3 text-[13.5px] text-error">
            <XCircle className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
            {errorText}
          </p>
        )}
      </form>

      {isLoading && query && (
        <div className="flex items-center justify-center gap-2 py-16 text-body-md text-on-surface-variant" aria-live="polite">
          <Spinner className="text-tertiary-accent" /> Buscando tu pedido...
        </div>
      )}

      {!query && (
        <div className="rounded-2xl border border-dashed border-outline-variant px-5 py-10 text-center text-body-md text-on-surface-variant">
          <Package className="mx-auto mb-3 h-8 w-8 text-outline" aria-hidden="true" />
          Aquí vas a ver en qué va tu pedido: cuándo lo recibió la tienda, cuándo lo confirmó, cuándo salió y cuándo se entregó.
          {user && (
            <span className="mt-2 block">
              ¿Compraste con tu cuenta? También lo ves en{" "}
              <Link to="/cuenta/panel?tab=orders" className="font-semibold text-tertiary-accent underline-offset-2 hover:underline">
                Mis pedidos
              </Link>
              .
            </span>
          )}
        </div>
      )}

      {order && <OrderResult order={order} updatedAt={dataUpdatedAt} refreshing={isFetching} />}
    </div>
  );
}

function OrderResult({ order, updatedAt, refreshing }) {
  const status = STATUS[order.status] ?? STATUS.NEW;
  const cancelled = order.status === "CANCELLED";
  const finished = order.status === "DELIVERED" || cancelled;
  // Pedidos de antes del historial pueden estar terminados sin la fecha en que terminaron: no se muestra un tiempo que sigue corriendo.
  const finishedAt = order.steps.delivered ?? order.steps.cancelled;

  return (
    <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1.25fr_1fr] lg:items-start">
      <div className="flex flex-col gap-5">
        {/* Estado y avance */}
        <section className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 sm:p-6" aria-labelledby="track-status">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="text-label-sm font-semibold text-outline">Pedido</div>
              <div className="font-mono text-[18px] font-extrabold tracking-wide text-on-surface">{order.code}</div>
            </div>
            <span id="track-status" className={`rounded-full px-3 py-1.5 text-[13px] font-bold ${order.autoCancelled ? "bg-surface-container-high text-on-surface" : status.tone}`}>
              {order.autoCancelled ? "Sin confirmar" : status.label}
            </span>
          </div>
          <dl className="mt-4 grid grid-cols-2 gap-3 text-[13px]">
            <div>
              <dt className="text-outline">Lo hiciste el</dt>
              <dd className="font-semibold text-on-surface">{dateTime(order.createdAt)}</dd>
            </div>
            <div>
              <dt className="text-outline">{!finished ? "Tiempo desde que lo hiciste" : order.autoCancelled ? "Se cerró a los" : cancelled ? "Se canceló a los" : "Llegó en"}</dt>
              <dd className="font-semibold text-on-surface">{finished && !finishedAt ? "Sin fecha registrada" : formatElapsed(order.createdAt, finishedAt)}</dd>
            </div>
          </dl>

          {cancelled && order.autoCancelled ? (
            <AutoClosedOrderHelp code={order.code} store={order.store} className="mt-5" />
          ) : cancelled ? (
            <div className="mt-5 rounded-xl bg-error/10 px-4 py-3.5 text-[13.5px] text-error">
              <div className="font-bold">{order.cancelledByCustomer ? "Cancelaste este pedido" : "La tienda canceló este pedido"}</div>
              {order.cancelReason && <div className="mt-0.5">Motivo: {order.cancelReason}</div>}
            </div>
          ) : (
            <ol className="mt-6 grid grid-cols-4" aria-label="Avance del pedido">
              {STEPS.map((s, i) => {
                const reached = i <= (STEP_INDEX[order.status] ?? 0);
                const at = order.steps[s.key];
                return (
                  <li key={s.key} className="relative flex flex-col items-center text-center" aria-current={i === STEP_INDEX[order.status] ? "step" : undefined}>
                    {i > 0 && (
                      <span aria-hidden="true" className={`absolute right-1/2 top-[13px] h-[3px] w-full ${reached ? "bg-tertiary-accent" : "bg-surface-container-high"}`} />
                    )}
                    <span
                      className={`relative z-10 flex h-7 w-7 items-center justify-center rounded-full border-2 ${
                        reached ? "border-tertiary-accent bg-tertiary-accent text-white" : "border-outline-variant bg-surface-container-lowest text-outline"
                      }`}
                    >
                      {reached ? <Check className="h-4 w-4" aria-hidden="true" /> : <span className="text-[11px] font-bold">{i + 1}</span>}
                    </span>
                    <span className={`mt-2 text-[12px] font-bold leading-tight sm:text-[13px] ${reached ? "text-on-surface" : "text-outline"}`}>{s.label}</span>
                    <span className="mt-0.5 text-[11px] leading-tight text-outline">{at ? shortDate(at) : reached ? "" : "Pendiente"}</span>
                  </li>
                );
              })}
            </ol>
          )}
          <div className="mt-5 flex items-center gap-1.5 text-[12px] text-outline" aria-live="polite">
            <RefreshCw className={`h-3.5 w-3.5 ${refreshing ? "animate-spin" : ""}`} aria-hidden="true" />
            {finished
              ? "Este pedido ya terminó."
              : `Se actualiza solo cada minuto. Última revisión: ${new Date(updatedAt).toLocaleTimeString("es-CU", { hour: "numeric", minute: "2-digit" })}`}
          </div>
        </section>

        {/* Historial */}
        <section className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 sm:p-6">
          <h2 className="mb-4 text-title-md font-bold text-on-surface">Historial del pedido</h2>
          <ol className="flex flex-col">
            {[...order.timeline].reverse().map((e, i, list) => {
              const prev = list[i + 1];
              const bad = e.type === "CANCELLED";
              const last = i === list.length - 1;
              return (
                <li key={`${e.type}-${e.at}`} className="relative flex gap-3 pb-5 last:pb-0">
                  {!last && <span aria-hidden="true" className="absolute left-[7px] top-4 h-full w-[2px] bg-surface-container-high" />}
                  <span aria-hidden="true" className={`relative z-10 mt-1 h-4 w-4 flex-shrink-0 rounded-full border-[3px] ${bad ? "border-error bg-error/20" : i === 0 ? "border-tertiary-accent bg-tertiary-accent/20" : "border-outline-variant bg-surface-container-lowest"}`} />
                  <div className="min-w-0">
                    <div className={`text-[14px] font-semibold ${bad ? "text-error" : "text-on-surface"}`}>{e.text}</div>
                    <div className="text-[12.5px] text-outline">
                      {dateTime(e.at)}
                      {prev && ` · ${formatElapsed(prev.at, e.at)} después`}
                    </div>
                    {e.detail && <div className="mt-1 break-words text-[13px] text-on-surface-variant">{e.detail}</div>}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      </div>

      <div className="flex flex-col gap-5">
        <StoreCard order={order} />

        {/* Productos y total */}
        <section className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 sm:p-6">
          <h2 className="mb-3 text-title-md font-bold text-on-surface">
            Productos <span className="text-[13px] font-semibold text-outline">({order.items.reduce((n, i) => n + i.quantity, 0)})</span>
          </h2>
          <ul className="flex flex-col divide-y divide-surface-container-high">
            {order.items.map((it, idx) => (
              <li key={`${it.name}-${idx}`} className="flex items-center gap-3 py-3 first:pt-0">
                <span className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-xl bg-surface-container">
                  {it.image ? (
                    <img src={thumbUrl(it.image)} onError={(ev) => { ev.currentTarget.onerror = null; ev.currentTarget.src = imgUrl(it.image); }} alt="" className="h-full w-full object-cover" loading="lazy" />
                  ) : (
                    <Package className="m-auto mt-4 h-6 w-6 text-outline" aria-hidden="true" />
                  )}
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[14px] font-semibold leading-snug text-on-surface">{it.name}</div>
                  <div className="text-[12.5px] text-outline">
                    {it.quantity} × {it.unitPrice}
                    {it.size ? ` · Talla ${it.size}` : ""}
                  </div>
                </div>
                <div className="flex-shrink-0 text-[14px] font-bold text-on-surface">{it.lineTotal}</div>
              </li>
            ))}
          </ul>
          <dl className="mt-3 flex flex-col gap-1.5 border-t border-surface-container-high pt-3 text-[13.5px]">
            {(order.totals.discount || order.totals.loyalty) && <Row label="Subtotal" value={order.totals.subtotal} />}
            {order.totals.discount && <Row label="Código de descuento" value={order.totals.discount} />}
            {order.totals.loyalty && <Row label="Puntos usados" value={order.totals.loyalty} />}
            <Row label="Productos" value={order.totals.products} />
            <Row label="Envío" value={order.totals.shipping} />
            <div className="mt-1 flex items-baseline justify-between gap-3 border-t border-surface-container-high pt-2.5">
              <dt className="text-[14px] font-bold text-on-surface">Total</dt>
              <dd className="text-right text-[18px] font-extrabold text-on-surface">{order.totals.total}</dd>
            </div>
            {order.totals.shippingCoordinate && <p className="text-[12px] text-outline">Parte del envío se acuerda con la tienda según el lugar de entrega.</p>}
          </dl>
        </section>

        {/* Entrega y pago */}
        <section className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 sm:p-6">
          <h2 className="mb-3 text-title-md font-bold text-on-surface">Entrega y pago</h2>
          <dl className="flex flex-col gap-3 text-[13.5px]">
            <div className="flex gap-2.5">
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0 text-outline" aria-hidden="true" />
              <div className="min-w-0">
                <dt className="text-outline">Dónde se entrega</dt>
                <dd className="break-words font-semibold text-on-surface">{[order.delivery.address, order.delivery.place].filter(Boolean).join(", ") || "Por coordinar con la tienda"}</dd>
                {order.delivery.recipient && <dd className="text-on-surface-variant">Recibe: {order.delivery.recipient}</dd>}
              </div>
            </div>
            <div className="flex gap-2.5">
              <CreditCard className="mt-0.5 h-4 w-4 flex-shrink-0 text-outline" aria-hidden="true" />
              <div>
                <dt className="text-outline">Forma de pago</dt>
                <dd className="font-semibold text-on-surface">{order.payment}</dd>
              </div>
            </div>
          </dl>
        </section>
      </div>
    </div>
  );
}

function StoreCard({ order }) {
  const s = order.store;
  const wa = s.whatsapp ? waLink(s.whatsapp, `Hola, te escribo por mi pedido ${order.code}.`) : null;
  return (
    <section className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-5 sm:p-6">
      <h2 className="mb-3 text-title-md font-bold text-on-surface">Tienda</h2>
      <div className="flex items-center gap-3">
        <span
          className="flex h-12 w-12 flex-shrink-0 items-center justify-center overflow-hidden rounded-full text-[18px] font-bold text-white"
          style={{ background: s.logoUrl ? "#fff" : s.color ?? "#337475" }}
        >
          {s.logoUrl ? <img src={imgUrl(s.logoUrl)} alt="" className="h-full w-full object-cover" /> : <Store className="h-5 w-5" aria-hidden="true" />}
        </span>
        <div className="min-w-0">
          <div className="truncate text-[15px] font-bold text-on-surface">{s.name}</div>
          {s.slug ? (
            <Link to={`/tienda/${s.slug}`} className="text-[13px] font-semibold text-tertiary-accent underline-offset-2 hover:underline">
              Ver la tienda
            </Link>
          ) : (
            <div className="text-[13px] text-outline">Esta tienda ya no está en la plataforma.</div>
          )}
        </div>
      </div>
      {wa && (
        <a
          href={wa}
          target="_blank"
          rel="noopener noreferrer"
          className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-whatsapp text-[14px] font-bold text-primary hover:opacity-90"
        >
          <MessageCircle className="h-4 w-4" aria-hidden="true" /> Escribir a la tienda por este pedido
        </a>
      )}
    </section>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-baseline justify-between gap-3">
      <dt className="text-on-surface-variant">{label}</dt>
      <dd className="text-right font-semibold text-on-surface">{value}</dd>
    </div>
  );
}
