import { useMemo } from "react";
import { Link } from "react-router-dom";
import { ArrowRight, UtensilsCrossed } from "lucide-react";
import { VerifiedBadge } from "./ui/VerifiedBadge.jsx";
import { StarRating } from "./ui/StarRating.jsx";
import { getBannerIconPattern } from "../lib/vendorBannerIcons.js";
import { api } from "../lib/api.js";

const PALETTE = ["#232F3E", "#337475", "#8A5100", "#643900", "#0e1a28", "#003435"];
function colorFor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

const DESCRIPTION_LIMIT = 90;
function truncateDescription(text) {
  if (text.length <= DESCRIPTION_LIMIT) return { short: text, truncated: false };
  return { short: text.slice(0, DESCRIPTION_LIMIT).trimEnd(), truncated: true };
}

// Bloque 50 (pedido explícito post-entrega): la CompactStoreCard del Bloque
// 48 quedó demasiado pelada (sin descripción, sin "VERIFICADA", sin rubro) —
// se le devuelve el nivel de información de StoreCard.jsx (Stores.jsx) pero
// en un tamaño intermedio (header/avatar entre el original de 120px/48px y
// el achicado de 90px/34px), más un par de toques modernos (hover con
// elevación + zoom sutil de la portada) que StoreCard.jsx no tiene — sigue
// siendo un componente aparte, no una variante con props (mismo criterio
// que ya dejó documentado el Bloque 48).
export function CompactStoreCard({ vendor }) {
  const color = vendor.color ?? colorFor(vendor.id);
  const location = vendor.locations?.[0];
  const description = vendor.description ? truncateDescription(vendor.description) : null;
  // Bloque 207 (pedido explícito): mismo patrón de íconos del banner grande
  // (Store.jsx), a menor densidad — esta tarjeta es mucho más chica.
  const iconPattern = useMemo(
    () => getBannerIconPattern(vendor, { cols: 7, rows: 4, minSize: 12, maxSize: 24 }),
    [vendor.id, vendor.isRestaurant, vendor.businessCategory?.slug]
  );

  return (
    <Link
      to={`/tienda/${vendor.slug}`}
      className="group flex h-full flex-col overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest shadow-sm transition-all duration-200 hover:-translate-y-0.5 hover:shadow-lg"
    >
      <div className="relative h-[104px] w-full overflow-hidden" style={{ background: color }}>
        <div className="pointer-events-none absolute inset-0 overflow-hidden">
          {iconPattern.map(({ key, Icon, top, left, size, rotate, opacity, strokeWidth }) => (
            <Icon
              key={key}
              strokeWidth={strokeWidth}
              className="absolute text-white"
              style={{ top, left, width: size, height: size, transform: `translate(-50%, -50%) rotate(${rotate}deg)`, opacity }}
            />
          ))}
        </div>
        <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-primary/10 to-transparent" />
        {vendor.isVerified && (
          <div className="absolute right-2.5 top-2.5 flex items-center gap-1 rounded-full bg-white/95 py-1 pl-1 pr-2">
            <VerifiedBadge size="sm" />
            <span className="text-[9px] font-bold text-primary">VERIFICADA</span>
          </div>
        )}
        <div className="absolute bottom-2.5 left-3 right-3 flex items-center gap-2">
          <span
            className="flex h-10 w-10 flex-shrink-0 items-center justify-center overflow-hidden rounded-full border border-white font-display text-[15px] font-bold text-white shadow"
            style={{ background: color }}
          >
            {vendor.logoUrl ? (
              <img src={imgUrl(vendor.logoUrl)} alt={vendor.companyName} className="h-full w-full object-cover" />
            ) : (
              vendor.companyName?.[0]
            )}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[13px] font-bold text-white drop-shadow">{vendor.companyName}</div>
            {location && (
              <div className="truncate text-[10.5px] text-white/85 drop-shadow">
                {location.municipality?.name ?? location.province?.name}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-1 flex-col p-3.5">
        {description && (
          <p className="mb-2.5 text-[12px] leading-[17px] text-on-surface-variant">
            {description.short}
            {description.truncated && <span className="font-semibold text-tertiary-accent">...</span>}
          </p>
        )}
        <div className="mt-auto flex flex-col gap-1.5">
          <div className="flex items-center justify-between">
            <StarRating value={Number(vendor.rating ?? 0)} size="h-3 w-3" showValue />
            <span className="flex items-center gap-1 text-[11.5px] font-bold text-tertiary-accent">
              Ver <ArrowRight className="h-3 w-3 transition-transform group-hover:translate-x-0.5" />
            </span>
          </div>
          <div className="text-[11px] text-outline">
            {vendor._count?.products ?? 0} producto{vendor._count?.products === 1 ? "" : "s"}
            {" · "}
            {vendor.category?.name ?? (vendor.isRestaurant ? "Restaurante" : "Tienda")}
            {vendor.isRestaurant && <UtensilsCrossed className="ml-1 inline h-3 w-3 align-text-bottom" />}
          </div>
        </div>
      </div>
    </Link>
  );
}
