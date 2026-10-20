import { useEffect, useState } from "react";
import { PageSkeleton } from "./Skeleton.jsx";

// Delay antes de mostrarse (Bloque 17) — evita el parpadeo en cargas casi
// instantáneas (ej. respuesta ya en caché de React Query): si los datos
// llegan antes de ANTI_FLASH_MS, el loader nunca llega a pintarse.
// Mientras se descarga el código de una pantalla se muestra un esqueleto de página (título, texto y bloques) en vez del círculo
// girando, igual que el resto del sitio.
const ANTI_FLASH_MS = 200;

export function PageLoader() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), ANTI_FLASH_MS);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  return <PageSkeleton />;
}
