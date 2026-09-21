import { Link } from "react-router-dom";
import { StarRating } from "./ui/StarRating.jsx";

// Bloque 209 (pedido explícito, con captura de referencia): tarjeta
// horizontal compartida por el menú digital — usada en el menú de mesa por
// QR (TableOrder.jsx) y en la pestaña "Menú del local" de la tienda pública
// (Store.jsx), así ambos lugares comparten el mismo look sin duplicar
// estilos en dos archivos. Un solo lugar (este archivo) define el look;
// cada sitio solo arma sus props (badge, acción, link o no).
// `auto-fill`/`minmax` en vez de breakpoints fijos (sm:/lg:) a propósito:
// TableOrder.jsx envuelve esta grilla en un contenedor `max-w-lg` (queda
// angosto aunque la pantalla sea grande, es una página pensada para abrirse
// escaneando el QR de una mesa), mientras que Store.jsx la envuelve en el
// `container-app` normal (mucho más ancho) — con columnas fijas por
// viewport, la de TableOrder terminaba forzando 2-3 columnas en un
// contenedor demasiado angosto para entrar (columna colapsada a 0, texto
// invisible, bug real encontrado al verificar esto en vivo). auto-fill mide
// el ancho REAL del contenedor, no el del viewport, así que ambos lugares
// terminan en 1 columna cuando no entra más de una tarjeta cómoda (mobile,
// o el contenedor angosto de TableOrder) y hasta 3 cuando sí hay espacio
// real (Store.jsx en pantallas grandes).
export const DIGITAL_MENU_GRID_CLASS = "grid grid-cols-[repeat(auto-fill,minmax(340px,1fr))] gap-3";

// Bloque 210 (pedido explícito, con capturas comparando la ficha del
// producto contra su tarjeta en el menú — "mira como se ve el producto
// desde dentro y desde fuera"): la tarjeta le faltaba la calificación
// (Product.jsx sí la muestra) y el descuento (Product.jsx sí muestra precio
// anterior tachado + "-X%") — ahora se ven en los dos lugares, mismo
// criterio visual que ProductCard.jsx (badge de descuento sobre la imagen,
// precio anterior tachado junto al precio real).
export function DigitalMenuProductCard({
  to,
  image,
  imageAlt,
  name,
  description,
  badge,
  rating,
  reviewCount,
  price,
  oldPrice,
  discountPercent,
  action,
  grayscale = false,
}) {
  // Bloque 213 (bug real reportado en vivo, con captura — "la imagen no
  // está centrada, veo más espacio debajo que en la parte superior"): la
  // imagen tiene alto fijo (h-24/h-28) — sin `items-center`, un flex-row
  // alinea por defecto con `stretch`, que no aplica a un hijo con alto ya
  // fijo y lo deja pegado arriba (cross-start) en vez de centrarlo cuando
  // la columna de texto (nombre + rating + descripción + precio) resulta
  // más alta que la imagen, como pasa seguido con nombres/descripciones
  // largas. `items-center` centra la imagen contra esa altura real.
  const shellClass =
    "flex items-center gap-3 rounded-2xl border border-surface-container-high bg-surface-container-lowest p-3 shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)]";

  const content = (
    <>
      <div className="relative h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl bg-surface-container sm:h-28 sm:w-28">
        {discountPercent != null && (
          <span className="absolute left-1 top-1 z-10 rounded-full bg-error px-1.5 py-0.5 text-[9.5px] font-bold text-white shadow">
            -{discountPercent}%
          </span>
        )}
        {image ? (
          <img src={image} alt={imageAlt} className={`h-full w-full object-cover ${grayscale ? "grayscale" : ""}`} />
        ) : (
          <div className="flex h-full w-full items-center justify-center text-[10px] text-outline">Sin foto</div>
        )}
      </div>
      <div className="flex min-w-0 flex-1 flex-col py-0.5">
        <div className="mb-0.5 flex items-start justify-between gap-2">
          <span className="line-clamp-2 text-[13.5px] font-bold leading-[18px] text-on-surface">{name}</span>
          {badge}
        </div>
        {reviewCount > 0 && <StarRating value={rating} size="h-3 w-3" showValue count={reviewCount} className="mb-1" />}
        {description && <p className="mb-1.5 line-clamp-2 text-[12px] leading-4 text-outline">{description}</p>}
        <div className="mt-auto flex items-center justify-between gap-2 pt-1">
          <div className="flex flex-col">
            <span className="text-[15px] font-bold text-on-surface">{price}</span>
            {oldPrice && <span className="text-[10.5px] leading-tight text-outline line-through">{oldPrice}</span>}
          </div>
          {action}
        </div>
      </div>
    </>
  );

  if (to) {
    return (
      <Link to={to} className={`${shellClass} transition-shadow hover:shadow-lg`}>
        {content}
      </Link>
    );
  }
  return <div className={shellClass}>{content}</div>;
}
