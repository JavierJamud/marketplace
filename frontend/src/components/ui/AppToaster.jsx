import { useEffect, useState } from "react";
import { Toaster } from "sileo";

// Contenedor de los avisos (Sileo) para todo el sitio. Arriba al centro en el teléfono, donde cae la vista y el pulgar no
// lo tapa; arriba a la derecha en pantallas grandes, fuera del contenido. Fondo azul marino de la marca (#0e1a28) en vez del
// negro por defecto de Sileo, para que el aviso se sienta parte de Baznova. Los ajustes visuales están en index.css (.sileo).
//
// Siempre por debajo de la barra de menú (la del sitio, o el buscador fijo de arriba en los paneles de tienda y admin): antes
// salían encima y la tapaban. Las barras llevan data-toast-anchor; se mide dónde termina la que se ve y el aviso se coloca
// justo debajo. Se vuelve a medir al desplazar la página o cambiar el tamaño, porque la barra de los paneles sube al bajar.
const DESKTOP = "(min-width: 768px)";
const GAP = 8;

function anchorBottom() {
  let bottom = 0;
  for (const el of document.querySelectorAll("[data-toast-anchor]")) {
    const r = el.getBoundingClientRect();
    if (r.height && r.bottom > 0 && r.top < window.innerHeight) bottom = Math.max(bottom, r.bottom);
  }
  return Math.round(bottom);
}

export function AppToaster() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(DESKTOP).matches);
  const [top, setTop] = useState(GAP);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);

  useEffect(() => {
    let frame = 0;
    const measure = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => setTop(anchorBottom() + GAP));
    };
    measure();
    window.addEventListener("scroll", measure, { passive: true });
    window.addEventListener("resize", measure);
    // Al cambiar de pantalla (o de panel) la barra puede aparecer, desaparecer o cambiar de alto.
    const observer = new MutationObserver(measure);
    observer.observe(document.body, { childList: true, subtree: true });
    return () => {
      cancelAnimationFrame(frame);
      window.removeEventListener("scroll", measure);
      window.removeEventListener("resize", measure);
      observer.disconnect();
    };
  }, []);

  return <Toaster position={wide ? "top-right" : "top-center"} offset={{ top }} theme="light" options={{ fill: "#0e1a28" }} />;
}
