import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "../lib/useMediaQuery.js";

// Imágenes del Hero que sube el admin. Se muestran de a una durante 8 segundos. El cambio es un deslizamiento corto con
// fundido y un leve zoom (la que sale se aleja hacia la izquierda, la que entra llega desde la derecha), solo con
// transform y opacity para que sea fluido incluso en teléfonos modestos. Cada punto de abajo muestra con una barra cuánto
// falta para el cambio; el avance lo marca el fin de esa animación, así que pasar el dedo o el ratón por encima la pausa
// sin que se desincronice. Las imágenes pueden tener fondo transparente: se ven sobre el color del encabezado.
const AUTOPLAY_SECONDS = 8;

export function HeroImageSlider({ images, alt, heightClass = "h-[320px] lg:h-[340px]" }) {
  const [activeIndex, setActiveIndex] = useState(0);
  const [prevIndex, setPrevIndex] = useState(null);
  const [paused, setPaused] = useState(false);
  const reducedMotion = usePrefersReducedMotion();

  // Si el admin sube o borra imágenes y la lista cambia de tamaño, nunca se queda apuntando a un índice que ya no existe.
  useEffect(() => {
    setActiveIndex((i) => (i >= images.length ? 0 : i));
    setPrevIndex(null);
  }, [images.length]);

  function goTo(next) {
    if (next === activeIndex) return;
    setPrevIndex(activeIndex);
    setActiveIndex(next);
  }

  if (images.length === 0) return null;

  const autoplay = images.length > 1 && !reducedMotion;

  return (
    <div className="flex flex-col" onMouseEnter={() => setPaused(true)} onMouseLeave={() => setPaused(false)} onTouchStart={() => setPaused(true)} onTouchEnd={() => setPaused(false)}>
      <div className={`relative ${heightClass} overflow-hidden rounded-xl`}>
        {images.map((url, i) => {
          const state = i === activeIndex ? "active" : i === prevIndex ? "out" : "in";
          const motion = reducedMotion
            ? state === "active"
              ? "opacity-100"
              : "pointer-events-none opacity-0"
            : state === "active"
            ? "translate-x-0 scale-100 opacity-100"
            : state === "out"
            ? "pointer-events-none -translate-x-8 scale-[1.04] opacity-0"
            : "pointer-events-none translate-x-8 scale-[0.96] opacity-0";
          return (
            <img
              key={url}
              src={url}
              alt={i === 0 ? alt : ""}
              loading={i === 0 ? "eager" : "lazy"}
              className={`absolute inset-0 h-full w-full object-contain will-change-[transform,opacity] ${reducedMotion ? "" : "transition-[transform,opacity] duration-[900ms] ease-[cubic-bezier(0.22,1,0.36,1)]"} ${motion}`}
            />
          );
        })}
      </div>
      {images.length > 1 && (
        <div className="mt-1 flex items-center justify-center">
          {images.map((url, i) => (
            <button
              key={url}
              type="button"
              onClick={() => goTo(i)}
              aria-label={`Ver imagen ${i + 1} de ${images.length}`}
              aria-current={i === activeIndex}
              className="flex h-6 items-center justify-center px-1 focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-white"
            >
              <span className={`relative block h-2 overflow-hidden rounded-full bg-white/40 transition-all duration-500 ${i === activeIndex ? "w-9" : "w-2"}`}>
                {i === activeIndex && (
                  <span
                    // `key` reinicia la barra cada vez que cambia la imagen; al terminar, pasa a la siguiente.
                    key={`${activeIndex}-${images.length}`}
                    className={`absolute inset-y-0 left-0 block rounded-full bg-white ${autoplay ? "hero-progress" : "w-full"}`}
                    style={autoplay ? { animationDuration: `${AUTOPLAY_SECONDS}s`, animationPlayState: paused ? "paused" : "running" } : undefined}
                    onAnimationEnd={() => goTo((activeIndex + 1) % images.length)}
                  />
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
