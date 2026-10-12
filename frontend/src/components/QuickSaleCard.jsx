import { Link } from "react-router-dom";
import { MapPin, Package } from "lucide-react";
import { imgUrl, thumbUrl } from "../lib/imgUrl.js";
import { formatPrice } from "../lib/format.js";
import { conditionLabel } from "./customer/ListingFormFields.jsx";

// Tarjeta de un anuncio de venta rápida (la misma en la portada y en la página de venta rápida).
export function QuickSaleCard({ listing: l }) {
  // La grilla pide la miniatura; la foto grande queda de respaldo para los anuncios viejos que no tienen una generada.
  const image = imgUrl(l.images?.[0]);
  const thumb = thumbUrl(l.images?.[0]);
  return (
    <Link
      to={`/ventas-rapidas/${l.id}`}
      className="flex h-full flex-col overflow-hidden rounded-[22px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)] transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[7/4] w-full overflow-hidden bg-surface-container">
        {thumb ? (
          <img
            src={thumb}
            alt={l.name}
            loading="lazy"
            className="h-full w-full object-cover"
            onError={(e) => {
              if (e.currentTarget.src !== image) {
                e.currentTarget.onerror = null;
                e.currentTarget.src = image;
              }
            }}
          />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-outline">
            <Package className="h-8 w-8" />
          </div>
        )}
        <span className="absolute left-2 top-2 rounded-full bg-secondary-container px-2.5 py-1 text-[10.5px] font-bold text-on-secondary-container">Venta rápida</span>
      </div>
      <div className="flex flex-1 flex-col p-3">
        <div className="mb-0.5 truncate text-[13.5px] font-bold text-on-surface">{l.name}</div>
        <div className="text-[14px] font-bold text-secondary">{formatPrice(l.price, l.currency)}{(l.quantity > 1 || l.priceTiers?.length > 0) && <span className="ml-1 text-[11px] font-semibold text-outline">c/u</span>}</div>
        {(l.owner?.province?.name || conditionLabel(l.condition)) && (
          <div className="mt-1 flex items-center gap-1 text-[11.5px] text-outline">
            <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{[conditionLabel(l.condition), l.owner?.province?.name].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      </div>
    </Link>
  );
}
