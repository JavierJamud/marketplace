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
