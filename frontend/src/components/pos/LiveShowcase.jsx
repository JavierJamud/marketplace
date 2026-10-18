import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { Flame, Sparkles, Tag, TicketPercent } from "lucide-react";
import { imgUrl } from "../../lib/imgUrl.js";

// Vitrina animada de la pantalla del cliente cuando no hay venta en curso. Funciona como alguien que recorre la tienda:
//  1. "browse": la cuadrícula con todos los productos se desplaza sola, despacio;
//  2. "pick": se resalta un producto destacado (más demanda, oferta o novedad, en ese orden: lo decide el servidor);
//  3. "open": ese producto se abre en grande desde su lugar en la cuadrícula, con foto, motivo, descripción y precio;
//  4. "close": vuelve a su lugar y sigue el recorrido con el siguiente. Las ofertas de la tienda se abren intercaladas.
// Con "reducir movimiento" activado en el dispositivo, todo cambia sin desplazamientos ni zoom.
const BROWSE_MS = 5500;
const PICK_MS = 1300;
const OPEN_MS = 7500;
const MORPH_MS = 650;
const STEP_PX = 300;
// Con pocos productos la cuadrícula se repite hasta llenar la pantalla: el recorrido se ve como un catálogo continuo.
const MIN_CARDS = 16;

const fmt = (n, cur) => `${Number(n ?? 0).toLocaleString("es-CU", { maximumFractionDigits: 2 })} ${cur ?? ""}`.trim();
const reduceMotion = () => typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
const REASON_ICON = { demand: Flame, offer: Tag, new: Sparkles, popular: Sparkles };

function Card({ p, active, accent, cardRef }) {
  const Icon = REASON_ICON[p.reason?.kind] ?? Sparkles;
  return (
    <li
      ref={cardRef}
      className={`overflow-hidden rounded-3xl bg-white/[0.06] transition-[transform,box-shadow,opacity] duration-500 ${active ? "z-10 scale-[1.06]" : ""}`}
      style={active ? { boxShadow: `0 0 0 4px ${accent}, 0 30px 80px -20px rgba(0,0,0,0.7)` } : undefined}
    >
      <div className="relative aspect-square bg-white">
        <img src={imgUrl(p.image)} alt="" className="h-full w-full object-contain" loading="lazy" />
        {p.reason?.kind !== "popular" && (
          <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full px-2.5 py-1 text-[13px] font-bold text-[#0e1a28]" style={{ background: accent }}>
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {p.reason.kind === "offer" ? p.reason.label.replace("Oferta: ", "") : p.reason.kind === "new" ? "Nuevo" : "Popular"}
          </span>
        )}
      </div>
      <div className="p-4">
        <p className="line-clamp-2 min-h-[48px] text-[18px] font-bold leading-6">{p.name}</p>
        <p className="mt-1 flex items-baseline gap-2">
          <span className="text-[22px] font-extrabold" style={{ color: accent }}>
            {fmt(p.price, p.currency)}
          </span>
          {p.oldPrice > p.price && <span className="text-[15px] text-white/45 line-through">{fmt(p.oldPrice, p.currency)}</span>}
        </p>
      </div>
    </li>
  );
}

function ProductDetail({ p, accent }) {
  const Icon = REASON_ICON[p.reason?.kind] ?? Sparkles;
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (p.images.length < 2) return undefined;
    const t = setInterval(() => setShown((i) => (i + 1) % p.images.length), 2400);
    return () => clearInterval(t);
  }, [p.images.length]);
  return (
    <div className="flex h-full flex-col gap-8 p-8 md:flex-row md:items-center md:p-12">
      <div className="flex min-h-0 flex-1 flex-col gap-3 md:h-full">
        <div className="min-h-0 flex-1 overflow-hidden rounded-[32px] bg-white">
          <img key={shown} src={imgUrl(p.images[shown] ?? p.image)} alt="" className="h-full w-full object-contain motion-safe:animate-fade-up" />
        </div>
        {p.images.length > 1 && (
          <div className="flex justify-center gap-2">
            {p.images.map((src, i) => (
              <img key={src} src={imgUrl(src)} alt="" className={`h-14 w-14 rounded-xl bg-white object-cover transition-opacity ${i === shown ? "opacity-100 ring-2" : "opacity-50"}`} style={i === shown ? { "--tw-ring-color": accent } : undefined} />
            ))}
          </div>
        )}
      </div>
      <div className="min-w-0 md:w-[44%]">
        <p className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[16px] font-bold text-[#0e1a28]" style={{ background: accent }}>
          <Icon className="h-4 w-4" aria-hidden="true" /> {p.reason?.label}
        </p>
        <p className="mt-5 font-display text-[40px] font-extrabold leading-[1.1] lg:text-[52px]">{p.name}</p>
        {p.description && <p className="mt-4 text-[20px] leading-[30px] text-white/75">{p.description}</p>}
        <p className="mt-6 flex flex-wrap items-baseline gap-4">
          <span className="font-display text-[56px] font-extrabold leading-none lg:text-[68px]" style={{ color: accent }}>
            {fmt(p.price, p.currency)}
          </span>
          {p.oldPrice > p.price && <span className="text-[26px] text-white/45 line-through">{fmt(p.oldPrice, p.currency)}</span>}
        </p>
        <p className="mt-6 text-[18px] text-white/60">Pídelo en caja</p>
      </div>
    </div>
  );
}

