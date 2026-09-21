import { useEffect, useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { Clock } from "lucide-react";
import { VerifiedBadge } from "./ui/VerifiedBadge.jsx";
import { api } from "../lib/api.js";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

function remaining(expiresAt) {
  const ms = new Date(expiresAt).getTime() - Date.now();
  if (ms <= 0) return null;
  const days = Math.floor(ms / 86400000);
  const hours = Math.floor((ms % 86400000) / 3600000);
  if (days >= 1) return `${days}d ${hours}h`;
  const minutes = Math.floor((ms % 3600000) / 60000);
  return `${hours}h ${minutes}m`;
}

// Bloque 51: "reloj" con el tiempo restante (pedido explícito) — se
// recalcula 1 vez por minuto, no por segundo: es una insignia de marketing
// sobre una grilla con varias tarjetas a la vez, no un cronómetro de
// precisión. expiresAt null (ofertas de admin sin vencimiento) = sin reloj.
function useCountdownLabel(expiresAt) {
  const [label, setLabel] = useState(() => (expiresAt ? remaining(expiresAt) : null));
  useEffect(() => {
    if (!expiresAt) return;
    setLabel(remaining(expiresAt));
    const id = setInterval(() => setLabel(remaining(expiresAt)), 60000);
    return () => clearInterval(id);
  }, [expiresAt]);
  return label;
}

// PRODUCT: el link tiene que armarse con el slug del vendedor DUEÑO DEL
// PRODUCTO, no el de la oferta — en una oferta PRODUCT creada por el admin,
// offer.vendor es null (no la creó ningún vendedor) pero el producto sigue
// siendo de alguno (offer.product.vendor.slug, agregado en offers.controller.js
// justo para esto). CUSTOM: lleva a la tienda si la creó un vendedor: una
// CUSTOM del admin (sin producto ni tienda propia) no es clickeable. HTML:
// nunca es un <Link> — el propio HTML del admin trae sus links/CTA.
//
// Bloque 192 (pedido explícito — "al crear una oferta desde admin, el
// admin puede agregar un botón a la oferta y un enlace también"):
// `offer.buttonUrl` (exclusivo de ofertas de admin) tiene PRIORIDAD sobre
// este auto-detectado — es justo lo que le da destino real a una CUSTOM del
// admin (que si no, no era clickeable, como dice el comentario de arriba).
function offerLinkTo(offer) {
  if (offer.buttonUrl) return offer.buttonUrl;
  if (offer.contentType === "PRODUCT" && offer.product) {
    const vendorSlug = offer.vendor?.slug ?? offer.product.vendor?.slug;
    if (vendorSlug) return `/producto/${vendorSlug}/${offer.product.slug}`;
  }
  if (offer.contentType === "CUSTOM" && offer.vendor) {
    return `/tienda/${offer.vendor.slug}`;
  }
  return null;
}

function isExternalUrl(url) {
  return /^https?:\/\//.test(url);
}

function OfferCard({ offer }) {
  const countdown = useCountdownLabel(offer.expiresAt);
  const to = offerLinkTo(offer);
  const external = to && isExternalUrl(to);

  if (offer.contentType === "HTML") {
    return <div className="relative h-full w-full overflow-hidden rounded-3xl shadow-lg" dangerouslySetInnerHTML={{ __html: offer.htmlContent }} />;
  }

  const content = (
    <>
      <img
        src={imgUrl(offer.imageUrl)}
        alt={offer.title}
        className="h-full w-full object-cover"
        draggable={false}
      />
      <div className="absolute inset-0 bg-gradient-to-t from-black/85 via-black/20 to-transparent" />
      {offer.discountLabel && (
        <span className="absolute right-3 top-3 rounded-full bg-error px-2.5 py-1 text-[11px] font-bold text-white shadow">
          {offer.discountLabel}
        </span>
      )}
      {countdown && (
        <span className="absolute left-3 top-3 flex items-center gap-1 rounded-full bg-black/55 px-2 py-1 text-[10.5px] font-bold text-white backdrop-blur-sm">
          <Clock className="h-3 w-3" /> {countdown}
        </span>
      )}
      <div className="absolute inset-x-0 bottom-0 p-3.5 sm:p-4">
        <div className="mb-0.5 flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wide text-white/80">
          {offer.createdByAdmin ? "Oferta oficial" : offer.vendor?.companyName}
          {offer.vendor?.isVerified && <VerifiedBadge size="sm" />}
        </div>
        <div className="font-display text-lg font-extrabold leading-tight text-white sm:text-xl">{offer.title}</div>
        {offer.tagline && <p className="line-clamp-1 text-[12px] text-white/85">{offer.tagline}</p>}
        {/* Bloque 192 (bug real reportado en vivo — "la descripción de las
            ofertas que se crean en el panel de admin no se muestran en las
            ofertas ya publicadas"): antes NUNCA se renderizaba en ningún
            lado, ni para ofertas de admin ni de vendedor — la tarjeta solo
            mostraba tagline. line-clamp-2 porque la tarjeta es chica (12:5),
            un texto largo la desbordaría. */}
        {offer.description && <p className="mt-0.5 line-clamp-2 text-[11.5px] text-white/75">{offer.description}</p>}
        {offer.buttonLabel && offer.buttonUrl && (
          <span className="mt-2 inline-flex items-center rounded-full bg-white px-3 py-1.5 text-[11.5px] font-bold text-on-surface shadow">
            {offer.buttonLabel}
          </span>
        )}
      </div>
    </>
  );

  const cardClass = "group relative block h-full w-full overflow-hidden rounded-3xl shadow-lg";

  if (!to) return <div className={cardClass}>{content}</div>;
  // Bloque 192: un enlace externo (http/https) nunca es un <Link> de
  // react-router — sería tratarlo como una ruta interna inexistente. `<a>`
  // normal, con target _blank + rel de seguridad de siempre.
  return external ? (
    <a href={to} target="_blank" rel="noopener noreferrer" className={cardClass}>
      {content}
    </a>
  ) : (
    <Link to={to} className={cardClass}>
      {content}
    </Link>
  );
}

// Bloque 154 (pedido explícito): "Ofertas de la semana" deja de ser una
// grilla tipo ladrillos con rotación por ventana y pasa a ser un carrusel
// que se desliza solo, infinito — 1 tarjeta a la vez en mobile, 2 o 3 en
// pantallas más grandes según el ancho (puramente por CSS con anchos
// responsivos, sin JS escuchando resize). AUTOPLAY_MS de cada sentido es
// distinto a propósito (ver más abajo, componente reverse=true) para que
// las dos secciones del Home no queden nunca sincronizadas mostrando lo
// mismo en el mismo instante.
const AUTOPLAY_MS = 4200;
const AUTOPLAY_MS_REVERSE = 4900;
const SLIDE_TRANSITION_MS = 600;
// Cuántas copias de la lista de ofertas arma el "riel" del carrusel — da
// colchón de sobra para el máximo de 3 tarjetas visibles a la vez en
// cualquiera de los 2 sentidos, incluso con muy pocas ofertas activas
// (probado con 1, 2 y 5). No depende del breakpoint actual: es fijo y de
// sobra para cualquier ancho de pantalla soportado.
const RAIL_COPIES = 4;

// Avanza/retrocede un índice sobre un riel de `RAIL_COPIES` copias idénticas
// de la lista y, al llegar al borde de una copia, "teletransporta" el índice
// a la posición equivalente de la copia anterior/siguiente SIN transición —
// como el contenido en esa posición es idéntico (es la misma lista
// repetida), el salto es invisible y el loop se siente infinito de verdad.
function useRailIndex(length, reverse, intervalMs) {
  const [index, setIndex] = useState(() => (reverse ? length : 0));
  const [smooth, setSmooth] = useState(true);

  useEffect(() => {
    if (length <= 1) return undefined;
    const id = setInterval(() => setIndex((i) => (reverse ? i - 1 : i + 1)), intervalMs);
    return () => clearInterval(id);
  }, [length, reverse, intervalMs]);

  useEffect(() => {
    if (smooth) return undefined;
    const raf = requestAnimationFrame(() => setSmooth(true));
    return () => cancelAnimationFrame(raf);
  }, [smooth]);

  function handleTransitionEnd(e) {
    // Ignora transitionend que burbujea desde algo adentro de una tarjeta —
    // solo interesa la transición del propio riel (transform).
    if (e.target !== e.currentTarget) return;
    if (!reverse && index === length) {
      setSmooth(false);
      setIndex(0);
    } else if (reverse && index === 0) {
      setSmooth(false);
      setIndex(length);
    }
  }

  return { index, smooth, handleTransitionEnd };
}

// reverse=true: misma lista de ofertas pero en orden invertido Y
// deslizándose hacia el sentido contrario (pedido explícito, para la
// sección duplicada debajo de "Abre tu tienda online gratis") — así ninguna
// de las 2 secciones del Home muestra la misma oferta en la misma posición
// en el mismo momento.
export function OffersSlider({ offers, reverse = false }) {
  const length = offers?.length ?? 0;
  const base = useMemo(() => (reverse ? [...offers].reverse() : offers), [offers, reverse]);
  const rail = useMemo(() => Array.from({ length: RAIL_COPIES }, () => base).flat(), [base]);
  const intervalMs = reverse ? AUTOPLAY_MS_REVERSE : AUTOPLAY_MS;
  const { index, smooth, handleTransitionEnd } = useRailIndex(length, reverse, intervalMs);

  if (!length) return null;

  if (length === 1) {
    return (
      <div className="aspect-[12/5] w-full">
        <OfferCard offer={offers[0]} />
      </div>
    );
  }

  return (
    <div className="overflow-hidden [--slide-step:100%] sm:[--slide-step:50%] lg:[--slide-step:33.3333%]">
      <div
        className="flex"
        onTransitionEnd={handleTransitionEnd}
        style={{
          transform: `translateX(calc(var(--slide-step) * ${-index}))`,
          transition: smooth ? `transform ${SLIDE_TRANSITION_MS}ms ease` : "none",
        }}
      >
        {rail.map((o, i) => (
          <div key={`${o.id}-${i}`} className="w-full flex-none px-1.5 sm:w-1/2 sm:px-2 lg:w-1/3">
            <div className="aspect-[12/5]">
              <OfferCard offer={o} />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
