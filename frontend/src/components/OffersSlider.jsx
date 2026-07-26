import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { AnimatePresence, motion } from "framer-motion";
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

// Bloque 52 (follow-up, pedido explícito): contenedores más chicos que antes
// (auto-rows bajó de 110px a 84px, se sacó el row-span-4) — sigue variando
// tamaño/forma según orientación y posición, pero de forma más comedida, "no
// tan grandes". Los spans se quedan dentro de col-span-2 a propósito (nunca
// 3/4) para no desbordar la grilla de 2 columnas en mobile.
const VERTICAL_SPANS = ["col-span-1 row-span-2", "col-span-1 row-span-3", "col-span-2 row-span-3"];
const HORIZONTAL_SPANS = ["col-span-2 row-span-2", "col-span-1 row-span-2", "col-span-2 row-span-2"];

function spanFor(offer, index) {
  const spans = offer.orientation === "VERTICAL" ? VERTICAL_SPANS : HORIZONTAL_SPANS;
  return spans[index % spans.length];
}

// PRODUCT: el link tiene que armarse con el slug del vendedor DUEÑO DEL
// PRODUCTO, no el de la oferta — en una oferta PRODUCT creada por el admin,
// offer.vendor es null (no la creó ningún vendedor) pero el producto sigue
// siendo de alguno (offer.product.vendor.slug, agregado en offers.controller.js
// justo para esto). CUSTOM: lleva a la tienda si la creó un vendedor: una
// CUSTOM del admin (sin producto ni tienda propia) no es clickeable. HTML:
// nunca es un <Link> — el propio HTML del admin trae sus links/CTA.
function offerLinkTo(offer) {
  if (offer.contentType === "PRODUCT" && offer.product) {
    const vendorSlug = offer.vendor?.slug ?? offer.product.vendor?.slug;
    if (vendorSlug) return `/producto/${vendorSlug}/${offer.product.slug}`;
  }
  if (offer.contentType === "CUSTOM" && offer.vendor) {
    return `/tienda/${offer.vendor.slug}`;
  }
  return null;
}

// Ya no recibe `className` con el span — eso ahora vive en el motion.div
// contenedor (OffersSlider de abajo), así el layout de framer-motion anima
// el tamaño/posición del contenedor mientras esta tarjeta solo llena 100%.
function OfferCard({ offer }) {
  const countdown = useCountdownLabel(offer.expiresAt);
  const to = offerLinkTo(offer);

  if (offer.contentType === "HTML") {
    return <div className="relative h-full w-full overflow-hidden rounded-3xl shadow-lg" dangerouslySetInnerHTML={{ __html: offer.htmlContent }} />;
  }

  const content = (
    <>
      <img
        src={imgUrl(offer.imageUrl)}
        alt={offer.title}
        className="h-full w-full object-cover transition-transform duration-500 group-hover:scale-105"
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
      </div>
    </>
  );

  const cardClass = "group relative block h-full w-full overflow-hidden rounded-3xl shadow-lg";

  return to ? (
    <Link to={to} className={cardClass}>
      {content}
    </Link>
  ) : (
    <div className={cardClass}>{content}</div>
  );
}

const MAX_VISIBLE = 6;
const ROTATE_INTERVAL_MS = 6000;

// Bloque 52 (pedido explícito): "si hay más [ofertas] y no caben se irán
// intercambiando" — con más de MAX_VISIBLE activas, en vez de amontonarlas
// todas se muestra una ventana rotativa de MAX_VISIBLE que avanza sola cada
// pocos segundos. AnimatePresence+layout anima tanto la entrada/salida de la
// tarjeta que cambia como el reacomodo (tamaño/posición) de las que se
// quedan, porque spanFor() depende del índice DENTRO de la ventana visible,
// no de un id fijo — así cada rotación también les puede tocar otra forma.
export function OffersSlider({ offers }) {
  const [offset, setOffset] = useState(0);
  const needsRotation = offers.length > MAX_VISIBLE;

  useEffect(() => {
    if (!needsRotation) return;
    const id = setInterval(() => setOffset((o) => (o + 1) % offers.length), ROTATE_INTERVAL_MS);
    return () => clearInterval(id);
  }, [needsRotation, offers.length]);

  if (!offers.length) return null;

  if (offers.length === 1) {
    return (
      <div className="h-[280px] w-full">
        <OfferCard offer={offers[0]} />
      </div>
    );
  }

  const visible = needsRotation ? Array.from({ length: MAX_VISIBLE }, (_, i) => offers[(offset + i) % offers.length]) : offers;

  return (
    <div className="grid auto-rows-[84px] grid-cols-2 gap-3.5 sm:grid-cols-3 sm:gap-4 lg:grid-cols-4">
      <AnimatePresence mode="popLayout">
        {visible.map((o, i) => (
          <motion.div
            key={o.id}
            layout
            initial={{ opacity: 0, scale: 0.92 }}
            animate={{ opacity: 1, scale: 1 }}
            exit={{ opacity: 0, scale: 0.92 }}
            transition={{ duration: 0.45, ease: "easeOut" }}
            className={spanFor(o, i)}
          >
            <OfferCard offer={o} />
          </motion.div>
        ))}
      </AnimatePresence>
    </div>
  );
}
