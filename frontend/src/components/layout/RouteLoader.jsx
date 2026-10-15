import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useIsFetching } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { releaseStaleScrollLock } from "../../lib/scrollLock.js";

// Bloque 135 (pedido explícito — "un loader normal para cuando se cambia entre páginas, en caso de que alguna se quede atascada"):
// `useIsFetching()` cuenta las consultas en vuelo en toda la app; si siguen activas 4 segundos seguidos se muestra un aviso chico,
// sin tapar lo que ya cargó, para que el visitante nunca se quede sin saber que la página sigue intentando.
const STUCK_THRESHOLD_MS = 4000;

function StuckPageHelper() {
  const fetchingCount = useIsFetching();
  const isFetching = fetchingCount > 0;
  const [show, setShow] = useState(false);

  useEffect(() => {
    if (!isFetching) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), STUCK_THRESHOLD_MS);
    return () => clearTimeout(t);
  }, [isFetching]);

  if (!show) return null;

  return (
    <div className="fixed bottom-5 left-1/2 z-[200] flex -translate-x-1/2 items-center gap-2.5 rounded-full bg-primary px-4 py-2.5 text-white shadow-xl">
      <Loader2 className="h-4 w-4 flex-shrink-0 animate-spin" />
      <span className="text-[12.5px] font-semibold">Esto está tardando más de lo normal, seguimos intentando...</span>
    </div>
  );
}

// Al cambiar de página: vuelve arriba del todo y, solo si los datos de la página nueva tardan más de 1 segundo, muestra un círculo
// girando chico que no tapa nada. La barra de progreso de arriba se quitó a pedido del dueño: estorbaba la carga y llegó a quedarse
// fija en la parte superior.
const SPINNER_AFTER_MS = 1000;

export function RouteLoader() {
  const location = useLocation();
  const [spinner, setSpinner] = useState(false);
  const busy = useIsFetching() > 0;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    setSpinner(false);
    // Bloque 52 (pedido explícito): React Router no resetea el scroll al
    // navegar (a diferencia de una navegación de página completa normal) —
    // sin esto, entrar a una página nueva desde el final de una lista larga
    // (ej. "También te puede interesar") la mostraba a mitad de scroll en
    // vez de arriba del todo. Solo depende de pathname (no de location
    // completa) para no pisar un scroll-a-sección por hash dentro de la
    // MISMA página (ver Store.jsx `#resenas`).
    // Bug real reportado en vivo: `html` tiene `scroll-smooth` global
    // (index.css) — un `window.scrollTo(0,0)` sin más queda sujeto a ese
    // scroll-behavior:smooth del CSS y ANIMA desde la posición vieja en vez
    // de saltar directo, así que la página nueva se veía "un poco desplazada
    // hacia arriba" en vez de arrancar ya arriba del todo. `behavior:
    // "instant"` fuerza el salto inmediato, ignorando el smooth del CSS —
    // el scroll-smooth global sigue intacto para todo lo demás (ej. anclas
    // `#resenas` dentro de la misma página).
    window.scrollTo({ top: 0, left: 0, behavior: "instant" });
    releaseStaleScrollLock();

    const t = setTimeout(() => {
      if (busyRef.current) setSpinner(true);
    }, SPINNER_AFTER_MS);
    return () => clearTimeout(t);
  }, [location.pathname]);

  // Lo que cargaba terminó: se quita el indicador.
  useEffect(() => {
    if (!busy) setSpinner(false);
  }, [busy]);

  return (
    <>
      {spinner && (
        <div role="status" aria-live="polite" className="pointer-events-none fixed left-1/2 top-24 z-[190] -translate-x-1/2">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-lowest shadow-lg ring-1 ring-black/5">
            <Loader2 className="h-5 w-5 animate-spin text-secondary" aria-hidden="true" />
            <span className="sr-only">Cargando la página</span>
          </span>
        </div>
      )}
      {/* Bloque 135: aviso aparte si la carga pasa de 4 segundos. */}
      <StuckPageHelper />
    </>
  );
}
