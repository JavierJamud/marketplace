import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { CompactStoreCard } from "./CompactStoreCard.jsx";

const AUTOPLAY_DELAY_MS = 3200;

// Bloque 48 (reemplaza el punto 8 del Bloque 17 y el rediseño del Bloque 47
// — pedido explícito: sin flechas ni dots, tarjeta chica, loop infinito de
// una sola dirección). Embla con loop:true + Autoplay ya avanza siempre
// hacia adelante y nunca retrocede — no hace falta el truco manual de
// array triplicado + reindexado que sugiere el bloque como fallback,
// porque la librería (ya instalada desde el Bloque 47) resuelve esto sola.
// "align: center" + basis responsive = en mobile la tarjeta activa ocupa
// ~80% del contenedor (así las vecinas quedan cortadas a los costados,
// efecto "peek"), en desktop basis 33.33% muestra exactamente 3 completas
// sin recorte — una sola implementación cubre los dos casos del bloque,
// sin dimming/escala entre tarjetas (todas se ven igual de nítidas).
export function VerifiedStoresSlider({ stores }) {
  const [emblaRef] = useEmblaCarousel({ loop: true, align: "center", duration: 35 }, [
    Autoplay({ delay: AUTOPLAY_DELAY_MS, stopOnMouseEnter: true, stopOnInteraction: false }),
  ]);

  if (!stores.length) return null;

  return (
    <div className="overflow-hidden" ref={emblaRef}>
      <div className="flex touch-pan-y">
        {stores.map((v) => (
          <div key={v.id} className="min-w-0 flex-shrink-0 basis-[80%] px-2 sm:basis-[45%] lg:basis-[33.3333%]">
            <CompactStoreCard vendor={v} />
          </div>
        ))}
      </div>
    </div>
  );
}
