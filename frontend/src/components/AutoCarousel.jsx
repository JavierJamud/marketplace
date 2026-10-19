import { useCallback, useMemo } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { usePrefersReducedMotion } from "../lib/useMediaQuery.js";

// Bloque 254 (pedido explícito — "en Tiendas verificadas, cuando pase cada
// tienda la vista actual debe quedar centrada y se puede deslizar
// manualmente"): carrusel con Embla que avanza solo UNA tarjeta cada `delay`,
// siempre hacia adelante, y que además se arrastra con el dedo. Con
// `align: "center"` la tarjeta activa queda centrada y las vecinas se asoman a
// los lados. Embla solo hace loop si hay suficientes tarjetas para llenar el
// ancho, así que la lista se repite hasta tener `minSlides` (con 3 tiendas no
// habría loop ni forma de que "vuelvan a entrar" las que ya pasaron). Tras
// arrastrar a mano el autoplay sigue (stopOnInteraction: false); se detiene al
// pasar el mouse. Con "reducir movimiento" no avanza solo, pero se arrastra.
// En pantalla se ven hasta 3 tarjetas a la vez (en el teléfono, la del centro y las vecinas asomándose). Con menos de
// MIN_TO_LOOP tarjetas, repetir la lista para el loop hacía que la MISMA tienda u oferta se viera dos veces al mismo tiempo
// (pasaba con 2 tiendas verificadas). Ahí no se repite: cada tarjeta sale una sola vez, centrada si caben, y el avance
// automático vuelve al principio al llegar al final.
const MIN_TO_LOOP = 4;

export function AutoCarousel({ items, getKey, renderItem, itemClassName, align = "center", delay = 4000, minSlides = 6, label }) {
  const reducedMotion = usePrefersReducedMotion();
  const canLoop = items.length >= MIN_TO_LOOP;
  const slides = useMemo(() => {
    if (!canLoop) return items.map((item) => ({ item, key: `${getKey(item)}-0`, copy: 0 }));
    const repeat = Math.max(1, Math.ceil(minSlides / items.length));
    return Array.from({ length: repeat }, (_, round) => items.map((item) => ({ item, key: `${getKey(item)}-${round}`, copy: round }))).flat();
  }, [items, getKey, minSlides, canLoop]);
  const plugins = useMemo(
    () => (reducedMotion ? [] : [Autoplay({ delay, stopOnMouseEnter: true, stopOnInteraction: false })]),
    [reducedMotion, delay]
  );
  const [emblaRef] = useEmblaCarousel({ loop: canLoop, align, duration: 30 }, plugins);

  // Las copias (para que el loop tenga con qué llenar el ancho) se ven y se tocan igual que el original: con pocos anuncios casi
  // todo lo visible son copias, y antes llevaban `inert`, que las dejaba sin responder al clic. Solo se ocultan a los lectores de
  // pantalla y al tabulador, para no leer ni recorrer dos veces lo mismo.
  const skipCopyFocus = useCallback((el) => {
    el?.querySelectorAll("a, button, input, select, textarea, [tabindex]").forEach((n) => n.setAttribute("tabindex", "-1"));
  }, []);

  return (
    <div className="overflow-hidden" ref={emblaRef} role="region" aria-label={label}>
      {/* "safe center": centra cuando las tarjetas caben; si no caben, arranca a la izquierda y se desliza normal. */}
      <div className={`flex touch-pan-y ${canLoop ? "" : "[justify-content:safe_center]"}`}>
        {slides.map(({ item, key, copy }) => (
          <div key={key} className={`min-w-0 flex-none ${itemClassName}`} {...(copy > 0 ? { "aria-hidden": true, ref: skipCopyFocus } : {})}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
