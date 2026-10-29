import { useEffect, useMemo, useRef } from "react";
import { useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { imgUrl } from "../../lib/imgUrl.js";
import { readableAccent } from "../../lib/readableAccent.js";
import { ScreenClock } from "../../components/pos/ScreenClock.jsx";
import { LiveShowcase } from "../../components/pos/LiveShowcase.jsx";

// Pantalla para el cliente en el mostrador (tablet o monitor), abierta con el enlace secreto del panel > Caja > Pantallas.
// Solo lectura y se actualiza cada segundo y medio:
//  - Sin venta: la vitrina animada (components/pos/LiveShowcase.jsx) o la imagen fija, según eligió la tienda.
//  - Venta en curso: lo último escaneado en grande con su foto, y la lista completa con fotos, cantidades y el total.
//  - Al cobrar: el número del pedido, a nombre de quién, qué lleva y el vuelto.
const fmt = (n, cur) => `${Number(n ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${cur ?? ""}`.trim();
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

function Shell({ vendor, accent, children }) {
  return (
    <div className="fixed inset-0 flex flex-col bg-primary text-white">
      <header className="flex items-center justify-between gap-4 border-b border-white/10 px-6 py-4">
        <div className="flex min-w-0 items-center gap-3">
          {vendor.logoUrl && <img src={imgUrl(vendor.logoUrl)} alt="" className="h-14 w-14 flex-shrink-0 rounded-full bg-white object-cover" />}
          <p className="truncate font-display text-[24px] font-extrabold sm:text-[28px]">{vendor.name}</p>
        </div>
        <ScreenClock timezone={vendor.timezone} />
      </header>
      <div className="relative flex min-h-0 flex-1">{children}</div>
      <div className="h-1.5 flex-shrink-0" style={{ background: accent }} aria-hidden="true" />
    </div>
  );
}

function Thumb({ src, name, className }) {
  return src ? (
    <img src={imgUrl(src)} alt="" className={`flex-shrink-0 rounded-2xl bg-white object-cover ${className}`} />
  ) : (
    <span className={`flex flex-shrink-0 items-center justify-center rounded-2xl bg-white/10 font-display font-extrabold text-white/70 ${className}`}>{name?.[0]}</span>
  );
}

// En reposo: imagen fija (si la tienda la eligió) o la vitrina animada.
function Idle({ data, accent }) {
  if (data.idleMode === "IMAGE" && data.idleImageUrl) {
    return (
      <div className="flex flex-1 items-center justify-center bg-black">
        <img src={imgUrl(data.idleImageUrl)} alt={data.vendor.name} className="h-full w-full object-contain" />
      </div>
    );
  }
  return <LiveShowcase showcase={data.showcase ?? { products: [], spotlight: [], offers: [] }} vendor={data.vendor} accent={accent} />;
}

// Venta en curso: a la izquierda lo último que se escaneó; a la derecha la lista completa y el total.
function ActiveSale({ sale, accent }) {
  const listRef = useRef(null);
  const last = useMemo(() => [...sale.items].sort((a, b) => (b.addedAt ?? 0) - (a.addedAt ?? 0))[0], [sale.items]);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [sale.items.length, sale.total]);

  return (
    <div className="flex min-h-0 flex-1 flex-col lg:flex-row">
      {last && (
        <section key={`${last.name}-${last.addedAt}-${last.quantity}`} className={`flex flex-shrink-0 items-center gap-5 border-b border-white/10 px-6 py-5 lg:w-[42%] lg:flex-col lg:justify-center lg:border-b-0 lg:border-r lg:py-8 ${reduceMotion() ? "" : "animate-fade-up"}`} aria-label="Último producto agregado">
          <Thumb src={last.image} name={last.name} className="h-28 w-28 text-[40px] lg:h-[34vh] lg:w-[34vh] lg:max-w-full" />
          <div className="min-w-0 lg:text-center">
            <p className="text-[14px] font-bold uppercase tracking-[0.14em]" style={{ color: accent }}>Agregado</p>
            <p className="mt-1 line-clamp-2 font-display text-[26px] font-extrabold leading-tight lg:text-[32px]">{last.name}</p>
            <p className="mt-1 text-[20px] text-white/80">
              {last.quantity} × {fmt(last.price, sale.currency)}
            </p>
          </div>
        </section>
      )}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex items-center justify-between px-6 pt-4 text-[15px] text-white/60">
          <span>Pedido <b className="font-display text-[20px] tracking-[0.12em] text-white">{sale.code}</b>{sale.customerName ? ` · ${sale.customerName}` : ""}</span>
          <span>{sale.units} {sale.units === 1 ? "producto" : "productos"}</span>
        </div>
        <ul ref={listRef} className="flex-1 divide-y divide-white/10 overflow-y-auto px-6">
          {sale.items.map((i, idx) => (
            <li key={`${i.name}-${idx}`} className="flex items-center gap-4 py-3">
              <Thumb src={i.image} name={i.name} className="h-14 w-14 text-[20px]" />
              <div className="min-w-0 flex-1">
                <p className="truncate text-[19px] font-semibold sm:text-[21px]">{i.name}</p>
                <p className="text-[15px] text-white/60">
                  {i.quantity} × {fmt(i.price, sale.currency)}
                </p>
              </div>
              <span className="flex-shrink-0 text-[19px] font-bold sm:text-[21px]">{fmt(i.price * i.quantity, sale.currency)}</span>
            </li>
          ))}
        </ul>
        <footer className="flex items-center justify-between gap-4 border-t border-white/15 px-6 py-5">
          <span className="text-[24px] text-white/80">Total</span>
          <span className="font-display text-[42px] font-extrabold leading-none sm:text-[52px]" style={{ color: accent }}>
            {fmt(sale.total, sale.currency)}
          </span>
        </footer>
      </div>
    </div>
  );
}

