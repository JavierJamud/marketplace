import { useMemo } from "react";
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
export function AutoCarousel({ items, getKey, renderItem, itemClassName, align = "center", delay = 4000, minSlides = 6, label }) {
  const reducedMotion = usePrefersReducedMotion();
  const slides = useMemo(() => {
    const repeat = Math.max(1, Math.ceil(minSlides / items.length));
    return Array.from({ length: repeat }, (_, round) => items.map((item) => ({ item, key: `${getKey(item)}-${round}`, copy: round }))).flat();
  }, [items, getKey, minSlides]);
  const plugins = useMemo(
    () => (reducedMotion ? [] : [Autoplay({ delay, stopOnMouseEnter: true, stopOnInteraction: false })]),
    [reducedMotion, delay]
  );
  const [emblaRef] = useEmblaCarousel({ loop: true, align, duration: 30 }, plugins);

  return (
    <div className="overflow-hidden" ref={emblaRef} role="region" aria-label={label}>
      <div className="flex touch-pan-y">
        {slides.map(({ item, key, copy }) => (
          <div key={key} className={`min-w-0 flex-none ${itemClassName}`} {...(copy > 0 ? { "aria-hidden": true } : {})}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
