import { useMemo, useState } from "react";
import { Check, Search, Star, Store as StoreIcon, UtensilsCrossed, LayoutGrid } from "lucide-react";
import clsx from "clsx";
import { matchesQuery } from "../ui/SearchBox.jsx";
import { CategoryIcon } from "../ui/CategoryIcon.jsx";
import { PAYMENT_METHODS } from "../../lib/paymentMethods.js";
import { CHECKOUT_PAY_CHOICES } from "../../lib/checkoutPayment.js";
import { Section, Chip, Switch, PriceRange } from "./ShopFilters.jsx";

// Filtros de la página de tiendas. Todos salen de datos reales de cada tienda: si es restaurante con menú QR o tienda, su tipo de
// negocio, si está verificada, cómo coordina el pago, qué métodos acepta, el rango de precios de sus productos y su valoración.
// El lugar (país, provincia, municipio) NO está aquí: es un filtro general del sitio (ver ZonePicker). El estado vive en la URL
// (lo maneja Stores.jsx).

const CURRENCIES = ["CUP", "USD", "EUR", "MXN"];
const RATINGS = [4, 3];

const KINDS = [
  { value: "", label: "Todas", icon: LayoutGrid },
  { value: "false", label: "Tiendas", icon: StoreIcon },
  { value: "true", label: "Restaurantes", icon: UtensilsCrossed },
];

function KindSwitch({ value, onChange }) {
  return (
    <div role="radiogroup" aria-label="Tipo de establecimiento" className="grid grid-cols-3 gap-1 rounded-xl bg-surface-container p-1">
      {KINDS.map((k) => {
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

export function StoreFilters({ filters, setFilter, setMany, toggleInList, businessCategories }) {
  return (
    <div>
      <Section title="Tipo de establecimiento" count={filters.kind ? 1 : 0}>
        <KindSwitch value={filters.kind} onChange={(v) => setFilter("isRestaurant", v)} />
        <p className="mt-1.5 text-[11.5px] text-outline">Los restaurantes tienen menú digital con QR para pedir desde la mesa.</p>
      </Section>

      {businessCategories.length > 0 && (
        <Section title="Tipo de negocio" count={filters.businessCategoryIds.length}>
          <BusinessTypes categories={businessCategories} selected={filters.businessCategoryIds} onToggle={(id) => toggleInList("businessCategoryId", id)} />
        </Section>
      )}

      <Section title="Verificación" count={filters.verified ? 1 : 0}>
        <Switch checked={filters.verified === "true"} onChange={(v) => setFilter("isVerified", v ? "true" : "")} label="Solo tiendas verificadas" hint="Con su identidad comprobada" />
      </Section>

      <Section title="Precio de sus productos" count={(filters.minPrice || filters.maxPrice ? 1 : 0) + (filters.currency ? 1 : 0)}>
        <div className="mb-2.5 flex flex-wrap gap-2">
          <Chip active={!filters.currency} onClick={() => setFilter("currency", "")}>Todas</Chip>
          {CURRENCIES.map((c) => (
            <Chip key={c} active={filters.currency === c} onClick={() => setFilter("currency", c)}>{c}</Chip>
          ))}
        </div>
        <PriceRange minPrice={filters.minPrice} maxPrice={filters.maxPrice} currency={filters.currency} onApply={setMany} />
        <p className="mt-1.5 text-[11.5px] text-outline">Muestra tiendas que tengan al menos un producto en ese rango.</p>
      </Section>

      <Section title="Cómo se coordina el pago" count={filters.payment.length}>
        <div className="flex flex-wrap gap-2">
          {CHECKOUT_PAY_CHOICES.map((o) => (
            <Chip key={o.id} active={filters.payment.includes(o.id)} onClick={() => toggleInList("payment", o.id)}>{o.title}</Chip>
          ))}
        </div>
      </Section>

      <Section title="Métodos que acepta" count={filters.accepts.length} defaultOpen={false}>
        <div className="flex flex-wrap gap-2">
          {PAYMENT_METHODS.map((m) => (
            <Chip key={m.id} active={filters.accepts.includes(m.id)} onClick={() => toggleInList("accepts", m.id)}>{m.label}</Chip>
          ))}
        </div>
      </Section>

      <Section title="Valoración" count={filters.minRating ? 1 : 0} defaultOpen={false}>
        <div className="flex flex-wrap gap-2">
          {RATINGS.map((r) => (
            <Chip key={r} active={Number(filters.minRating) === r} onClick={() => setFilter("minRating", Number(filters.minRating) === r ? "" : String(r))}>
              <span className="inline-flex items-center gap-1">{r} <Star className="h-3.5 w-3.5 fill-current" aria-hidden="true" /> o más</span>
            </Chip>
          ))}
        </div>
      </Section>
    </div>
  );
}
