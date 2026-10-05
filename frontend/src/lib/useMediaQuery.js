import { useEffect, useState } from "react";

// Bloque 248 (auditoría 004, hallazgo 9): el sitio tiene movimiento automático
// (marquee de categorías, sliders de ofertas y de tiendas, fundido del hero) y
// no respetaba "reducir movimiento" del sistema. Estos dos hooks permiten
// apagar el autoplay y cambiar a una fila que se desliza con el dedo.
export function useMediaQuery(query) {
  const [matches, setMatches] = useState(() => (typeof window === "undefined" ? false : window.matchMedia(query).matches));
  useEffect(() => {
    const mq = window.matchMedia(query);
    const onChange = () => setMatches(mq.matches);
    onChange();
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

export function usePrefersReducedMotion() {
  return useMediaQuery("(prefers-reduced-motion: reduce)");
}
