import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";

// Barra de progreso superior (Bloque 17) — no espera ninguna señal real de
// "ruta cargada" (no hay code-splitting/Suspense en App.jsx, el cambio de
// componente es sincrónico): es una animación de progreso percibido estilo
// NProgress, se reinicia en cada cambio de ruta para dar sensación de
// transición sin bloquear la interacción.
export function RouteLoader() {
  const location = useLocation();
  const [progress, setProgress] = useState(0);
  const [visible, setVisible] = useState(false);
  const timeoutsRef = useRef([]);

  useEffect(() => {
    timeoutsRef.current.forEach(clearTimeout);
    timeoutsRef.current = [];

    // Bloque 52 (pedido explícito): React Router no resetea el scroll al
    // navegar (a diferencia de una navegación de página completa normal) —
    // sin esto, entrar a una página nueva desde el final de una lista larga
    // (ej. "También te puede interesar") la mostraba a mitad de scroll en
    // vez de arriba del todo. Solo depende de pathname (no de location
    // completa) para no pisar un scroll-a-sección por hash dentro de la
    // MISMA página (ver Store.jsx `#resenas`).
    window.scrollTo(0, 0);

    setVisible(true);
    setProgress(20);

    timeoutsRef.current.push(setTimeout(() => setProgress(70), 120));
    timeoutsRef.current.push(setTimeout(() => setProgress(92), 320));
    timeoutsRef.current.push(
      setTimeout(() => {
        setProgress(100);
        timeoutsRef.current.push(setTimeout(() => setVisible(false), 250));
      }, 460)
    );

    return () => timeoutsRef.current.forEach(clearTimeout);
  }, [location.pathname]);

  if (!visible) return null;

  return (
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
  );
}
