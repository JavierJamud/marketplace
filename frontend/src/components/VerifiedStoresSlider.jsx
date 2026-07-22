import { useCallback, useEffect, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { StoreCard } from "./StoreCard.jsx";

const AUTOPLAY_DELAY_MS = 3500;

// Bloque 47: reemplaza el marquee continuo (translateX sin parar) del
// Bloque 20 — pedido explícito de que el movimiento sea "sale una tarjeta,
// entra la siguiente" en vez de scroll continuo. Embla ya resuelve esto:
// por defecto transiciona (snap) de a un slide, loop infinito real (no el
// truco de duplicar el set a mano que usaba el marquee). Mismo criterio de
// pausa en hover/touch que antes, ahora vía las opciones nativas del plugin
// de autoplay (stopOnMouseEnter) en vez de un listener manual.
// "align: center" + basis responsive = mobile ve la tarjeta activa grande
// con un pedacito de la anterior/siguiente a los costados (carrusel "peek"),
// y en desktop se ven ~3 con la del medio destacada (scale/opacity según
// selectedIndex) — una sola implementación cubre los dos casos del bloque.
export function VerifiedStoresSlider({ stores }) {
  const [emblaRef, emblaApi] = useEmblaCarousel({ loop: true, align: "center" }, [
    Autoplay({ delay: AUTOPLAY_DELAY_MS, stopOnMouseEnter: true, stopOnInteraction: false }),
  ]);
  const [selectedIndex, setSelectedIndex] = useState(0);

  const onSelect = useCallback(() => {
    if (!emblaApi) return;
    setSelectedIndex(emblaApi.selectedScrollSnap());
  }, [emblaApi]);

  useEffect(() => {
    if (!emblaApi) return;
    onSelect();
    emblaApi.on("select", onSelect);
    return () => emblaApi.off("select", onSelect);
  }, [emblaApi, onSelect]);

  if (!stores.length) return null;

  return (
    <div className="relative">
      <div className="overflow-hidden" ref={emblaRef}>
        <div className="flex touch-pan-y">
          {stores.map((v, i) => (
            <div
              key={v.id}
              className="min-w-0 flex-shrink-0 basis-[82%] px-2.5 transition-[transform,opacity] duration-300 sm:basis-[52%] lg:basis-[34%]"
              style={{
                transform: i === selectedIndex ? "scale(1)" : "scale(0.92)",
                opacity: i === selectedIndex ? 1 : 0.6,
              }}
            >
              <StoreCard vendor={v} />
            </div>
          ))}
        </div>
      </div>

      {stores.length > 1 && (
        <>
          <button
            onClick={() => emblaApi?.scrollPrev()}
            aria-label="Tienda anterior"
            className="absolute left-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface-container-lowest text-on-surface shadow-lg hover:scale-105 sm:flex"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <button
            onClick={() => emblaApi?.scrollNext()}
            aria-label="Tienda siguiente"
            className="absolute right-0 top-1/2 z-10 hidden h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full bg-surface-container-lowest text-on-surface shadow-lg hover:scale-105 sm:flex"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </>
      )}
    </div>
  );
}
