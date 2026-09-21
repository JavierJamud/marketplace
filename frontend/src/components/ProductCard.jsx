import { Link } from "react-router-dom";
import { MapPin, Flame } from "lucide-react";
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
// Bloque 98 (pedido explícito): "trackSource" identifica desde qué listado
// se hizo clic (home/catálogo/tienda/resultados de búsqueda) — alimenta
// clickCount/searchClickCount del algoritmo de "Destacados"
// (lib/productRanking.js). "catalog" cubre cualquier listado genérico que
// no le pase nada explícito, para no tener que tocar cada call site.
export function ProductCard({ product, trackSource = "catalog" }) {

  // images[] guarda paths relativos ("/uploads/products/<tienda>/<archivo>")
  // servidos por el backend, no por el frontend — hay que anteponer el origin.
  // Bloque 49: también puede ser un link externo pegado por el vendedor — en
  // ese caso ya es absoluto y no hay que tocarlo.
  const firstImage = product.images?.[0];
  const image = firstImage ? (/^https?:\/\//.test(firstImage) ? firstImage : `${api.defaults.baseURL}${firstImage}`) : null;
  const discount = product.oldPrice ? Math.round(100 - (Number(product.price) / Number(product.oldPrice)) * 100) : null;
  // Bloque 56: "disponible siempre" nunca se muestra como agotado/bajo stock.
  const isOutOfStock = !product.unlimitedStock && product.stock === 0;
  const isLowStock = !product.unlimitedStock && !isOutOfStock && product.stock != null && product.stock <= LOW_STOCK_THRESHOLD;
  const productHref = `/producto/${product.vendor?.slug}/${product.slug}`;

  return (
    // Pedido explícito: toda la tarjeta debe abrir el producto al hacer
    // clic en cualquier parte, no solo en la imagen o el título — mismo
    // criterio que StoreCard.jsx (que ya era un único <Link> completo).
    // AddToCartControl es el único control interactivo adentro; su wrapper
    // corta la propagación del clic para que agregar al carrito no navegue.
    <Link
      to={productHref}
      onClick={() => api.post(`/products/${product.id}/track-click`, { source: trackSource }).catch(() => {})}
      className="group flex h-full flex-col overflow-hidden rounded-[22px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)] transition-shadow hover:shadow-lg"
    >
      <div className="p-[2px] pb-0">
        <div className="relative aspect-[7/4] w-full overflow-hidden rounded-[20px] border border-dashed border-outline-variant bg-surface-container">
          {(product.badge || discount) && (
            <span
              className={`absolute left-1.5 top-1.5 z-10 max-w-[45%] truncate rounded-full px-1.5 py-0.5 text-[9.5px] font-bold text-white sm:left-2 sm:top-2 sm:px-2 sm:text-[10.5px] ${
                discount ? "bg-error" : "bg-tertiary-accent"
              }`}
            >
              {product.badge ?? `-${discount}%`}
            </span>
          )}
          {product.isBestSeller && (
            <span className="absolute right-1.5 top-1.5 z-10 flex max-w-[48%] items-center gap-0.5 rounded-full bg-[#8a5100] px-1.5 py-0.5 text-[9.5px] font-bold text-white sm:right-2 sm:top-2 sm:gap-1 sm:px-2 sm:text-[10.5px]">
              <Flame className="h-2.5 w-2.5 flex-shrink-0 sm:h-3 sm:w-3" />
              <span className="truncate">Más vendido</span>
            </span>
          )}
          {image ? (
            <img src={image} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin foto</div>
          )}
        </div>
      </div>
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
        {/* Bloque 116 (pedido explícito): estrellas + cantidad de reseñas DE
            ESTE PRODUCTO (no de la tienda) — mismo componente/estilo que ya
            usa StoreCard.jsx, encima del título y debajo de la imagen. Solo
            se muestra si ya tiene al menos 1 reseña con estrellas — un
            producto sin reseñas no muestra "0.0 ★ (0)". */}
        {product.reviewCount > 0 && (
          <StarRating value={Number(product.rating)} size="h-3.5 w-3.5" showValue count={product.reviewCount} className="mb-1" />
        )}
        <span className="mb-0.5 line-clamp-2 text-[13.5px] font-bold leading-[18px] text-on-surface">{product.name}</span>
        {product.vendor?.locations?.[0] && (
          <div className="mb-1 flex items-center gap-1 text-[11px] text-outline">
            <MapPin className="h-3 w-3" />
            {product.vendor.locations[0].municipality?.name ?? product.vendor.locations[0].province?.name}
          </div>
        )}
        {product.description && (
          <div className="mb-1">
            <p className="line-clamp-2 text-[11.5px] leading-4 text-outline">{product.description}</p>
            {product.description.length > 45 && (
              <span className="text-[11px] font-bold text-tertiary-accent">...leer más</span>
            )}
          </div>
        )}
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
          {/* Bloque 155 (bug real reportado en vivo, con captura): antes el
              precio anterior iba al lado del precio real dentro del mismo
              div sin flex — ambos <span> son inline, así que quedaban en la
              misma línea en vez de uno debajo del otro. flex-col los apila:
              precio real arriba, precio anterior tachado y más chico debajo
              en su propia línea. */}
          <div className="flex flex-col">
            <span className="text-[14.5px] font-bold text-on-surface">{formatPrice(product.price, product.currency)}</span>
            {product.oldPrice && (
              <span className="text-[10.5px] leading-tight text-outline line-through">{formatPrice(product.oldPrice, product.currency)}</span>
            )}
          </div>
          {/* Bloque 155 (bug real reportado en vivo — hacer clic en el
              número de cantidad del stepper, ya con el producto en el
              carrito, recargaba la página entera en vez de quedarse en la
              tarjeta): ese número es un <span> sin su propio onClick — antes
              acá solo se llamaba stopPropagation(), que corta la
              propagación SINTÉTICA de React (por eso nunca disparaba el
              onClick del <Link> padre) pero nunca cancela la acción nativa
              del navegador para un <a>, que depende solo de que alguien
              llame preventDefault() en algún punto del recorrido real del
              evento. Como el <Link> nunca llegaba a ejecutar su propio
              onClick (la propagación ya se había cortado antes), nadie
              llamaba preventDefault() y el navegador hacía una navegación
              dura de verdad al href — de ahí la recarga completa (y lo
              mismo otra vez al volver atrás, porque fue historial real de
              navegador, no un cambio de ruta de React Router). Los botones
              +/- de adentro ya llamaban preventDefault() ellos mismos y por
              eso nunca fallaban — el número (y cualquier hueco vacío del
              stepper) no tenía ninguno. */}
          <div
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
            }}
            onMouseDown={(e) => e.stopPropagation()}
          >
            <AddToCartControl product={product} />
          </div>
        </div>
      </div>
    </Link>
  );
}
