import { Suspense } from "react";
import { lazyRetry } from "../lib/lazyRetry.js";

// El carrusel (Embla) está más abajo en la portada: se descarga aparte para no sumar su código a la primera carga. Mientras
// llega se pinta la misma fila de tarjetas, quieta y con las mismas medidas, para que nada se mueva al cambiar.
const AutoCarousel = lazyRetry(() => import("./AutoCarousel.jsx").then((m) => ({ default: m.AutoCarousel })));

function StaticRow({ items, getKey, renderItem, itemClassName }) {
  return (
    <div className="overflow-hidden">
      <div className={`flex touch-pan-y ${items.length >= 4 ? "" : "[justify-content:safe_center]"}`}>
        {items.map((item) => (
          <div key={getKey(item)} className={`min-w-0 flex-none ${itemClassName}`}>
            {renderItem(item)}
          </div>
        ))}
      </div>
    </div>
  );
}

export function AutoCarouselLazy(props) {
  return (
    <Suspense fallback={<StaticRow {...props} />}>
      <AutoCarousel {...props} />
    </Suspense>
  );
}
