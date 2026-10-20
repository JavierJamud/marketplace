import { useEffect, useMemo, useState } from "react";
import { ChevronDown, ChevronRight, Search, Star, X } from "lucide-react";
import clsx from "clsx";
import { matchesQuery } from "../ui/SearchBox.jsx";
import { PAYMENT_METHODS } from "../../lib/paymentMethods.js";
import { CHECKOUT_PAY_CHOICES } from "../../lib/checkoutPayment.js";

// Panel de filtros del catálogo. Todo lo que filtra es un dato real del producto o de su tienda: categoría, precio (por moneda),
// tienda verificada, forma de coordinar el pago y métodos que acepta la tienda, descuento, precio por mayor, etiqueta, valoración y
// provincia. El estado vive en la URL (lo maneja Shop.jsx), así se puede compartir el enlace con los filtros puestos.
// Ninguna opción es fija: salen de /search/facets, que mira lo que de verdad tienen las tiendas del lugar elegido. Una sección
// sin opciones no se muestra.

// Lo disponible más lo que ya está elegido en el enlace (aunque haya dejado de existir), para que siempre se pueda quitar.
export const withSelected = (available = [], selected = []) => [...available, ...selected.filter((v) => v && !available.includes(v))];

export function Section({ title, count, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <section className="border-b border-surface-container-high py-3.5 last:border-b-0">
      <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} className="flex min-h-11 w-full items-center justify-between gap-2 text-left">
        <span className="flex items-center gap-2 text-[14px] font-bold text-on-surface">
          {title}
          {count > 0 && <span className="rounded-full bg-tertiary-accent px-1.5 py-0.5 text-[10.5px] font-bold leading-none text-white">{count}</span>}
        </span>
        <ChevronDown className={clsx("h-4 w-4 text-outline transition-transform", open && "rotate-180")} aria-hidden="true" />
      </button>
      {open && <div className="pt-1">{children}</div>}
    </section>
  );
}

export function Chip({ active, onClick, children }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={clsx(
        "min-h-10 rounded-full border px-3.5 text-[13px] font-semibold transition-colors",
        active ? "border-primary-container bg-primary-container text-white" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant hover:border-tertiary-accent"
      )}
    >
      {children}
    </button>
  );
}

export function Switch({ checked, onChange, label, hint }) {
  return (
    <button type="button" role="switch" aria-checked={checked} onClick={() => onChange(!checked)} className="flex min-h-11 w-full items-center justify-between gap-3 text-left">
      <span>
        <span className="block text-[13.5px] font-semibold text-on-surface">{label}</span>
        {hint && <span className="block text-[11.5px] text-outline">{hint}</span>}
      </span>
      <span className={clsx("relative h-6 w-10 flex-shrink-0 rounded-full transition-colors", checked ? "bg-tertiary-accent" : "bg-outline-variant")}>
        <span className={clsx("absolute top-0.5 h-5 w-5 rounded-full bg-white shadow transition-all", checked ? "left-[18px]" : "left-0.5")} />
      </span>
    </button>
  );
}

