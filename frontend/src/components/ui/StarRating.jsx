import { Star } from "lucide-react";

// Bloque 23: componente único de estrellas para todo el sitio — antes cada
// pantalla mostraba el rating de una forma distinta (texto "★ 4.5" plano en
// unas, 5 iconos todo-o-nada redondeados en otras). Acá el relleno es
// proporcional de verdad: una fila de 5 estrellas vacías de base, y encima
// una segunda fila de 5 estrellas llenas recortada al (value/5)*100% de
// ancho — como las dos filas tienen exactamente el mismo layout (mismo
// tamaño, mismo gap), el recorte cae justo a la mitad/tercio/etc. de la
// estrella que corresponda, en vez de saltar de "vacía" a "llena" entera.
export function StarRating({ value = 0, size = "h-4 w-4", showValue = false, count, className = "" }) {
  const clamped = Math.max(0, Math.min(5, Number(value) || 0));
  const pct = (clamped / 5) * 100;

  return (
    <div className={`inline-flex items-center gap-1.5 ${className}`}>
      <div className="relative inline-flex">
        <div className="flex gap-0.5" aria-hidden="true">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} className={`${size} fill-none text-outline-variant`} />
          ))}
        </div>
        <div className="absolute left-0 top-0 flex h-full gap-0.5 overflow-hidden" style={{ width: `${pct}%` }} aria-hidden="true">
          {[1, 2, 3, 4, 5].map((n) => (
            <Star key={n} className={`${size} flex-shrink-0 fill-secondary-container text-secondary-container`} />
          ))}
        </div>
      </div>
      <span className="sr-only">{clamped.toFixed(1)} de 5 estrellas</span>
      {/* Sin color propio a propósito — hereda el del texto que lo rodea
          (blanco en el banner oscuro de Store.jsx, gris oscuro en una card
          clara, etc.) en vez de romper el contraste según dónde se use. */}
      {showValue && <span className="text-label-sm font-bold">{clamped.toFixed(1)}</span>}
      {count != null && <span className="text-label-sm opacity-70">({count})</span>}
    </div>
  );
}
