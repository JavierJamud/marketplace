import { usePrefersReducedMotion } from "../lib/useMediaQuery.js";

// Bloque 251 (pedido explícito — "las tiendas verificadas y las ofertas de la
// semana se deslizan infinitamente, en una sola dirección, sin retroceder y sin
// dejar un espacio blanco al final: las que ya se mostraron se vuelven a
// incorporar al final"): carrusel continuo hecho con CSS. La lista se repite
// hasta tener al menos `minItems` tarjetas (así nunca hay hueco aunque haya solo
// 2 o 3 tiendas) y ese grupo se pone DOS veces seguidas; el riel se anima de 0 a
// -50% de su ancho, que es exactamente un grupo, así que el último cuadro es
// idéntico al primero y el reinicio no se nota. Siempre avanza hacia la
// izquierda. Se detiene al pasar el mouse (CSS, ver .marquee-rail en index.css).
// Con "reducir movimiento" en el sistema no hay animación: es una fila que se
// desliza con el dedo. La segunda copia es decorativa: `inert` + aria-hidden la
// sacan del teclado y de los lectores de pantalla.
//
// Los anchos de las tarjetas se pasan por `itemClassName` en unidades fijas o de
// viewport (no en % del riel, que mide lo que miden las tarjetas).
const EDGE_FADE_MASK = "linear-gradient(to right, transparent 0, black 28px, black calc(100% - 28px), transparent 100%)";

export function InfiniteMarquee({ items, getKey, renderItem, itemClassName, secondsPerItem = 6, minItems = 10, label }) {
  const reducedMotion = usePrefersReducedMotion();

  if (reducedMotion) {
    return (
      <div className="flex snap-x overflow-x-auto pb-2 [scrollbar-width:thin]" role="region" aria-label={label}>
        {items.map((item) => (
          <div key={getKey(item)} className={`flex-none snap-start ${itemClassName}`}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    );
  }

  const repeat = Math.max(1, Math.ceil(minItems / items.length));
  const group = Array.from({ length: repeat }, (_, round) => items.map((item) => ({ item, key: `${getKey(item)}-${round}` }))).flat();

  return (
    <div className="overflow-hidden" style={{ WebkitMaskImage: EDGE_FADE_MASK, maskImage: EDGE_FADE_MASK }} role="region" aria-label={label}>
      <div className="marquee-rail flex w-max animate-marquee" style={{ animationDuration: `${group.length * secondsPerItem}s` }}>
        {[0, 1].map((copy) => (
          <div key={copy} className="flex flex-none" {...(copy === 1 ? { inert: "", "aria-hidden": true } : {})}>
            {group.map(({ item, key }) => (
              <div key={key} className={`flex-none ${itemClassName}`}>
                {renderItem(item)}
              </div>
            ))}
          </div>
        ))}
      </div>
    </div>
  );
}
