import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { useIsFetching } from "@tanstack/react-query";
import { Loader2 } from "lucide-react";
import { releaseStaleScrollLock } from "../../lib/scrollLock.js";

// Bloque 135 (pedido explícito — "quiero un loader normal para cuando se
// cambia entre páginas, en caso de que alguna se quede atascada"): la barra
// de arriba (Bloque 17, sin cambios) es puramente cosmética — un timer fijo
// de ~710ms que SIEMPRE termina y desaparece, sin ninguna relación real con
// si los datos de la página de destino ya cargaron. Eso significa que si
// una página se queda de verdad atascada (backend lento/caído, red mala),
// la barra igual desaparece a los 710ms y el visitante se queda viendo una
// pantalla en blanco o a medio cargar SIN ningún indicio de que algo sigue
// pasando. `useIsFetching()` de React Query es la señal REAL — cuenta las
// queries en vuelo en TODA la app en cualquier momento; si se mantiene
// activa 4 segundos seguidos (muy por encima de lo que tarda cualquier
// carga normal), se muestra un spinner aparte, chico y no bloqueante, con
// un mensaje explícito de que sigue intentando — así el visitante nunca se
// queda sin feedback, sin tapar el contenido que ya haya cargado.
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

// Barra de progreso superior (Bloque 17), ahora atada a la carga real: arranca en cada cambio de página y, si los datos de la
// página nueva aún no llegaron, se queda esperando (al 92 %) hasta que terminen, con un tope de 6 segundos para que una consulta
// que se repite sola en segundo plano nunca la deje fija. Si la espera pasa de ~1 segundo se suma un indicador sencillo (un
// círculo girando, no es el loader principal de la marca) para que el visitante nunca vea una pantalla a medias sin ninguna
// señal de que la página está cargando. No bloquea nada: no tapa el contenido ni recibe toques.
const SPINNER_AFTER_MS = 1000;
const MAX_WAIT_MS = 6000;

export function RouteLoader() {
  const location = useLocation();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const [waiting, setWaiting] = useState(false);
  const [spinner, setSpinner] = useState(false);
  const timeoutsRef = useRef([]);
  const busy = useIsFetching() > 0;
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];
    setWaiting(false);
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

    setVisible(true);
    setProgress(20);

    const finish = () => {
      setWaiting(false);
      setSpinner(false);
      setProgress(100);
      timeoutsRef.current.push(setTimeout(() => setVisible(false), 250));
    };
    timeoutsRef.current.push(setTimeout(() => setProgress(70), 120));
    timeoutsRef.current.push(
      setTimeout(() => {
        setProgress(92);
        // Si ya no hay nada cargando, termina como siempre; si no, espera (ver el efecto de `busy`) hasta MAX_WAIT_MS.
        if (!busyRef.current) return;
        setWaiting(true);
        timeoutsRef.current.push(setTimeout(finish, MAX_WAIT_MS));
      }, 320)
    );
    timeoutsRef.current.push(
      setTimeout(() => {
        if (!busyRef.current) return;
        setSpinner(true);
      }, SPINNER_AFTER_MS)
    );
    timeoutsRef.current.push(
      setTimeout(() => {
        if (busyRef.current) return; // sigue cargando: el efecto de `busy` la cierra cuando termine
        finish();
      }, 460)
    );

    return () => timeoutsRef.current.forEach(clearTimeout);
  }, [location.pathname]);

  // La carga real terminó mientras la barra esperaba: se completa y se quita el indicador.
  useEffect(() => {
    if (busy || !waiting) return;
    setWaiting(false);
    setSpinner(false);
    setProgress(100);
    timeoutsRef.current.push(setTimeout(() => setVisible(false), 250));
  }, [busy, waiting]);

  // Si lo que cargaba terminó antes de que el indicador llegara a verse, no se muestra.
  useEffect(() => {
    if (!busy) setSpinner(false);
  }, [busy]);

  return (
    <>
      {visible && (
        <div className="fixed left-0 top-0 z-[200] h-[3px] w-full bg-transparent">
          <div
            className="h-full bg-secondary-container"
            style={{
              width: `${progress}%`,
              opacity: progress === 100 ? 0 : 1,
              transition: progress === 100 ? "opacity 250ms ease-out, width 300ms ease-out" : "width 300ms ease-out",
            }}
          />
        </div>
      )}
      {spinner && visible && (
        <div role="status" aria-live="polite" className="pointer-events-none fixed left-1/2 top-24 z-[190] -translate-x-1/2">
          <span className="flex h-11 w-11 items-center justify-center rounded-full bg-surface-container-lowest shadow-lg ring-1 ring-black/5">
            <Loader2 className="h-5 w-5 animate-spin text-secondary" aria-hidden="true" />
            <span className="sr-only">Cargando la página</span>
          </span>
        </div>
      )}
      {/* Bloque 135: independiente de `visible` de arriba a propósito — la
          barra siempre termina a los ~710ms pase lo que pase, este helper
          necesita seguir vivo mientras haya queries en vuelo de verdad. */}
      <StuckPageHelper />
    </>
  );
}
