import { useCallback, useEffect, useMemo, useState } from "react";
import useEmblaCarousel from "embla-carousel-react";
import Autoplay from "embla-carousel-autoplay";
import { Package } from "lucide-react";
import { usePrefersReducedMotion } from "../lib/useMediaQuery.js";

// Galería de un anuncio de venta rápida: pasa sola de una foto a la siguiente cada pocos segundos, se arrastra con el
// dedo y sus miniaturas y puntos siguen a la foto activa. Con una sola foto no se mueve; con "reducir movimiento" no
// avanza sola pero se puede arrastrar. El marco 7:4 es el mismo de la tarjeta, así que lo que el vendedor acomodó al
// recortar es lo que se ve aquí.
export function ListingGallery({ images, alt, delay = 4000 }) {
  const reducedMotion = usePrefersReducedMotion();
  const many = images.length > 1;
  const plugins = useMemo(() => (many && !reducedMotion ? [Autoplay({ delay, stopOnMouseEnter: true, stopOnInteraction: false })] : []), [many, reducedMotion, delay]);
  const [emblaRef, embla] = useEmblaCarousel({ loop: many, duration: 28, watchDrag: many }, plugins);
  const [selected, setSelected] = useState(0);

  useEffect(() => {
    if (!embla) return;
    const onSelect = () => setSelected(embla.selectedScrollSnap());
    onSelect();
    embla.on("select", onSelect);
    return () => embla.off("select", onSelect);
  }, [embla]);

  const goTo = useCallback((i) => embla?.scrollTo(i), [embla]);

  if (!images.length) {
    return (
      <div className="flex aspect-[7/4] w-full items-center justify-center rounded-2xl bg-surface-container text-outline">
        <Package className="h-12 w-12" />
      </div>
    );
  }

  return (
    <div>
      <div className="relative overflow-hidden rounded-2xl bg-surface-container-lowest" ref={emblaRef} role="region" aria-roledescription="carrusel" aria-label={`Fotos de ${alt}`}>
        <div className="flex touch-pan-y">
          {images.map((src, i) => (
            <div key={src} className="aspect-[7/4] min-w-0 flex-[0_0_100%]" aria-label={`Foto ${i + 1} de ${images.length}`}>
              <img src={src} alt={i === 0 ? alt : ""} loading={i === 0 ? "eager" : "lazy"} decoding="async" className="h-full w-full object-cover" />
            </div>
          ))}
        </div>
        {many && (
          <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1.5">
            {images.map((src, i) => (
              <span key={src} className={`h-1.5 rounded-full transition-all ${i === selected ? "w-5 bg-white" : "w-1.5 bg-white/60"}`} />
            ))}
          </div>
        )}
      </div>
      {many && (
        <div className="mt-2.5 grid grid-cols-5 gap-2">
          {images.map((src, i) => (
            <button
              key={src}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Ver foto ${i + 1}`}
              aria-current={i === selected}
              className={`aspect-[7/4] w-full overflow-hidden rounded-md border-2 transition-all ${i === selected ? "border-tertiary-accent opacity-100" : "border-transparent opacity-55 hover:opacity-85"}`}
            >
              <img src={src} alt="" loading="lazy" className="h-full w-full object-cover" />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
