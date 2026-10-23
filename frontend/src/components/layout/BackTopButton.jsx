import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft } from "lucide-react";

// Botón flotante de las páginas públicas (pedido del dueño): arriba de la página lleva a la sección anterior; cuando la
// persona ya bajó mucho (más de pantalla y media) o llegó al final, la flecha gira hacia arriba y sube al inicio de la
// página. Va abajo a la izquierda porque abajo a la derecha está el chat y en el centro el aviso de carga de página.
// z-40: por debajo de los modales y del carrito (z-50 o más), para no taparlos. Mientras la persona baja leyendo se esconde
// (no tapa tarjetas ni textos) y vuelve al subir, al llegar al final o arriba de la página.
export function BackTopButton() {
  const { pathname } = useLocation();
  const navigate = useNavigate();
  const [up, setUp] = useState(false);
  const [hidden, setHidden] = useState(false);

  useEffect(() => {
    let frame = 0;
    let lastY = window.scrollY;
    const check = () => {
      frame = 0;
      const y = window.scrollY;
      const vh = window.innerHeight;
      const atBottom = y + vh >= document.documentElement.scrollHeight - 120;
      setUp(y > vh * 1.5 || (atBottom && y > 200));
      // Bajando (más de 8px) se esconde; subiendo, arriba de todo o al final, se muestra.
      if (y < 80 || atBottom || y < lastY - 8) setHidden(false);
      else if (y > lastY + 8) setHidden(true);
      if (Math.abs(y - lastY) > 8) lastY = y;
    };
    const onScroll = () => {
      if (!frame) frame = requestAnimationFrame(check);
    };
    setHidden(false);
    check();
    window.addEventListener("scroll", onScroll, { passive: true });
    window.addEventListener("resize", onScroll);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener("scroll", onScroll);
      window.removeEventListener("resize", onScroll);
    };
  }, [pathname]);

  // En la portada no hay "atrás" dentro del sitio: solo aparece para subir.
  if (pathname === "/" && !up) return null;

  function handleClick() {
    if (up) {
      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
      return;
    }
    // idx > 0: hay una página anterior dentro del sitio. Si se entró directo por un enlace, "atrás" sacaría del sitio:
    // en ese caso lleva a la portada.
    if ((window.history.state?.idx ?? 0) > 0) navigate(-1);
    else navigate("/");
  }

  const label = up ? "Volver arriba" : "Volver atrás";
  return (
    <button
      type="button"
      onClick={handleClick}
      aria-label={label}
      title={label}
      tabIndex={hidden ? -1 : undefined}
      aria-hidden={hidden || undefined}
      className={`fixed bottom-5 left-5 z-40 flex h-12 w-12 items-center justify-center rounded-full border border-surface-container-high bg-surface-container-lowest text-on-surface shadow-[0_10px_28px_-8px_rgba(14,26,40,0.38)] transition-[transform,opacity,background-color] duration-300 ease-out motion-reduce:transition-none ${hidden ? "pointer-events-none translate-y-20 opacity-0" : "translate-y-0 opacity-100"} hover:bg-surface-container focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-tertiary-accent sm:bottom-6 sm:left-6 [html[data-camera-open]_&]:hidden`}
    >
      <ArrowLeft
        className={`h-5 w-5 transition-transform duration-300 ease-out motion-reduce:transition-none ${up ? "rotate-90" : ""}`}
        aria-hidden="true"
      />
    </button>
  );
}
