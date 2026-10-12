import { useEffect, useId, useMemo, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { ChevronDown, Plus, Check } from "lucide-react";
import clsx from "clsx";
import toast from "../lib/toast.jsx";
import { api } from "../lib/api.js";
import { matchesQuery } from "./ui/SearchBox.jsx";

// Selector de categoría de producto: se escribe para buscar entre todas las categorías y subcategorías ("Tecnología › Celulares y
// smartphones") y se elige una de la lista. Si la categoría no existe, se puede crear una nueva al momento (con su categoría
// principal): queda disponible para todos y el admin puede revisarla, renombrarla, moverla o eliminarla.
//   categories: árbol que devuelve GET /categories ([{ id, name, children: [{ id, name }] }])
export function CategoryPicker({ label = "Categoría", required, value, onChange, categories }) {
  const id = useId();
  const rootRef = useRef(null);
  const inputRef = useRef(null);
  const listRef = useRef(null);
  const queryClient = useQueryClient();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState(0);
  const [creating, setCreating] = useState(false);
  const [parentId, setParentId] = useState("");

  // Lista plana: cada categoría principal (si no tiene subcategorías, o como "general") y cada subcategoría con su ruta.
  const options = useMemo(() => {
    const out = [];
    for (const c of categories ?? []) {
      out.push({ id: c.id, label: c.name, path: c.name, isParent: true, hasChildren: !!c.children?.length });
      for (const ch of c.children ?? []) out.push({ id: ch.id, label: ch.name, path: `${c.name} › ${ch.name}`, parent: c.name });
    }
    return out;
  }, [categories]);

  const selected = options.find((o) => o.id === value) ?? null;
  const filtered = useMemo(() => options.filter((o) => matchesQuery(o.path, query)).slice(0, 80), [options, query]);
  const exact = options.some((o) => matchesQuery(o.label, query) && matchesQuery(query, o.label));
  const canCreate = query.trim().length >= 2 && !exact;

  useEffect(() => {
    const onDoc = (e) => {
      if (rootRef.current && !rootRef.current.contains(e.target)) close();
    };
    document.addEventListener("pointerdown", onDoc);
    return () => document.removeEventListener("pointerdown", onDoc);
  }, []);

  useEffect(() => {
    inputRef.current?.setCustomValidity(required && !value ? "Elige una categoría de la lista." : "");
  }, [required, value]);

  useEffect(() => {
    listRef.current?.querySelector('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [active, open]);

  function close() {
    setOpen(false);
    setQuery("");
    setCreating(false);
  }

  function choose(o) {
    onChange(o.id);
    close();
  }

  const create = useMutation({
    mutationFn: async () => (await api.post("/categories", { name: query.trim(), parentId: parentId || null })).data,
    onSuccess: ({ category, existing }) => {
      queryClient.invalidateQueries({ queryKey: ["categories"] });
      toast.success(existing ? `Ya existía "${category.name}": la seleccionamos.` : `Categoría "${category.name}" creada.`);
      onChange(category.id);
      close();
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo crear la categoría."),
  });

  function onKeyDown(e) {
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setOpen(true);
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

  return (
    <div ref={rootRef} className="relative">
      <label htmlFor={id} className="mb-1 block text-label-md text-on-surface-variant">
        {label}
        {required && <span className="text-error"> *</span>}
      </label>
      <div className="relative">
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
          value={open ? query : selected?.path ?? ""}
          placeholder="Escribe para buscar: celulares, ropa de mujer, repuestos..."
          onFocus={() => {
            setOpen(true);
            setQuery("");
            setActive(0);
          }}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            setActive(0);
            setCreating(false);
          }}
          onKeyDown={onKeyDown}
          className="h-11 w-full rounded border border-outline-variant bg-surface-container-lowest pl-4 pr-10 text-body-md text-on-surface outline-none transition-colors placeholder:text-outline focus:border-primary-container"
        />
        <ChevronDown className={clsx("pointer-events-none absolute right-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline transition-transform", open && "rotate-180")} aria-hidden="true" />
      </div>

      {open && (
        <div className="absolute left-0 right-0 z-30 mt-1 overflow-hidden rounded-lg border border-outline-variant bg-surface-container-lowest shadow-lg">
          <ul ref={listRef} id={`${id}-lista`} role="listbox" className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 && !canCreate && <li className="px-4 py-3 text-[13px] text-on-surface-variant">Escribe para buscar una categoría.</li>}
            {filtered.length === 0 && canCreate && <li className="px-4 py-3 text-[13px] text-on-surface-variant">No hay ninguna categoría con ese nombre.</li>}
            {filtered.map((o, i) => (
              <li
                key={o.id}
                role="option"
                aria-selected={o.id === value}
                data-active={i === active}
                onPointerDown={(e) => e.preventDefault()}
                onClick={() => choose(o)}
                onMouseEnter={() => setActive(i)}
                className={clsx("flex min-h-11 cursor-pointer items-center justify-between gap-3 px-4 py-2 text-[14px] text-on-surface", i === active && "bg-surface-container")}
              >
                <span className="min-w-0">
                  {o.parent ? (
                    <>
                      <span className="text-outline">{o.parent} › </span>
                      <span className={o.id === value ? "font-bold" : ""}>{o.label}</span>
                    </>
                  ) : (
                    <span className="font-semibold">
                      {o.label}
                      {o.hasChildren && <span className="font-normal text-outline"> (general)</span>}
                    </span>
                  )}
                </span>
                {o.id === value && <Check className="h-4 w-4 flex-shrink-0 text-tertiary-accent" aria-hidden="true" />}
              </li>
            ))}
          </ul>

          {canCreate && !creating && (
            <button
              type="button"
              onPointerDown={(e) => e.preventDefault()}
              onClick={() => setCreating(true)}
              className="flex min-h-11 w-full items-center gap-2 border-t border-surface-container px-4 text-left text-[13px] font-semibold text-tertiary-accent hover:bg-surface-container"
            >
              <Plus className="h-4 w-4" aria-hidden="true" /> Crear la categoría “{query.trim()}”
            </button>
          )}

          {canCreate && creating && (
            <div className="flex flex-col gap-2 border-t border-surface-container p-3" onPointerDown={(e) => e.stopPropagation()}>
              <p className="text-[12.5px] text-on-surface-variant">
                Nueva categoría: <strong className="text-on-surface">{query.trim()}</strong>. ¿En cuál categoría principal va?
              </p>
              <select value={parentId} onChange={(e) => setParentId(e.target.value)} aria-label="Categoría principal" className="h-11 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none focus:border-primary-container">
                <option value="">Ninguna (será una categoría principal)</option>
                {(categories ?? []).map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
              <div className="grid grid-cols-2 gap-2">
                <button type="button" onClick={() => setCreating(false)} className="min-h-11 rounded border border-outline-variant text-[13px] font-semibold text-on-surface-variant">
                  Cancelar
                </button>
                <button type="button" onClick={() => create.mutate()} disabled={create.isPending} className="min-h-11 rounded bg-primary text-[13px] font-bold text-white disabled:opacity-50">
                  {create.isPending ? "Creando..." : "Crear y usar"}
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
