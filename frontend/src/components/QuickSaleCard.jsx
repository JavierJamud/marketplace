import { Link } from "react-router-dom";
import { Eye, MapPin, Package } from "lucide-react";
import { imgUrl, thumbUrl } from "../lib/imgUrl.js";
import { formatPrice } from "../lib/format.js";
import { conditionLabel } from "./customer/ListingFormFields.jsx";
import { Skeleton } from "./ui/Skeleton.jsx";

// Tarjeta de un anuncio de venta rápida (la misma en la portada y en la página de venta rápida).
// Esqueleto del anuncio: misma foto 7/4, nombre, precio, lugar y el botón "Ver" pegado abajo a la derecha.
export function QuickSaleCardSkeleton() {
  return (
    <div aria-hidden="true" className="relative flex h-full flex-col overflow-hidden rounded-[22px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)]">
      <div className="aspect-[7/4] w-full">
        <Skeleton height="100%" borderRadius={0} containerClassName="block h-full leading-none" />
      </div>
      <div className="flex flex-1 flex-col p-3 pb-12">
        <Skeleton width="75%" height={14} />
        <Skeleton width="40%" height={16} />
        <Skeleton width="55%" height={11} className="mt-1" />
      </div>
      <div className="absolute bottom-0 right-0">
        <Skeleton width={72} height={40} borderRadius={0} containerClassName="block leading-none" />
      </div>
    </div>
  );
}

// `eager`: en el carrusel de la portada la foto se pide al momento. Con carga diferida, Safari y Chrome en iPhone a veces no la
// pedían dentro del carrusel (se mueve con transformaciones, no con scroll) y las tarjetas quedaban sin imagen hasta recargar.
export function QuickSaleCard({ listing: l, eager = false }) {
  // La grilla pide la miniatura; la foto grande queda de respaldo para los anuncios viejos que no tienen una generada.
  const image = imgUrl(l.images?.[0]);
  const thumb = thumbUrl(l.images?.[0]);
  return (
    <Link
      to={`/ventas-rapidas/${l.id}`}
      className="relative flex h-full flex-col overflow-hidden rounded-[22px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)] transition-shadow hover:shadow-lg"
    >
      <div className="relative aspect-[7/4] w-full overflow-hidden bg-surface-container">
        {thumb ? (
          <img
            src={thumb}
            alt={l.name}
            loading={eager ? "eager" : "lazy"}
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
        {(l.location?.province || conditionLabel(l.condition)) && (
          <div className="mt-1 flex items-center gap-1 pr-20 text-[11.5px] text-outline">
            <MapPin className="h-3 w-3 flex-shrink-0" aria-hidden="true" />
            <span className="truncate">{[conditionLabel(l.condition), [l.location?.municipality, l.location?.province].filter(Boolean).join(", ")].filter(Boolean).join(" · ")}</span>
          </div>
        )}
      </div>
      {/* Pegado a la esquina inferior derecha: deja claro que el anuncio se abre. Es parte del mismo enlace (no un botón aparte),
          así el toque funciona igual en la tarjeta o en el botón. Solo van redondeadas la esquina de arriba a la izquierda y la de
          abajo a la derecha, esta última con el mismo radio de la tarjeta para que encaje con su borde. */}
      <span className="absolute bottom-0 right-0 z-10 flex min-h-10 items-center gap-1.5 rounded-br-[22px] rounded-tl-2xl bg-secondary-container px-4 text-[12.5px] font-bold text-on-secondary-container" aria-hidden="true">
        <Eye className="h-4 w-4" /> Ver
      </span>
    </Link>
  );
}
