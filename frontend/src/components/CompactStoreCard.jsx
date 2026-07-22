import { Link } from "react-router-dom";
import { UtensilsCrossed } from "lucide-react";
import { VerifiedBadge } from "./ui/VerifiedBadge.jsx";
import { StarRating } from "./ui/StarRating.jsx";

const PALETTE = ["#232F3E", "#337475", "#8A5100", "#643900", "#0e1a28", "#003435"];
function colorFor(id) {
  let hash = 0;
  for (const ch of String(id)) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  return PALETTE[hash % PALETTE.length];
}

// Bloque 48 (pedido explícito): tarjeta más chica que StoreCard.jsx
// (header ~120px) — vuelve al tamaño que tenía antes de agrandarla,
// específicamente para el carrusel de tiendas verificadas del Home.
// StoreCard.jsx sigue igual (Stores.jsx, "Otras tiendas" de Store.jsx no
// se tocan) — es un componente aparte, no una variante con props.
export function CompactStoreCard({ vendor }) {
  const color = vendor.color ?? colorFor(vendor.id);
  const location = vendor.locations?.[0];

  return (
    <Link
      to={`/tienda/${vendor.slug}`}
      className="flex h-full flex-col overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest shadow-sm transition-shadow hover:shadow-md"
    >
      <div className="relative h-[90px] w-full" style={{ background: color }}>
        {vendor.coverUrl && <img src={vendor.coverUrl} alt="" className="h-full w-full object-cover" />}
        <div className="absolute inset-0 bg-gradient-to-t from-primary/80 via-primary/10 to-transparent" />
        {vendor.isVerified && (
          <div className="absolute right-2 top-2 flex items-center justify-center rounded-full bg-white/95 p-1">
            <VerifiedBadge size="sm" />
          </div>
        )}
        <div className="absolute bottom-2 left-2.5 right-2.5 flex items-center gap-2">
          <span
            className="flex h-[34px] w-[34px] flex-shrink-0 items-center justify-center rounded-full border-2 border-white font-display text-[13px] font-bold text-white shadow"
            style={{ background: color }}
          >
            {vendor.companyName?.[0]}
          </span>
          <div className="min-w-0">
            <div className="truncate text-[12.5px] font-bold text-white drop-shadow">{vendor.companyName}</div>
            {location && (
              <div className="truncate text-[10.5px] text-white/85 drop-shadow">
                {location.municipality?.name ?? location.province?.name}
              </div>
            )}
          </div>
        </div>
      </div>
      <div className="flex flex-1 items-center justify-between p-2.5">
        <StarRating value={Number(vendor.rating ?? 0)} size="h-3 w-3" showValue />
        <div className="text-[11px] text-outline">
          {vendor._count?.products ?? 0} prod.
          {vendor.isRestaurant && <UtensilsCrossed className="ml-1 inline h-3 w-3 align-text-bottom" />}
        </div>
      </div>
    </Link>
  );
}