function CategoryTree({ categories, value, onChange }) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(() => new Set());
  const searching = query.trim().length > 0;

  // La categoría elegida (o su principal) arranca desplegada para ver dónde está.
  useEffect(() => {
    if (!value) return;
    const parent = categories.find((c) => c.id === value || c.children?.some((ch) => ch.id === value));
    if (parent) setOpen((prev) => new Set(prev).add(parent.id));
  }, [value, categories]);

  const rows = useMemo(
    () =>
      categories
        .map((c) => {
          const parentHit = matchesQuery(c.name, query);
          const children = (c.children ?? []).filter((ch) => !searching || parentHit || matchesQuery(ch.name, query));
          return { ...c, shown: children, visible: !searching || parentHit || children.length > 0 };
        })
        .filter((c) => c.visible),
    [categories, query, searching]
  );

  const toggle = (id) =>
    setOpen((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });

  return (
    <div>
      <div className="relative mb-2">
        <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" aria-hidden="true" />
        <input
          type="search"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Buscar categoría"
          aria-label="Buscar categoría"
          className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13.5px] outline-none focus:border-primary-container"
        />
      </div>
      <div className="max-h-[300px] overflow-y-auto pr-1">
        <button type="button" onClick={() => onChange("")} className={clsx("flex min-h-10 w-full items-center rounded-lg px-2.5 text-left text-[13.5px]", !value ? "bg-primary-container/10 font-bold text-primary-container" : "text-on-surface-variant hover:bg-surface-container")}>
          Todas las categorías
        </button>
        {rows.map((c) => {
          const expanded = searching || open.has(c.id);
          const hasKids = (c.children?.length ?? 0) > 0;
          return (
            <div key={c.id}>
              <div className="flex items-center">
                <button type="button" onClick={() => onChange(c.id)} className={clsx("flex min-h-10 flex-1 items-center rounded-lg px-2.5 text-left text-[13.5px]", value === c.id ? "bg-primary-container/10 font-bold text-primary-container" : "font-semibold text-on-surface hover:bg-surface-container")}>
                  {c.name}
                </button>
                {hasKids && (
                  <button type="button" onClick={() => toggle(c.id)} aria-expanded={expanded} aria-label={`${expanded ? "Contraer" : "Ver subcategorías de"} ${c.name}`} className="flex h-10 w-10 items-center justify-center text-outline">
                    <ChevronRight className={clsx("h-4 w-4 transition-transform", expanded && "rotate-90")} />
                  </button>
                )}
              </div>
              {expanded && c.shown.map((ch) => (
                <button key={ch.id} type="button" onClick={() => onChange(ch.id)} className={clsx("ml-3 flex min-h-10 w-[calc(100%-12px)] items-center rounded-lg border-l border-surface-container-high px-3 text-left text-[13px]", value === ch.id ? "bg-primary-container/10 font-bold text-primary-container" : "text-on-surface-variant hover:bg-surface-container")}>
                  {ch.name}
                </button>
              ))}
            </div>
          );
        })}
        {!rows.length && <p className="px-2.5 py-3 text-[13px] text-outline">No hay categorías con “{query.trim()}”.</p>}
      </div>
    </div>
  );
}

export function PriceRange({ minPrice, maxPrice, currency, onApply }) {
  const [min, setMin] = useState(minPrice);
  const [max, setMax] = useState(maxPrice);
  useEffect(() => setMin(minPrice), [minPrice]);
  useEffect(() => setMax(maxPrice), [maxPrice]);
  const apply = () => onApply({ minPrice: min, maxPrice: max });
  const input = "h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest px-3 text-[13.5px] outline-none focus:border-primary-container";
  return (
    <div className="flex items-center gap-2">
      <input type="text" inputMode="numeric" aria-label="Precio mínimo" placeholder="Mín." value={min} onChange={(e) => setMin(e.target.value.replace(/\D/g, "").slice(0, 8))} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={input} />
      <span className="text-outline">a</span>
      <input type="text" inputMode="numeric" aria-label="Precio máximo" placeholder="Máx." value={max} onChange={(e) => setMax(e.target.value.replace(/\D/g, "").slice(0, 8))} onBlur={apply} onKeyDown={(e) => e.key === "Enter" && e.currentTarget.blur()} className={input} />
      <span className="flex-shrink-0 text-[12px] font-semibold text-outline">{currency || "todas"}</span>
    </div>
  );
}

