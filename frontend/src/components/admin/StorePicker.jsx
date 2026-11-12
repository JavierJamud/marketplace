import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { SearchBox } from "../ui/SearchBox.jsx";

// Elegir tiendas concretas (avisos del panel, mensaje masivo por WhatsApp). Busca en el mismo listado de Admin → WhatsApp →
// Tiendas. `filter` "on" muestra solo las que tienen los avisos de WhatsApp activos. `value`: [{ id, companyName }].
// Lo que conviene saber al elegir: estas tiendas no reciben mensajes por WhatsApp aunque se elijan.
const STATE_NOTE = { OPTED_OUT: "respondió BAJA", CHANGED: "cambió de número sin confirmarlo", OFF: "sin avisos por WhatsApp" };

export function StorePicker({ value, onChange, filter = "all", label = "Tiendas elegidas" }) {
  const [q, setQ] = useState("");
  const [query, setQuery] = useState("");
  useEffect(() => {
    const id = setTimeout(() => setQuery(q.trim()), 300);
    return () => clearTimeout(id);
  }, [q]);

  const { data, isFetching, isError } = useQuery({
    queryKey: ["admin-store-picker", filter, query],
    queryFn: () => api.get("/admin/whatsapp/vendors", { params: { filter, q: query } }).then((r) => r.data),
    enabled: query.length >= 2,
  });

  const chosen = new Set(value.map((v) => v.id));
  const results = (data?.vendors ?? []).filter((v) => !chosen.has(v.id)).slice(0, 6);
  const add = (v) => {
    onChange([...value, { id: v.id, companyName: v.companyName }]);
    setQ("");
  };
  const remove = (id) => onChange(value.filter((v) => v.id !== id));

  return (
    <div>
      <span className="mb-1 block text-label-md text-on-surface-variant">
        {label}{value.length ? ` (${value.length})` : ""}
      </span>
      {value.length > 0 && (
        <ul className="mb-2 flex flex-wrap gap-1.5">
          {value.map((v) => (
            <li key={v.id} className="flex max-w-full items-center gap-1 rounded-full bg-surface-container py-1 pl-3 pr-1 text-[12.5px] font-semibold text-on-surface">
              <span className="min-w-0 truncate">{v.companyName}</span>
              <button
                type="button"
                onClick={() => remove(v.id)}
                aria-label={`Quitar ${v.companyName}`}
                className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:bg-surface-container-high"
              >
                <X className="h-3.5 w-3.5" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <SearchBox value={q} onChange={setQ} label="Buscar tienda para agregar" placeholder="Escribe el nombre de la tienda" />
      {query.length >= 2 && (
        <div className="mt-1.5 rounded-xl border border-surface-container-high">
          {isError ? (
            <p className="px-3 py-2.5 text-[12.5px] text-error">No se pudo buscar. Prueba otra vez.</p>
          ) : isFetching && !data ? (
            <p className="px-3 py-2.5 text-[12.5px] text-on-surface-variant">Buscando...</p>
          ) : results.length === 0 ? (
            <p className="px-3 py-2.5 text-[12.5px] text-on-surface-variant">
              {filter === "on" ? "Ninguna tienda con WhatsApp activo coincide." : "Ninguna tienda coincide."}
            </p>
          ) : (
            <ul className="divide-y divide-surface-container-high">
              {results.map((v) => (
                <li key={v.id}>
                  <button
                    type="button"
                    onClick={() => add(v)}
                    className="flex min-h-11 w-full items-center justify-between gap-3 px-3 py-2 text-left hover:bg-surface-container"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-[13.5px] font-semibold text-on-surface">{v.companyName}</span>
                      <span className="block text-[12px] text-on-surface-variant">
                        {v.whatsapp || "Sin WhatsApp"}
                        {STATE_NOTE[v.state] ? ` · ${STATE_NOTE[v.state]}` : ""}
                      </span>
                    </span>
                    <Plus className="h-4 w-4 flex-shrink-0 text-on-surface-variant" aria-hidden="true" />
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
