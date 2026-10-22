import { useMemo, useState } from "react";
import { Check, Search, Store as StoreIcon, UtensilsCrossed, LayoutGrid } from "lucide-react";
import clsx from "clsx";
import { matchesQuery } from "../ui/SearchBox.jsx";
import { CategoryIcon } from "../ui/CategoryIcon.jsx";
import { checkoutChoices, currencyLabel } from "../../lib/catalog.js";
import { Section, Chip, Switch, PriceRange, RatingSection, withSelected, sortMethods, methodLabel } from "./ShopFilters.jsx";

// Filtros de la página de tiendas. Todos salen de datos reales de cada tienda: si es restaurante con menú QR o tienda, su tipo de
// negocio, si está verificada, cómo coordina el pago, qué métodos acepta, el rango de precios de sus productos y su valoración.
// El lugar (país, provincia, municipio) NO está aquí: es un filtro general del sitio (ver ZonePicker). El estado vive en la URL
// (lo maneja Stores.jsx). Ninguna opción es fija: salen de /search/facets?scope=stores, con lo que de verdad tienen las tiendas
// registradas en el lugar elegido; una sección sin opciones no se muestra.

const KINDS = [
  { value: "", label: "Todas", icon: LayoutGrid },
  { value: "false", label: "Tiendas", icon: StoreIcon },
  { value: "true", label: "Restaurantes", icon: UtensilsCrossed },
];

// `kinds`: solo los tipos que existen entre las tiendas registradas ("Todas" siempre va primero).
function KindSwitch({ value, onChange, kinds }) {
  return (
    <div role="radiogroup" aria-label="Tipo de establecimiento" className={clsx("grid gap-1 rounded-xl bg-surface-container p-1", kinds.length === 3 ? "grid-cols-3" : "grid-cols-2")}>
      {kinds.map((k) => {
        const Icon = k.icon;
        const active = value === k.value;
        return (
          <button
            key={k.label}
            type="button"
            role="radio"
            aria-checked={active}
            onClick={() => onChange(k.value)}
            className={clsx(
              "flex min-h-11 flex-col items-center justify-center gap-0.5 rounded-lg text-[12px] font-bold transition-colors",
              active ? "bg-surface-container-lowest text-primary-container shadow-sm" : "text-on-surface-variant hover:text-on-surface"
            )}
          >
            <Icon className="h-4 w-4" aria-hidden="true" />
            {k.label}
          </button>
        );
      })}
    </div>
  );
}

// Tipos de negocio: se pueden marcar varios. Con una lista larga, un buscador la acorta.
function BusinessTypes({ categories, selected, onToggle }) {
  const [query, setQuery] = useState("");
  const rows = useMemo(() => categories.filter((c) => !query.trim() || matchesQuery(c.name, query)), [categories, query]);
  return (
    <div>
      {categories.length > 8 && (
        <div className="relative mb-2">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-outline" aria-hidden="true" />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Buscar tipo de negocio"
            aria-label="Buscar tipo de negocio"
            className="h-11 w-full rounded-lg border border-outline-variant bg-surface-container-lowest pl-9 pr-3 text-[13.5px] outline-none focus:border-primary-container"
          />
        </div>
      )}
      <div className="max-h-[280px] overflow-y-auto pr-1">
        {rows.map((c) => {
          const on = selected.includes(c.id);
          return (
            <button
              key={c.id}
              type="button"
              role="checkbox"
              aria-checked={on}
              onClick={() => onToggle(c.id)}
              className={clsx("flex min-h-11 w-full items-center gap-2.5 rounded-lg px-2 text-left text-[13.5px]", on ? "bg-primary-container/10 font-bold text-primary-container" : "text-on-surface hover:bg-surface-container")}
            >
              <span className={clsx("flex h-5 w-5 flex-shrink-0 items-center justify-center rounded border", on ? "border-primary-container bg-primary-container text-white" : "border-outline-variant")}>
                {on && <Check className="h-3.5 w-3.5" aria-hidden="true" />}
              </span>
              <CategoryIcon name={c.icon} className="h-4 w-4 flex-shrink-0 text-tertiary-accent" />
              <span className="min-w-0 truncate">{c.name}</span>
            </button>
          );
        })}
        {!rows.length && <p className="px-2 py-3 text-[13px] text-outline">Ningún tipo coincide con “{query.trim()}”.</p>}
      </div>
    </div>
  );
}

