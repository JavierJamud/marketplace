import { useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";

// Bloque 241 (pedido explícito — listas del admin que escalen a miles): la
// página, los filtros y el orden viven en la URL, no en useState. Motivo: al
// recargar, volver atrás o pasarle el enlace a otra persona del equipo, se
// ve la misma lista con los mismos filtros. `defaults` tiene que ser un
// objeto constante de módulo (si se recrea en cada render, useMemo se
// invalida y la lista parpadea). Un valor igual a su default no se escribe en
// la URL, así la dirección limpia se queda corta.
export function useListParams(defaults) {
  const [searchParams, setSearchParams] = useSearchParams();

  const params = useMemo(() => {
    const out = {};
    for (const [key, def] of Object.entries(defaults)) {
      const raw = searchParams.get(key);
      if (raw == null) out[key] = def;
      else out[key] = typeof def === "number" ? Number(raw) || def : raw;
    }
    return out;
  }, [searchParams, defaults]);

  // Cambiar cualquier filtro vuelve a la página 1 (la página 7 de un filtro
  // distinto casi nunca existe); solo setParams({ page }) la conserva.
  const setParams = useCallback(
    (patch) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev);
          const merged = "page" in patch ? patch : { ...patch, page: 1 };
          for (const [key, value] of Object.entries(merged)) {
            if (value === "" || value == null || value === defaults[key]) next.delete(key);
            else next.set(key, String(value));
          }
          return next;
        },
        { replace: true }
      );
    },
    [setSearchParams, defaults]
  );

  return [params, setParams];
}

// Búsqueda con espera: el input responde al instante (estado local) y la
// URL/consulta solo se actualizan cuando el usuario deja de escribir.
export function useDebouncedSearch(value, onCommit, delay = 300) {
  const [text, setText] = useState(value);

  // Si la URL cambia desde afuera (botón "Limpiar filtros", atrás del
  // navegador), el input la sigue.
  useEffect(() => {
    setText(value);
  }, [value]);

  useEffect(() => {
    if (text.trim() === value) return undefined;
    const timer = setTimeout(() => onCommit(text.trim()), delay);
    return () => clearTimeout(timer);
  }, [text, value, onCommit, delay]);

  return [text, setText];
}
