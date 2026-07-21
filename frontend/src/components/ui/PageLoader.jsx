import { useEffect, useState } from "react";
import { Loader2 } from "lucide-react";

// Delay antes de mostrarse (Bloque 17) — evita el parpadeo en cargas casi
// instantáneas (ej. respuesta ya en caché de React Query): si los datos
// llegan antes de ANTI_FLASH_MS, el loader nunca llega a pintarse.
const ANTI_FLASH_MS = 200;

export function PageLoader({ full = true, label = "Cargando..." }) {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const t = setTimeout(() => setShow(true), ANTI_FLASH_MS);
    return () => clearTimeout(t);
  }, []);

  if (!show) return null;

  return (
    <div className={`flex flex-col items-center justify-center gap-3 ${full ? "min-h-[60vh]" : "py-20"}`}>
      <div className="flex h-12 w-12 items-center justify-center rounded-full bg-secondary-container/15">
        <Loader2 className="h-6 w-6 animate-spin text-tertiary-accent" />
      </div>
      <p className="text-label-sm text-outline">{label}</p>
    </div>
  );
}
