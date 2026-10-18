import { useEffect, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Abre un registro concreto al llegar desde un aviso (campanita, push o correo del admin): la URL trae ?<param>=<id>, la fila
// lleva data-focus-id={id} y, cuando la lista ya cargó, se desplaza hasta ella y queda resaltada unos segundos.
// Devuelve el id buscado para que la página marque la fila (por ejemplo, con un borde).
export function useFocusFromQuery(param, ready) {
  const [params] = useSearchParams();
  const id = params.get(param);
  const [active, setActive] = useState(null);

  useEffect(() => {
    if (!id || !ready) return undefined;
    const el = document.querySelector(`[data-focus-id="${CSS.escape(id)}"]`);
    if (!el) return undefined;
    el.scrollIntoView({ block: "center", behavior: "smooth" });
    setActive(id);
    const t = setTimeout(() => setActive(null), 4000);
    return () => clearTimeout(t);
  }, [id, ready]);

  return active;
}
