import { useState } from "react";
import { StoreCard } from "./StoreCard.jsx";

// Cuántas copias completas del set original hacen falta para que el track
// nunca se quede corto de ancho en pantallas grandes — de ahí para arriba,
// cualquier cantidad par sirve (ver nota de "loop sin salto" más abajo).
const MIN_SETS_WIDTH = 6;

// Bloque 20: reemplaza el carrusel por-página del Bloque 17 (saltos de a 4,
// dos velocidades) por un marquee continuo de una sola dirección — derecha a
// izquierda, tarjeta por tarjeta, sin flechas ni dots (no hay "página"
// discreta que resaltar en un scroll continuo). Loop infinito sin salto:
// técnica estándar de duplicar el set de tarjetas y animar el track de 0% a
// -50% (keyframe "marquee" en tailwind.config.js). Como la mitad duplicada
// es idéntica a la original, el frame en -50% es visualmente indistinguible
// del frame en 0% — ahí engancha el loop sin salto ni pausa. Se usa una
// cantidad PAR de copias (no solo 2) para que el track sea más ancho que la
// pantalla más grande esperada; -50% sigue cayendo justo en la mitad exacta
// del track sin importar cuántas copias sean, así que el loop sigue siendo
// perfecto.
export function VerifiedStoresSlider({ stores }) {
  const [paused, setPaused] = useState(false);

  if (!stores.length) return null;

  let sets = Math.max(2, Math.ceil(MIN_SETS_WIDTH / stores.length));
  if (sets % 2 !== 0) sets += 1;
  const track = Array.from({ length: sets }, () => stores).flat();

  return (
    <div
      className="overflow-hidden py-2"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onTouchStart={() => setPaused(true)}
      onTouchEnd={() => setPaused(false)}
    >
      <div className="flex w-max animate-marquee gap-5" style={{ animationPlayState: paused ? "paused" : "running" }}>
        {track.map((v, i) => (
          // Bloque 20 punto 4: en mobile la tarjeta mide ~46% del viewport
          // (tope 220px) para que se vean 2 a la vez mientras se desplaza,
          // en vez de 1 tarjeta ancha ocupando casi toda la pantalla.
          <div key={i} className="w-[46vw] max-w-[220px] flex-shrink-0 sm:w-[280px] lg:w-[300px]">
            <StoreCard vendor={v} />
          </div>
        ))}
      </div>
    </div>
  );
}