export function StoreFilters({ filters, setFilter, setMany, toggleInList, businessCategories, facets }) {
  // Mientras cargan las opciones reales no se muestra ninguna: mejor un momento sin filtros que filtros que no existen.
  if (!facets) return null;
  const currencies = withSelected(facets.currencies, [filters.currency]);
  const payments = checkoutChoices({ activeOnly: false }).filter((o) => withSelected(facets.payment, filters.payment).includes(o.id));
  const accepts = withSelected(facets.accepts, filters.accepts);
  const ratings = withSelected(facets.ratings, filters.minRating ? [Number(filters.minRating)] : []);
  // Tipos de establecimiento: solo los que hay registrados (o el que ya viene elegido en el enlace).
  const kinds = KINDS.filter((k) => !k.value || k.value === filters.kind || (k.value === "true" ? facets.hasRestaurants : facets.hasShops));
  const showKind = kinds.length > 1;
  const showVerified = facets.hasVerified || !!filters.verified;
  return (
    <div>
      {showKind && (
        <Section title="Tipo de establecimiento" count={filters.kind ? 1 : 0}>
          <KindSwitch value={filters.kind} onChange={(v) => setFilter("isRestaurant", v)} kinds={kinds} />
          {kinds.some((k) => k.value === "true") && <p className="mt-1.5 text-[11.5px] text-outline">Los restaurantes tienen menú digital con QR para pedir desde la mesa.</p>}
        </Section>
      )}

      {businessCategories.length > 0 && (
        <Section title="Tipo de negocio" count={filters.businessCategoryIds.length}>
          <BusinessTypes categories={businessCategories} selected={filters.businessCategoryIds} onToggle={(id) => toggleInList("businessCategoryId", id)} />
        </Section>
      )}

      {showVerified && (
        <Section title="Verificación" count={filters.verified ? 1 : 0}>
          <Switch checked={filters.verified === "true"} onChange={(v) => setFilter("isVerified", v ? "true" : "")} label="Solo tiendas verificadas" hint="Con su identidad comprobada" />
        </Section>
      )}

      <Section title="Precio de sus productos" count={(filters.minPrice || filters.maxPrice ? 1 : 0) + (filters.currency ? 1 : 0)}>
        {currencies.length > 0 && (
          <div className="mb-2.5 flex flex-wrap gap-2">
            <Chip active={!filters.currency} onClick={() => setFilter("currency", "")}>Todas</Chip>
            {currencies.map((c) => (
              <Chip key={c} active={filters.currency === c} onClick={() => setFilter("currency", c)}>{currencyLabel(c)}</Chip>
            ))}
          </div>
        )}
        <PriceRange minPrice={filters.minPrice} maxPrice={filters.maxPrice} currency={filters.currency} onApply={setMany} />
        <p className="mt-1.5 text-[11.5px] text-outline">Muestra tiendas que tengan al menos un producto en ese rango.</p>
      </Section>

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
        <Section title="Métodos que acepta" count={filters.accepts.length} defaultOpen={false}>
          <div className="flex flex-wrap gap-2">
            {sortMethods(accepts).map((id) => (
              <Chip key={id} active={filters.accepts.includes(id)} onClick={() => toggleInList("accepts", id)}>{methodLabel(id)}</Chip>
            ))}
          </div>
        </Section>
      )}

      {ratings.length > 0 && <RatingSection ratings={ratings} value={filters.minRating} onChange={(v) => setFilter("minRating", v)} />}
    </div>
  );
}
