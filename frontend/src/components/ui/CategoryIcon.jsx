import * as Icons from "lucide-react";
import { Store } from "lucide-react";

// Bloque 18: resuelve el nombre de ícono guardado en BusinessCategory.icon a
// un componente real de lucide-react — así el admin solo guarda un string
// (validado en el backend contra la librería real) y acá se resuelve
// dinámicamente, sin mapa hardcodeado que haya que tocar por cada categoría
// nueva. "Store" como fallback si algún día el nombre guardado dejara de
// existir en una versión futura de lucide-react.
export function CategoryIcon({ name, className }) {
  const Icon = (name && Icons[name]) || Store;
  return <Icon className={className} />;
}
