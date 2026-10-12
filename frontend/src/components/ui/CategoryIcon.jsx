import { useEffect, useState } from "react";
import { Store } from "lucide-react";

// Ícono de un tipo de negocio a partir del nombre guardado en BusinessCategory.icon (validado en el backend contra
// lucide-react). Antes se importaba la librería entera para resolver el nombre, lo que metía cientos de KB de íconos en la
// primera carga del sitio. Ahora cada ícono se descarga por separado solo cuando se usa (y queda en memoria). Si un nombre
// no tiene archivo propio (un alias antiguo) se muestra el ícono de tienda.
const loaders = import.meta.glob("/node_modules/lucide-react/dist/esm/icons/*.js");
const cache = new Map();

const toFile = (name) =>
  `/node_modules/lucide-react/dist/esm/icons/${name
    .replace(/([a-z0-9])([A-Z])/g, "$1-$2")
    .replace(/([A-Za-z])([0-9])/g, "$1-$2")
    .toLowerCase()}.js`;

async function loadIcon(name) {
  if (cache.has(name)) return cache.get(name);
  let Icon = null;
  const loader = loaders[toFile(name)];
  if (loader) Icon = (await loader()).default ?? null;
  cache.set(name, Icon ?? Store);
  return cache.get(name);
}

export function CategoryIcon({ name, className }) {
  const [Icon, setIcon] = useState(() => (name ? cache.get(name) : Store) ?? null);

  useEffect(() => {
    if (!name) return setIcon(() => Store);
    let alive = true;
    loadIcon(name)
      .then((I) => alive && setIcon(() => I))
      .catch(() => alive && setIcon(() => Store));
    return () => {
      alive = false;
    };
  }, [name]);

  // Mientras llega el ícono se reserva su espacio, para que nada se mueva.
  if (!Icon) return <span className={`inline-block ${className ?? ""}`} aria-hidden="true" />;
  return <Icon className={className} />;
}
