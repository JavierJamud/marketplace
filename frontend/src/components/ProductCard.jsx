import { useState } from "react";
import { Link } from "react-router-dom";
import { MapPin } from "lucide-react";
import { api } from "../lib/api.js";
import { formatPrice } from "../lib/format.js";
import { VerifiedBadge } from "./ui/VerifiedBadge.jsx";
import { StarRating } from "./ui/StarRating.jsx";
import { AddToCartControl } from "./AddToCartControl.jsx";

// Mismo umbral que LOW_STOCK_THRESHOLD en VendorProducts.jsx/vendors.controller.js.
const LOW_STOCK_THRESHOLD = 3;

// Bloque 51 (pedido explícito, con boceto de referencia): el marco de la
// imagen usa un borde punteado fino en vez de sólido. Orden del texto:
// nombre → ubicación → descripción (con "...leer más") → precio. Bloque 52
// (follow-up): se pidió que la tarjeta se note más contra el fondo de la
// página — antes la sombra solo aparecía al hover, así que en reposo la
// tarjeta (blanca) se perdía contra el fondo (gris clarito, surface-container)
// sin ningún borde. Ahora lleva una sombra sutil SIEMPRE (se intensifica al
// hover) para que el borde de la tarjeta se note incluso quieta.
export function ProductCard({ product }) {
  const [descExpanded, setDescExpanded] = useState(false);

  // images[] guarda paths relativos ("/uploads/products/<tienda>/<archivo>")
  // servidos por el backend, no por el frontend — hay que anteponer el origin.
  // Bloque 49: también puede ser un link externo pegado por el vendedor — en
  // ese caso ya es absoluto y no hay que tocarlo.
  const firstImage = product.images?.[0];
  const image = firstImage ? (/^https?:\/\//.test(firstImage) ? firstImage : `${api.defaults.baseURL}${firstImage}`) : null;
  const discount = product.oldPrice ? Math.round(100 - (Number(product.price) / Number(product.oldPrice)) * 100) : null;
  const isOutOfStock = product.stock === 0;
  const isLowStock = !isOutOfStock && product.stock != null && product.stock <= LOW_STOCK_THRESHOLD;
  const productHref = `/producto/${product.vendor?.slug}/${product.slug}`;

  return (
    <div className="group flex h-full flex-col overflow-hidden rounded-[22px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)] transition-shadow hover:shadow-lg">
      <Link to={productHref} className="block p-2.5 pb-0">
        {/* Bloque 51 (pedido explícito): contenedor de imagen ~600×350 (más
            ancho que alto, aspect-[12/7] = 600/350 exacto) en vez de
            cuadrado — se ve más compacto y la tarjeta entera queda más chica. */}
        <div className="relative aspect-[12/7] w-full overflow-hidden rounded-[16px] border-2 border-dashed border-outline-variant bg-surface-container">
          {(product.badge || discount) && (
            <span
              className={`absolute left-2 top-2 z-10 rounded-full px-2 py-0.5 text-[10.5px] font-bold text-white ${
                discount ? "bg-error" : "bg-tertiary-accent"
              }`}
            >
              {product.badge ?? `-${discount}%`}
            </span>
          )}
          {image ? (
            <img src={image} alt={product.name} className="h-full w-full object-cover transition-transform group-hover:scale-105" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin foto</div>
          )}
        </div>
      </Link>
      <div className="flex flex-1 flex-col p-3 pt-2">
        <div className="mb-0.5 flex items-center gap-1.5">
          <span className="truncate text-[10.5px] font-bold text-tertiary-accent">{product.vendor?.companyName}</span>
          {product.vendor?.isVerified && <VerifiedBadge size="sm" />}
          {product.category?.name && (
            <span className="ml-auto flex-shrink-0 rounded-full bg-surface-container px-2 py-0.5 text-[10px] font-semibold text-on-surface-variant">
              {product.category.name}
            </span>
          )}
        </div>
        <Link to={productHref} className="mb-0.5 line-clamp-2 text-[13.5px] font-bold leading-[18px] text-on-surface">
          {product.name}
        </Link>
        {product.vendor?.locations?.[0] && (
          <div className="mb-1 flex items-center gap-1 text-[11px] text-outline">
            <MapPin className="h-3 w-3" />
            {product.vendor.locations[0].municipality?.name ?? product.vendor.locations[0].province?.name}
          </div>
        )}
        {product.description && (
          <div className="mb-1">
            <p className={`text-[11.5px] leading-4 text-outline ${descExpanded ? "" : "line-clamp-2"}`}>{product.description}</p>
            {product.description.length > 45 && (
              <button
                type="button"
                onClick={() => setDescExpanded((v) => !v)}
                className="text-[11px] font-bold text-tertiary-accent hover:underline"
              >
                {descExpanded ? "leer menos" : "...leer más"}
              </button>
            )}
          </div>
        )}
        {product.rating != null && <StarRating value={product.rating} size="h-3.5 w-3.5" showValue className="mb-1" />}
        {(isOutOfStock || isLowStock) && (
          <span
            className={`mb-1.5 w-fit rounded-full px-2 py-0.5 text-[10px] font-bold ${
              isOutOfStock ? "bg-error/10 text-error" : "bg-[#8a5100]/10 text-[#8a5100]"
            }`}
          >
            {isOutOfStock ? "Sin stock" : `¡Últimas ${product.stock} unidades!`}
          </span>
        )}
        <div className="mt-auto flex items-center justify-between pt-1">
          <div>
            <span className="text-[14.5px] font-bold text-on-surface">{formatPrice(product.price, product.currency)}</span>
            {product.oldPrice && (
              <span className="ml-1.5 text-label-sm text-outline line-through">{formatPrice(product.oldPrice, product.currency)}</span>
            )}
          </div>
          <AddToCartControl product={product} />
        </div>
      </div>
    </div>
  );
}
