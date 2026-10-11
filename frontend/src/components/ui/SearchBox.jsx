import { Search, X } from "lucide-react";

// Cuadro de búsqueda para filtrar listas largas (categorías, provincias, etc.). Mide 44 px de alto, tiene botón para
// borrar y una etiqueta accesible. El filtrado lo hace quien lo usa con `matchesQuery` (sin importar tildes ni mayúsculas).
export function SearchBox({ value, onChange, placeholder = "Buscar...", label, className = "", resultText }) {
  return (
    <div className={className}>
      <div className="relative">
        <Search className="pointer-events-none absolute left-3.5 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" aria-hidden="true" />
        <input
          type="search"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          aria-label={label ?? placeholder}
          className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-10 pr-11 text-[14px] text-on-surface outline-none transition-colors placeholder:text-outline focus:border-tertiary-accent focus:ring-2 focus:ring-tertiary-accent/25 [&::-webkit-search-cancel-button]:hidden"
        />
        {value && (
          <button type="button" onClick={() => onChange("")} aria-label="Borrar búsqueda" className="absolute right-0 top-1/2 flex h-11 w-11 -translate-y-1/2 items-center justify-center text-outline hover:text-on-surface">
            <X className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </div>
      {resultText && <p className="mt-1.5 text-[12px] text-outline" aria-live="polite">{resultText}</p>}
    </div>
  );
}

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

// ¿El texto contiene lo buscado? Ignora tildes y mayúsculas; una búsqueda vacía acepta todo.
export function matchesQuery(text, query) {
  const q = fold(query);
  return !q || fold(text).includes(q);
}