function OfferDetail({ o, accent }) {
  return (
    <div className="flex h-full flex-col items-center justify-center p-10 text-center">
      <p className="inline-flex items-center gap-2 rounded-full px-4 py-1.5 text-[17px] font-bold text-[#0e1a28]" style={{ background: accent }}>
        <TicketPercent className="h-5 w-5" aria-hidden="true" /> Oferta de la tienda
      </p>
      <p className="mt-6 max-w-4xl font-display text-[48px] font-extrabold leading-tight lg:text-[64px]">{o.title}</p>
      {o.description && <p className="mt-4 max-w-3xl text-[22px] leading-[32px] text-white/75">{o.description}</p>}
      <p className="mt-8 text-[20px] text-white/70">Dile este código al pagar</p>
      <p className="mt-2 rounded-3xl border-4 border-dashed px-10 py-4 font-display text-[64px] font-extrabold tracking-[0.12em] lg:text-[84px]" style={{ borderColor: accent, color: accent }}>
        {o.code}
      </p>
      <p className="mt-4 text-[26px] font-bold">{typeof o.discount === "number" ? `${fmt(o.discount)} de descuento` : `${o.discount} de descuento`}</p>
    </div>
  );
}

export function LiveShowcase({ showcase, vendor, accent }) {
  const products = showcase.products;
  const cards = useMemo(() => {
    if (!products.length) return [];
    const out = [];
    for (let round = 0; out.length < Math.max(MIN_CARDS, products.length); round++) products.forEach((p) => out.push({ p, round }));
    return out;
  }, [products]);
  // Recorrido: productos destacados con una oferta intercalada cada dos.
  const stops = useMemo(() => {
    const list = [];
    const offers = [...showcase.offers];
    showcase.spotlight.forEach((id, i) => {
      list.push({ kind: "product", id });
      if (i % 2 === 1 && offers.length) list.push({ kind: "offer", offer: offers.shift() });
    });
    offers.forEach((offer) => list.push({ kind: "offer", offer }));
    return list;
  }, [showcase.spotlight, showcase.offers]);

  const frameRef = useRef(null);
  const trackRef = useRef(null);
  const cardRefs = useRef(new Map());
  const [phase, setPhase] = useState("browse");
  const [stopIndex, setStopIndex] = useState(0);
  const [scroll, setScroll] = useState(0);
  const [scrollMs, setScrollMs] = useState(BROWSE_MS);
  const [box, setBox] = useState(null); // rectángulo del panel que se abre (para la transición desde la tarjeta)
  const [pickedKey, setPickedKey] = useState(null); // la copia de la tarjeta elegida (con pocos productos hay varias)
  const still = reduceMotion();
  const stop = stops.length ? stops[stopIndex % stops.length] : null;
  const product = stop?.kind === "product" ? products.find((p) => p.id === stop.id) : null;

  const maxScroll = () => Math.max(0, (trackRef.current?.scrollHeight ?? 0) - (frameRef.current?.clientHeight ?? 0));
  const cardBox = () => {
    const frame = frameRef.current?.getBoundingClientRect();
    const card = pickedKey ? cardRefs.current.get(pickedKey)?.getBoundingClientRect() : null;
    if (!frame) return null;
    if (!card) return { left: frame.width * 0.3, top: frame.height * 0.3, width: frame.width * 0.4, height: frame.height * 0.4 };
    return { left: card.left - frame.left, top: card.top - frame.top, width: card.width, height: card.height };
  };

  // Máquina de estados del recorrido.
  useEffect(() => {
    if (!stops.length) return undefined;
    let t;
    if (phase === "browse") {
      setScrollMs(still ? 0 : BROWSE_MS);
      setScroll((s) => (s + STEP_PX > maxScroll() ? 0 : s + STEP_PX));
      t = setTimeout(() => setPhase("pick"), BROWSE_MS);
    } else if (phase === "pick") {
      // Se elige la copia de la tarjeta más cercana a lo que se ve y se la lleva a la vista antes de abrirla.
      const frameH = frameRef.current?.clientHeight ?? 0;
      let best = null;
      if (product) {
        for (const [key, el] of cardRefs.current) {
          if (!key.startsWith(`${product.id}::`)) continue;
          const d = Math.abs(el.offsetTop - (scroll + frameH / 3));
          if (!best || d < best.d) best = { key, el, d };
        }
      }
      setPickedKey(best?.key ?? null);
      if (best && frameRef.current) {
        const target = Math.min(maxScroll(), Math.max(0, best.el.offsetTop - frameH / 3));
        setScrollMs(still ? 0 : 900);
        setScroll(target);
      }
      t = setTimeout(() => setPhase("open"), still ? 200 : PICK_MS);
    } else if (phase === "open") {
      t = setTimeout(() => setPhase("close"), OPEN_MS);
    } else if (phase === "close") {
      t = setTimeout(() => {
        setBox(null);
        setPickedKey(null);
        setStopIndex((i) => i + 1);
        setPhase("browse");
      }, still ? 0 : MORPH_MS);
    }
    return () => clearTimeout(t);
  }, [phase, stops.length]); // eslint-disable-line react-hooks/exhaustive-deps

  // Al abrir: el panel nace con el tamaño y la posición de la tarjeta y crece hasta ocupar todo. Al cerrar, vuelve a la tarjeta.
  useLayoutEffect(() => {
    if (phase === "open") {
      const from = cardBox();
      setBox({ ...from, full: false });
      const r = requestAnimationFrame(() => requestAnimationFrame(() => setBox((b) => (b ? { ...b, full: true } : b))));
      return () => cancelAnimationFrame(r);
    }
    if (phase === "close") setBox((b) => (b ? { ...cardBox(), full: false, closing: true } : b));
    return undefined;
  }, [phase]); // eslint-disable-line react-hooks/exhaustive-deps

  if (!products.length && !showcase.offers.length) {
    return (
      <div className="flex flex-1 flex-col items-center justify-center px-6 text-center">
        {vendor.logoUrl && <img src={imgUrl(vendor.logoUrl)} alt="" className="mb-6 h-36 w-36 rounded-full bg-white object-cover" />}
        <p className="font-display text-[44px] font-extrabold">{vendor.name}</p>
        <p className="mt-2 text-[20px] text-white/70">Bienvenido</p>
      </div>
    );
  }

  const activeKey = (phase === "pick" || phase === "open") && product ? pickedKey : null;
  const panelStyle = box
    ? box.full
      ? { left: 0, top: 0, width: "100%", height: "100%", borderRadius: 0, opacity: 1 }
      : { left: box.left, top: box.top, width: box.width, height: box.height, borderRadius: 24, opacity: box.closing ? 0 : 1 }
    : null;

  return (
    <div ref={frameRef} className="relative flex-1 overflow-hidden">
      <div
        ref={trackRef}
        className="px-8 py-6"
        style={{ transform: `translateY(-${scroll}px)`, transition: scrollMs ? `transform ${scrollMs}ms ${scrollMs === BROWSE_MS ? "linear" : "cubic-bezier(.2,.8,.2,1)"}` : "none" }}
      >
        <ul className="grid grid-cols-2 gap-6 md:grid-cols-3 xl:grid-cols-4">
          {cards.map(({ p, round }) => (
            <Card
              key={`${p.id}-${round}`}
              p={p}
              accent={accent}
              active={activeKey === `${p.id}::${round}`}
              cardRef={(el) => (el ? cardRefs.current.set(`${p.id}::${round}`, el) : cardRefs.current.delete(`${p.id}::${round}`))}
            />
          ))}
        </ul>
      </div>
      {/* Degradados arriba y abajo: la cuadrícula entra y sale de la pantalla en vez de cortarse en seco. */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-12 bg-gradient-to-b from-[#0e1a28] to-transparent" aria-hidden="true" />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-20 bg-gradient-to-t from-[#0e1a28] to-transparent" aria-hidden="true" />

      {panelStyle && (stop?.kind === "offer" || product) && (
        <div
          className="absolute z-20 overflow-hidden bg-[#13243a] shadow-[0_40px_120px_-20px_rgba(0,0,0,0.8)]"
          style={{ ...panelStyle, transition: still ? "none" : `all ${MORPH_MS}ms cubic-bezier(.2,.8,.2,1)` }}
        >
          <div className={`h-full w-full transition-opacity duration-300 ${box?.full ? "opacity-100 delay-300" : "opacity-0"}`}>
            {stop.kind === "offer" ? <OfferDetail o={stop.offer} accent={accent} /> : <ProductDetail p={product} accent={accent} />}
          </div>
        </div>
      )}
    </div>
  );
}
