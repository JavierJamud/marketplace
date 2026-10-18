import { useEffect, useState } from "react";
import { Toaster } from "sileo";

// Contenedor de los avisos (Sileo) para todo el sitio. Arriba al centro en el teléfono, donde cae la vista y el pulgar no
// lo tapa; arriba a la derecha en pantallas grandes, fuera del contenido. Fondo azul marino de la marca (#0e1a28) en vez del
// negro por defecto de Sileo, para que el aviso se sienta parte de Baznova. Los ajustes visuales están en index.css (.sileo).
const DESKTOP = "(min-width: 768px)";

export function AppToaster() {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && window.matchMedia(DESKTOP).matches);
  useEffect(() => {
    const mq = window.matchMedia(DESKTOP);
    const on = () => setWide(mq.matches);
    mq.addEventListener("change", on);
    return () => mq.removeEventListener("change", on);
  }, []);
  return <Toaster position={wide ? "top-right" : "top-center"} offset={{ top: 8 }} theme="light" options={{ fill: "#0e1a28" }} />;
}
