import { useEffect, useMemo, useState } from "react";
import { usePrefersReducedMotion } from "../lib/useMediaQuery.js";

// Bloque 252 (pedido explícito — "Ofertas de la semana y Tiendas verificadas
// no son un slider constante: van pasando de una en una cada cierto tiempo, en
// una sola dirección, infinito, sin dejar un espacio blanco al final"):
// carrusel por pasos. El riel es la lista repetida RAIL_COPIES veces; cada
// `intervalMs` avanza UNA tarjeta, y al llegar al final de una copia el índice
// "se teletransporta" sin transición a la posición equivalente de la copia
// anterior: como el contenido ahí es idéntico (es la misma lista), el salto es
// invisible y las tarjetas que ya pasaron vuelven a entrar por el final. Nunca
// retrocede. Se detiene al pasar el mouse o con el foco adentro; con "reducir
// movimiento" no avanza solo y es una fila que se desliza con el dedo.
//
// `stepClassName` define cuánto mide un paso (variable CSS --slide-step, igual
// al ancho de una tarjeta) y `itemClassName` el ancho de cada tarjeta; los dos
// van como clases completas en quien lo usa para que Tailwind las vea.
const RAIL_COPIES = 4;
const SLIDE_TRANSITION_MS = 600;

export function StepCarousel({ items, getKey, renderItem, itemClassName, stepClassName, intervalMs = 4500, label }) {
  const length = items.length;
  const reducedMotion = usePrefersReducedMotion();
  const [index, setIndex] = useState(0);
  const [smooth, setSmooth] = useState(true);
  const [held, setHeld] = useState(false);
  const rail = useMemo(() => Array.from({ length: RAIL_COPIES }, (_, copy) => items.map((item) => ({ item, key: `${getKey(item)}-${copy}` }))).flat(), [items, getKey]);

  useEffect(() => {
    if (length <= 1 || held || reducedMotion) return undefined;
    const id = setInterval(() => setIndex((i) => i + 1), intervalMs);
    return () => clearInterval(id);
  }, [length, held, reducedMotion, intervalMs]);

  // Tras el salto sin transición se vuelve a activar la animación en el
  // siguiente cuadro.
  useEffect(() => {
    if (smooth) return undefined;
    const raf = requestAnimationFrame(() => setSmooth(true));
    return () => cancelAnimationFrame(raf);
  }, [smooth]);

  function handleTransitionEnd(e) {
    // Solo interesa la transición del propio riel, no la de algo dentro de una tarjeta.
    if (e.target !== e.currentTarget) return;
    if (index >= length) {
      setSmooth(false);
      setIndex(index - length);
    }
  }

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

  return (
    <div
      className={`overflow-hidden ${stepClassName}`}
      role="region"
      aria-label={label}
      onMouseEnter={() => setHeld(true)}
      onMouseLeave={() => setHeld(false)}
      onFocus={() => setHeld(true)}
      onBlur={() => setHeld(false)}
    >
      <div
        className="flex"
        onTransitionEnd={handleTransitionEnd}
        style={{
          transform: `translateX(calc(var(--slide-step) * ${-index}))`,
          transition: smooth ? `transform ${SLIDE_TRANSITION_MS}ms ease` : "none",
        }}
      >
        {rail.map(({ item, key }) => (
          <div key={key} className={`flex-none ${itemClassName}`}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}
