import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "../lib/useMediaQuery.js";

// Bloque 96 (pedido explícito): el hero de la Home pasa de 1 imagen fija a
// varias — se muestran de a una con un fundido cruzado (crossfade, todas
// apiladas con position:absolute y solo la activa en opacity-100) en vez de
// deslizarse, que es lo que la mayoría de los sitios modernos usa para un
// hero así (Apple, Airbnb, etc.) — no reordena el layout ni "empuja" nada al
// cambiar. Avanza sola cada 5s; los punticos de abajo (solo si hay más de
// 1 imagen) también saltan a una puntual con un clic.
const AUTOPLAY_MS = 5000;

export function HeroImageSlider({ images, alt, heightClass = "h-[320px] lg:h-[340px]" }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [hovered, setHovered] = useState(false);
  // Bloque 248 (auditoría 004, hallazgo 9): sin autoplay si el sistema pide
  // reducir el movimiento (los puntos siguen permitiendo cambiar de imagen).
  const reducedMotion = usePrefersReducedMotion();

  // Si el admin sube/borra imágenes y la lista cambia de tamaño, nunca
  // queremos quedar apuntando a un índice que ya no existe.
  useEffect(() => {
    setActiveIndex((i) => (i >= images.length ? 0 : i));
  }, [images.length]);

  useEffect(() => {
    if (images.length < 2 || reducedMotion || hovered) return;
    const id = setInterval(() => setActiveIndex((i) => (i + 1) % images.length), AUTOPLAY_MS);
    return () => clearInterval(id);
  }, [images.length, reducedMotion, hovered]);

  // Sin ninguna imagen cargada: se reserva el mismo espacio del recuadro
  // (transparente, Bloque 95) en vez de no renderizar nada — así el layout
  // de 2 columnas del hero no se desarma si el admin todavía no subió nada.
  if (images.length === 0) return <div className={`${heightClass} rounded-xl`} />;

  return (
    <div className="flex flex-col" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)}>
      <div className={`relative ${heightClass} overflow-hidden rounded-xl`}>
        {images.map((url, i) => (
          <img
            key={url}
            src={url}
            alt={i === 0 ? alt : ""}
            className={`absolute inset-0 h-full w-full object-contain transition-opacity duration-700 ease-in-out ${
              i === activeIndex ? "opacity-100" : "pointer-events-none opacity-0"
            }`}
          />
        ))}
      </div>
      {images.length > 1 && (
        <div className="mt-1 flex items-center justify-center">
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => setActiveIndex(i)}
              aria-label={`Ver imagen ${i + 1} de ${images.length}`}
              aria-current={i === activeIndex}
              className="flex h-6 items-center justify-center px-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
            >
              {/* Bloque 248 (auditoría 004, hallazgo 2): el punto se ve de 8px
                  pero el área que se toca es de 24px de alto. */}
              <span className={`block h-2 rounded-full transition-all ${i === activeIndex ? "w-6 bg-white" : "w-2 bg-white/40"}`} />
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
