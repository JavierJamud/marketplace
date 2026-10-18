import { useEffect, useId, useMemo, useRef, useState } from "react";
import { ChevronDown } from "lucide-react";
import clsx from "clsx";
import { matchesQuery } from "./SearchBox.jsx";

// Selector con búsqueda en el mismo campo: se escribe para filtrar y las coincidencias aparecen en la lista, con su
// icono delante. Solo vale una opción de la lista: lo escrito nunca se guarda como valor. Al salir del campo sin elegir,
// el texto vuelve a la opción vigente.
//   options: [{ value, label, icon? }]   icon es un nodo de React ya armado (por ejemplo, <CategoryIcon />).
//   allOption: { label } agrega una primera opción de valor "" (por ejemplo "Todos los tipos de negocio").
//   maxShown: con listas muy largas (las ciudades de un estado) solo se dibujan las primeras coincidencias y se pide seguir
//   escribiendo para afinar; así la lista abre rápido también en un celular.
export function ComboSelect({ label, required, value, onChange, options, placeholder = "Escribe para buscar", allOption, error, className, size = "md", emptyText = "No hay coincidencias", maxShown, disabled }) {
  const id = useId();
  const rootRef = useRef(null);
  const listRef = useRef(null);
  const inputRef = useRef(null);
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);

  const all = useMemo(() => (allOption ? [{ value: "", label: allOption.label }, ...options] : options), [allOption, options]);
  const selected = all.find((o) => o.value === value) ?? null;
  const matches = useMemo(() => all.filter((o) => matchesQuery(o.label, query)), [all, query]);
  const filtered = maxShown ? matches.slice(0, maxShown) : matches;
  const shownText = open ? query : selected?.label ?? "";

  useEffect(() => {
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  // Sin opción vigente el campo no pasa la validación del formulario, aunque tenga texto escrito.
  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !value ? "Elige una opción de la lista." : "");
  }, [required, value]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function close() {
    setOpen(false);
    setQuery("");
  }

  function choose(o) {
    onChange(o.value);
    close();
  }

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      if (!open) setOpen(true);
      setActive((i) => Math.min(i + 1, filtered.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActive((i) => Math.max(i - 1, 0));
    } else if (e.key === "Enter" && open) {
      e.preventDefault();
      if (filtered[active]) choose(filtered[active]);
    } else if (e.key === "Escape" && open) {
      e.preventDefault();
      close();
    } else if (e.key === "Tab") {
      close();
    }
  }

  const height = size === "sm" ? "h-10 text-[13px] font-semibold" : "h-11 text-body-md";

  return (
    <div ref={rootRef} className={clsx("relative", className)}>
      {label && (
        <label htmlFor={id} className="mb-1 block text-label-md text-on-surface-variant">
          {label}
          {required && <span className="text-error"> *</span>}
        </label>
      )}
      <div className="relative">
        {selected && !open && selected.icon && <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2">{selected.icon}</span>}
        <input
          ref={inputRef}
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={`${id}-lista`}
          aria-autocomplete="list"
          autoComplete="off"
          required={required}
          disabled={disabled}
          value={shownText}
          placeholder={placeholder}
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setActive(Math.max(0, all.findIndex((o) => o.value === value)));
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
          }}
          onKeyDown={onKeyDown}
          className={clsx(
            "w-full rounded border bg-surface-container-lowest pr-10 text-on-surface outline-none transition-colors placeholder:text-outline focus:border-primary-container",
            selected && !open && selected.icon ? "pl-11" : "pl-4",
            error ? "border-error" : "border-outline-variant",
            height
          )}
        />
        <button
          type="button"
          tabIndex={-1}
          aria-label={open ? "Cerrar lista" : "Abrir lista"}
          onClick={() => (open ? close() : inputRef.current?.focus())}
          className="absolute right-0 top-0 flex h-full w-10 items-center justify-center text-outline"
        >
          <ChevronDown className={clsx("h-4 w-4 transition-transform", open && "rotate-180")} />
        </button>
      </div>

      {open && (
        <ul
          ref={listRef}
          id={`${id}-lista`}
          role="listbox"
          className="absolute left-0 right-0 z-30 mt-1 max-h-64 overflow-y-auto rounded-lg border border-outline-variant bg-surface-container-lowest py-1 shadow-lg"
        >
          {filtered.length === 0 && <li className="px-4 py-3 text-[13px] text-on-surface-variant">{emptyText}</li>}
          {filtered.map((o, i) => (
            <li
              key={o.value || "__todos"}
              role="option"
              aria-selected={o.value === value}
              data-active={i === active}
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => choose(o)}
              onMouseEnter={() => setActive(i)}
              className={clsx(
                "flex min-h-11 cursor-pointer items-center gap-3 px-4 py-2 text-[14px] text-on-surface",
                i === active && "bg-surface-container",
                o.value === value && "font-bold"
              )}
            >
              {o.icon && <span className="flex h-6 w-6 flex-shrink-0 items-center justify-center">{o.icon}</span>}
              <span>{o.label}</span>
            </li>
          ))}
          {matches.length > filtered.length && (
            <li className="px-4 py-2 text-[12.5px] text-on-surface-variant">
              Hay {matches.length.toLocaleString("es-CU")} coincidencias: sigue escribiendo para encontrar la tuya.
            </li>
          )}
        </ul>
      )}
      {error && <span className="mt-1 block text-label-sm text-error">{error}</span>}
    </div>
  );
}