function Done({ sale, state, accent }) {
  return (
    <div className={`flex flex-1 flex-col items-center justify-center px-6 text-center ${reduceMotion() ? "" : "animate-fade-up"}`}>
      <p className="text-[24px] text-white/85">{state === "paid" ? "¡Gracias por tu compra!" : "Tu pedido va a la mesa"}</p>
      <p className="mt-3 text-[18px] text-white/65">Tu número es</p>
      <p className="font-display text-[100px] font-extrabold leading-none tracking-[0.12em] sm:text-[130px]" style={{ color: accent }}>
        {sale.code}
      </p>
      {sale.customerName && <p className="mt-2 text-[28px] font-bold">{sale.customerName}</p>}
      <div className="mt-5 flex max-w-full flex-wrap justify-center gap-2">
        {sale.items.slice(0, 6).map((i, idx) => (
          <span key={`${i.name}-${idx}`} className="flex items-center gap-2 rounded-full bg-white/10 py-1 pl-1 pr-3 text-[15px]">
            <Thumb src={i.image} name={i.name} className="h-8 w-8 rounded-full text-[12px]" />
            {i.quantity}× {i.name}
          </span>
        ))}
        {sale.items.length > 6 && <span className="rounded-full bg-white/10 px-3 py-1.5 text-[15px]">y {sale.items.length - 6} más</span>}
      </div>
      <p className="mt-5 text-[22px] text-white/80">Total {fmt(sale.total, sale.currency)}</p>
      {state === "paid" && sale.change > 0 && <p className="mt-2 text-[30px] font-bold">Tu vuelto: {fmt(sale.change, sale.currency)}</p>}
      {state === "paid" && <p className="mt-4 text-[17px] text-white/60">Te avisamos en la pantalla de pedidos cuando esté listo.</p>}
    </div>
  );
}

export default function PosDisplay() {
  const { token } = useParams();
  const { data, error } = useQuery({
    queryKey: ["pos-display", token],
    queryFn: async () => (await api.get(`/pos/display/${token}`)).data,
    refetchInterval: 1500,
    refetchIntervalInBackground: true,
    retry: (count, err) => err?.response?.status !== 404 && count < 3,
  });
  useEffect(() => {
    document.title = data?.vendor?.name ? `${data.vendor.name} · Caja` : "Caja";
  }, [data?.vendor?.name]);

  if (error?.response?.status === 404) {
    return <div className="fixed inset-0 flex items-center justify-center bg-primary px-6 text-center text-[18px] text-white/85">{error.response.data?.error ?? "Este enlace ya no es válido."}</div>;
  }
  if (!data) return <div className="fixed inset-0 flex items-center justify-center bg-primary text-[18px] text-white/70">Conectando...</div>;

  const accent = readableAccent(data.vendor.color);
  return (
    <Shell vendor={data.vendor} accent={accent}>
      {data.state === "idle" && <Idle data={data} accent={accent} />}
      {data.state === "active" && <ActiveSale sale={data.sale} accent={accent} />}
      {(data.state === "paid" || data.state === "table") && <Done sale={data.sale} state={data.state} accent={accent} />}
    </Shell>
  );
}
