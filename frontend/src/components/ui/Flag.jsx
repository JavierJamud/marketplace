import { useState } from "react";

// Bandera de un país por su código ISO de 2 letras. Los SVG viven en /public/flags (uno por país, el navegador solo baja los que
// se ven). Los emojis de bandera no sirven: Windows no los dibuja y se ven como dos letras. Si no existe la bandera, no se
// muestra nada en su lugar.
export function Flag({ code, className = "" }) {
  const [broken, setBroken] = useState(false);
  if (!code || broken) return null;
  return (
    <img
      src={`/flags/${String(code).toLowerCase()}.svg`}
      alt=""
      width={24}
      height={16}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className={`h-4 w-6 flex-shrink-0 rounded-[2px] object-cover ring-1 ring-black/10 ${className}`}
    />
  );
}