export function ShopFilters({ filters, setFilter, setMany, toggleInList, categories, facets }) {
  // Mientras cargan las opciones reales no se muestra ninguna: mejor un momento sin filtros que filtros que no existen.
  if (!facets) return null;
  const currencies = withSelected(facets.currencies, [filters.currency]);
  const payments = CHECKOUT_PAY_CHOICES.filter((o) => withSelected(facets.payment, filters.payment).includes(o.id));
  const accepts = withSelected(facets.accepts, filters.accepts);
  const badges = withSelected(facets.badges, [filters.badge]);
  const ratings = withSelected(facets.ratings, filters.minRating ? [Number(filters.minRating)] : []);
  const showVerified = facets.hasVerified || filters.onlyVerified;
  const showDiscount = facets.hasDiscount || filters.discount;
  const showWholesale = facets.hasWholesale || filters.wholesale;
  return (
    <div>
      {categories.length > 0 && (
        <Section title="Categoría" count={filters.categoryId ? 1 : 0}>
          <CategoryTree categories={categories} value={filters.categoryId} onChange={(id) => setFilter("categoryId", id)} />
        </Section>
      )}

      <Section title="Precio" count={(filters.minPrice || filters.maxPrice ? 1 : 0) + (filters.currency ? 1 : 0)}>
        {currencies.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-2">
            <Chip active={!filters.currency} onClick={() => setFilter("currency", "")}>Todas</Chip>
            {currencies.map((c) => (
              <Chip key={c} active={filters.currency === c} onClick={() => setFilter("currency", c)}>{c}</Chip>
            ))}
          </div>
        )}
        <PriceRange minPrice={filters.minPrice} maxPrice={filters.maxPrice} currency={filters.currency} onApply={setMany} />
        {!filters.currency && (filters.minPrice || filters.maxPrice) && <p className="mt-1.5 text-[11.5px] text-outline">Elige una moneda para comparar precios con exactitud.</p>}
      </Section>

      {showVerified && (
        <Section title="Tienda" count={filters.onlyVerified ? 1 : 0}>
          <Switch checked={filters.onlyVerified} onChange={(v) => setFilter("onlyVerified", v ? "true" : "")} label="Solo tiendas verificadas" hint="Con su identidad comprobada" />
        </Section>
      )}

      {payments.length > 0 && (
        <Section title="Cómo se coordina el pago" count={filters.payment.length}>
          <div className="flex flex-wrap gap-2">
            {payments.map((o) => (
              <Chip key={o.id} active={filters.payment.includes(o.id)} onClick={() => toggleInList("payment", o.id)}>{o.title}</Chip>
            ))}
          </div>
        </Section>
      )}

      {accepts.length > 0 && (
        <Section title="Métodos que acepta la tienda" count={filters.accepts.length} defaultOpen={false}>
          <div className="flex flex-wrap gap-2">
            {sortMethods(accepts).map((id) => (
              <Chip key={id} active={filters.accepts.includes(id)} onClick={() => toggleInList("accepts", id)}>{methodLabel(id)}</Chip>
            ))}
          </div>
        </Section>
      )}

      {(showDiscount || showWholesale || badges.length > 0) && (
        <Section title="Ofertas y etiquetas" count={(filters.discount ? 1 : 0) + (filters.wholesale ? 1 : 0) + (filters.badge ? 1 : 0)}>
          {showDiscount && <Switch checked={filters.discount} onChange={(v) => setFilter("discount", v ? "true" : "")} label="Con descuento" hint="Tienen un precio anterior más alto" />}
          {showWholesale && <Switch checked={filters.wholesale} onChange={(v) => setFilter("wholesale", v ? "true" : "")} label="Precio por cantidad" hint="Bajan de precio al comprar más unidades" />}
          {badges.length > 0 && (
            <div className="mt-2 flex flex-wrap gap-2">
              {badges.map((b) => (
                <Chip key={b} active={filters.badge === b} onClick={() => setFilter("badge", filters.badge === b ? "" : b)}>{b}</Chip>
              ))}
            </div>
          )}
        </Section>
      )}

      {ratings.length > 0 && <RatingSection ratings={ratings} value={filters.minRating} onChange={(v) => setFilter("minRating", v)} />}
    </div>
  );
}

// Métodos de pago: primero en el orden conocido de PAYMENT_METHODS, después los que una tienda haya escrito a mano.
const METHOD_ORDER = PAYMENT_METHODS.map((m) => m.id);
export const sortMethods = (ids) => [...ids].sort((a, b) => (METHOD_ORDER.indexOf(a) + 1 || 999) - (METHOD_ORDER.indexOf(b) + 1 || 999) || a.localeCompare(b));
export const methodLabel = (id) => PAYMENT_METHODS.find((m) => m.id === id)?.label ?? id;

export function RatingSection({ ratings, value, onChange }) {
  return (
    <Section title="Valoración" count={value ? 1 : 0} defaultOpen={false}>
      <div className="flex flex-wrap gap-2">
        {ratings.map((r) => (
          <Chip key={r} active={Number(value) === r} onClick={() => onChange(Number(value) === r ? "" : String(r))}>
            <span className="inline-flex items-center gap-1">{r} <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> o más</span>
          </Chip>
        ))}
      </div>
    </Section>
  );
}

// Fila de filtros activos con una "x" para quitar cada uno.
export function ActiveFilterChips({ items, onClear }) {
  if (!items.length) return null;
  return (
    <div className="flex flex-wrap items-center gap-2">
      {items.map((it) => (
        <button key={it.key} type="button" onClick={it.remove} className="inline-flex min-h-9 items-center gap-1.5 rounded-full bg-tertiary-accent/10 px-3 text-[12.5px] font-semibold text-tertiary-accent">
          {it.label} <X className="h-3.5 w-3.5" aria-hidden="true" />
        </button>
      ))}
      <button type="button" onClick={onClear} className="min-h-9 px-2 text-[12.5px] font-semibold text-outline underline">Limpiar todo</button>
    </div>
  );
}
