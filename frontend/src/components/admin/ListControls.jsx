import { useCallback, useRef, useState } from "react";
import { AnchoredPopover } from "../ui/AnchoredPopover.jsx";
import { ChevronLeft, ChevronRight, ChevronUp, ChevronDown, Search, X, MoreVertical } from "lucide-react";
import { CARD } from "../dashboard/DashboardCard.jsx";

// Bloque 241 (pedido explícito): piezas compartidas de las listas del admin
// (productos, tiendas, clientes). Ninguna lista del admin tenía paginación,
// orden ni filtros reutilizables — cada pantalla armaba su propia grilla a
// mano. Todo acá mide 44px de alto como mínimo en celular (R-03) y se baja a
// 36px solo desde md, donde el puntero es un mouse.

// Tarjeta-filtro de la tira de resumen: muestra un conteo real y, al tocarla,
// filtra la lista por ese estado. En celular la tira se desliza de lado (7
// tarjetas apiladas empujarían la lista más de una pantalla hacia abajo).
export function StatTile({ label, value, hint, active, onClick, tone = "neutral" }) {
  // El color de alerta solo se enciende si hay algo que atender: un "0" en
  // rojo o ámbar diría que hay un problema donde no lo hay.
  const toneText = !value ? "text-on-surface" : tone === "warn" ? "text-secondary" : tone === "danger" ? "text-error" : "text-on-surface";
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`${CARD} min-h-[64px] min-w-[116px] flex-shrink-0 px-3.5 py-2.5 text-left transition-colors sm:min-w-0 ${
        active ? "!border-tertiary-accent ring-2 ring-tertiary-accent/25" : "hover:bg-surface-container/50"
      }`}
    >
      <div className="text-[11px] leading-tight text-on-surface-variant">{label}</div>
      <div className={`mt-0.5 font-display text-[19px] font-extrabold leading-tight tracking-tight ${toneText}`}>
        {value == null ? "—" : Number(value).toLocaleString("es-CU")}
      </div>
      {hint && <div className="truncate text-[10.5px] text-outline">{hint}</div>}
    </button>
  );
}

export function StatStrip({ children }) {
  return (
    <div className="-mx-4 mb-4 flex gap-2.5 overflow-x-auto px-4 pb-1 [scrollbar-width:none] sm:mx-0 sm:grid sm:grid-cols-4 sm:overflow-visible sm:px-0 lg:grid-cols-7 [&::-webkit-scrollbar]:hidden">
      {children}
    </div>
  );
}

// Cabecera de columna ordenable (solo se ve desde md; en celular el orden se
// elige desde el selector de la barra de herramientas).
export function SortHeader({ label, sortKey, sort, dir, onSort, align = "left" }) {
  const active = sort === sortKey;
  return (
    <button
      type="button"
      onClick={() => onSort(sortKey, active ? (dir === "desc" ? "asc" : "desc") : "desc")}
      aria-sort={active ? (dir === "desc" ? "descending" : "ascending") : "none"}
      className={`flex items-center gap-0.5 text-[11px] font-bold uppercase tracking-wide ${
        align === "right" ? "justify-end" : ""
      } ${active ? "text-on-surface" : "text-outline hover:text-on-surface-variant"}`}
    >
      {label}
      {active && (dir === "desc" ? <ChevronDown className="h-3 w-3" /> : <ChevronUp className="h-3 w-3" />)}
    </button>
  );
}

// Menú de acciones por fila ("⋮"): con 5 botones de texto por fila una tabla
// de clientes o tiendas se ensancha y se parte en celular. Se cierra al tocar
// afuera o con Escape (R-32). `items`: { label, onClick, danger?, hidden? }.
export function ActionMenu({ items, label = "Acciones de la fila" }) {
  const [open, setOpen] = useState(false);
  const buttonRef = useRef(null);
  const close = useCallback(() => setOpen(false), []);

  return (
    <div className="relative">
      <button
        ref={buttonRef}
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={label}
        aria-haspopup="menu"
        aria-expanded={open}
        className="flex h-11 w-11 items-center justify-center rounded-xl text-on-surface-variant hover:bg-surface-container md:h-9 md:w-9"
      >
        <MoreVertical className="h-4 w-4" />
      </button>
      {/* Bloque 271: el menú se dibuja fuera de la tabla (portal) y se coloca solo hacia
          abajo, arriba o al costado según el espacio, siempre por encima del asistente. */}
      <AnchoredPopover anchorRef={buttonRef} open={open} onClose={close} className="rounded-xl border border-surface-container-high bg-surface-container-lowest py-1 shadow-lg">
        {items
          .filter((item) => !item.hidden)
          .map((item) => (
            <button
              key={item.label}
              type="button"
              role="menuitem"
              onClick={() => {
                setOpen(false);
                item.onClick();
              }}
              className={`flex h-11 w-full items-center whitespace-nowrap px-3.5 text-left text-[13px] font-semibold hover:bg-surface-container md:h-9 ${
                item.danger ? "text-error" : "text-on-surface"
              }`}
            >
              {item.label}
            </button>
          ))}
      </AnchoredPopover>
    </div>
  );
}

export function SearchField({ value, onChange, placeholder, className = "" }) {
  return (
    <div className={`relative ${className}`}>
      <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" />
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        aria-label={placeholder}
        className="h-11 w-full rounded-xl border border-outline-variant bg-surface-container-lowest pl-9 pr-9 text-[13px] outline-none focus:border-tertiary-accent md:h-10"
      />
      {value && (
        <button
          type="button"
          onClick={() => onChange("")}
          aria-label="Borrar búsqueda"
          className="absolute right-1 top-1/2 flex h-9 w-9 -translate-y-1/2 items-center justify-center text-outline hover:text-on-surface"
        >
          <X className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

// Filas de relleno mientras carga la primera página (R-27, estado "cargando").
export function RowSkeletons({ rows = 8 }) {
  return (
    <div aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <div key={i} className="flex items-center gap-3 border-b border-surface-container px-4 py-3 last:border-b-0">
          <div className="h-11 w-11 flex-shrink-0 rounded-md bg-surface-container" />
          <div className="flex-1 space-y-2">
            <div className="h-3 w-2/5 rounded bg-surface-container" />
            <div className="h-2.5 w-3/5 rounded bg-surface-container/70" />
          </div>
        </div>
      ))}
    </div>
  );
}

// Números de página con ventana: primera, última y 1 vecino de la actual, con
// "…" en los huecos. Con 340 productos son 14 páginas; con miles de clientes
// serían cientos, por eso no se listan todas.
function pageWindow(page, pageCount) {
  const wanted = new Set([1, pageCount, page - 1, page, page + 1]);
  const pages = [...wanted].filter((p) => p >= 1 && p <= pageCount).sort((a, b) => a - b);
  const out = [];
  pages.forEach((p, i) => {
    if (i > 0 && p - pages[i - 1] > 1) out.push("gap-" + p);
    out.push(p);
  });
  return out;
}

export function Pagination({ page, pageCount, total, pageSize, onPage, onPageSize, noun = "resultados" }) {
  if (total === 0) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);
  const navBtn =
    "flex h-11 min-w-11 items-center justify-center rounded-xl border border-surface-container-high px-2 text-[13px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:cursor-not-allowed disabled:opacity-40 md:h-9 md:min-w-9";
  return (
    <nav aria-label="Paginación" className="mt-4 flex flex-wrap items-center justify-between gap-3">
      <p className="text-[12.5px] text-on-surface-variant">
        {from.toLocaleString("es-CU")} a {to.toLocaleString("es-CU")} de {total.toLocaleString("es-CU")} {noun}
      </p>
      <div className="flex flex-wrap items-center gap-2">
        {onPageSize && (
          <label className="flex items-center gap-2 text-[12px] text-on-surface-variant">
            Por página
            <select
              value={pageSize}
              onChange={(e) => onPageSize(Number(e.target.value))}
              className="h-11 rounded-xl border border-outline-variant bg-surface-container-lowest px-2 text-[13px] md:h-9"
            >
              {[25, 50, 100].map((n) => (
                <option key={n} value={n}>
                  {n}
                </option>
              ))}
            </select>
          </label>
        )}
        <button type="button" className={navBtn} disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Página anterior">
          <ChevronLeft className="h-4 w-4" />
        </button>
        <div className="hidden items-center gap-1 sm:flex">
          {pageWindow(page, pageCount).map((p) =>
            typeof p === "string" ? (
              <span key={p} className="px-1 text-outline" aria-hidden="true">
                ...
              </span>
            ) : (
              <button
                key={p}
                type="button"
                onClick={() => onPage(p)}
                aria-current={p === page ? "page" : undefined}
                className={`${navBtn} ${p === page ? "!border-primary bg-primary !text-on-primary hover:!bg-primary" : ""}`}
              >
                {p}
              </button>
            )
          )}
        </div>
        <span className="text-[12.5px] font-semibold text-on-surface-variant sm:hidden">
          {page} de {pageCount}
        </span>
        <button type="button" className={navBtn} disabled={page >= pageCount} onClick={() => onPage(page + 1)} aria-label="Página siguiente">
          <ChevronRight className="h-4 w-4" />
        </button>
      </div>
    </nav>
  );
}
