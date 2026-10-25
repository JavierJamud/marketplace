import { useEffect, useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useZone } from "../../context/LocationContext.jsx";
import { ZoneChip } from "../../components/ZonePicker.jsx";
import { ProductCard, ProductGridSkeleton } from "../../components/ProductCard.jsx";
import { MarketplaceChatGate } from "../../components/MarketplaceChatGate.jsx";
import { ShopFilters, ActiveFilterChips } from "../../components/shop/ShopFilters.jsx";
import { checkoutLabel, resolvePaymentMethod } from "../../lib/catalog.js";
import { MapPin, SlidersHorizontal, X } from "lucide-react";
import { useMediaQuery } from "../../lib/useMediaQuery.js";
import { lockPageScroll } from "../../lib/scrollLock.js";
import { Breadcrumbs } from "../../components/Breadcrumbs.jsx";
import toast from "../../lib/toast.jsx";
import { VISIT_SEED } from "../../lib/visitSeed.js";

const SORT_OPTIONS = [
  { value: "relevance", label: "Más relevantes" },
  { value: "price-asc", label: "Precio: menor a mayor" },
  { value: "price-desc", label: "Precio: mayor a menor" },
  { value: "rating", label: "Mejor calificados" },
  { value: "sales", label: "Más vendidos" },
  { value: "newest", label: "Más nuevos" },
];

const list = (v) => (v ? v.split(",").filter(Boolean) : []);

export default function Shop() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { zoneParams, zoneKey, zoneName, hasZoneFilter, countryId: zoneCountryId, waiting: zoneLoading, setProvince, setMunicipality, applyZone, clearFilter: clearZone } = useZone();

  const q = searchParams.get("q") ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";

  // Los filtros viven en la URL: se pueden compartir y los enlaces del chat principal ya llegan con ellos puestos.
  const filters = {
    categoryId,
    minPrice: searchParams.get("minPrice") ?? "",
    maxPrice: searchParams.get("maxPrice") ?? "",
    currency: searchParams.get("currency") ?? "",
    payment: list(searchParams.get("payment")).map((m) => (m === "prepaid" ? "online" : m)).filter((m) => ["cod", "online", "cash"].includes(m)),
    accepts: list(searchParams.get("accepts")),
    onlyVerified: searchParams.get("onlyVerified") === "true",
    discount: searchParams.get("discount") === "true",
    wholesale: searchParams.get("wholesale") === "true",
    badge: searchParams.get("badge") ?? "",
    minRating: searchParams.get("minRating") ?? "",
  };
  const setFilter = (key, value) =>
    setSearchParams((p) => {
      if (value) p.set(key, value);
      else p.delete(key);
      return p;
    }, { replace: true });
  const setMany = (obj) =>
    setSearchParams((p) => {
      for (const [k, v] of Object.entries(obj)) {
        if (v) p.set(k, v);
        else p.delete(k);
      }
      return p;
    }, { replace: true });
  const toggleInList = (key, id) =>
    setSearchParams((p) => {
      const cur = list(p.get(key));
      const next = cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id];
      if (next.length) p.set(key, next.join(","));
      else p.delete(key);
      return p;
    }, { replace: true });

  const [sort, setSort] = useState("relevance");
  const [sheetOpen, setSheetOpen] = useState(false);
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const urlKey = `${searchParams.get("provinceId")}|${searchParams.get("municipalityId")}`;
  useEffect(() => {
    const urlProvince = searchParams.get("provinceId");
    if (urlProvince) {
      setProvince(urlProvince);
      const urlMunicipality = searchParams.get("municipalityId");
      if (urlMunicipality) setMunicipality(urlMunicipality);
    }
  }, [urlKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // El fondo no se desplaza mientras está abierta la hoja de filtros del celular.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    return lockPageScroll();
  }, [sheetOpen]);

  const { data: categories } = useQuery({
    queryKey: ["categories", zoneKey],
    queryFn: async () => (await api.get("/categories", { params: { ...zoneParams, inUse: true } })).data.categories,
    enabled: !zoneLoading,
  });
  // Opciones reales de cada filtro (monedas, pagos, etiquetas...) según lo que venden las tiendas del lugar elegido.
  const { data: facets } = useQuery({
    queryKey: ["filter-facets", "products", zoneKey],
    queryFn: async () => (await api.get("/search/facets", { params: zoneParams })).data,
    enabled: !zoneLoading,
  });

  const { data, isLoading } = useQuery({
    queryKey: ["shop-products", q, searchParams.toString(), zoneKey, sort, VISIT_SEED],
    placeholderData: (prev) => prev,
    enabled: !zoneLoading,
    queryFn: async () =>
      (
        await api.get("/search", {
          params: {
            q: q || undefined,
            categoryId: categoryId || undefined,
            ...zoneParams,
            minPrice: filters.minPrice || undefined,
            maxPrice: filters.maxPrice || undefined,
            currency: filters.currency || undefined,
            payment: filters.payment.join(",") || undefined,
            accepts: filters.accepts.join(",") || undefined,
            onlyVerified: filters.onlyVerified || undefined,
            discount: filters.discount || undefined,
            wholesale: filters.wholesale || undefined,
            badge: filters.badge || undefined,
            minRating: filters.minRating || undefined,
            sort,
            seed: VISIT_SEED,
          },
        })
      ).data,
  });

  const products = data?.products ?? [];
  const nearbyProvinces = data?.nearbyProvinces ?? [];
  // Lo buscado no está en el lugar elegido pero sí en otros (el servidor solo lo manda cuando no hay nada en la zona).
  const elsewhere = data?.elsewhere ?? null;

  // "Limpiar todo" quita todo lo que se ve como filtro, también la búsqueda y el lugar. Antes la búsqueda no salía como
  // filtro (tras buscar "Red" no había nada que limpiar) y el lugar seguía puesto aunque se mostraba entre los filtros.
  function clearFilters() {
    setSort("relevance");
    if (hasZoneFilter) clearZone();
    setSearchParams((p) => {
      ["categoryId", "q", "minPrice", "maxPrice", "currency", "payment", "accepts", "onlyVerified", "discount", "wholesale", "badge", "minRating"].forEach((k) => p.delete(k));
      return p;
    });
    // Aviso de que se limpió: sin él parecía que el botón no hacía nada (pedido del dueño).
    toast.success("Filtros limpiados.");
  }

  const categoryName = useMemo(() => {
    for (const c of categories ?? []) {
      if (c.id === categoryId) return c.name;
      const ch = c.children?.find((x) => x.id === categoryId);
      if (ch) return `${c.name} › ${ch.name}`;
    }
    return "Categoría";
  }, [categories, categoryId]);

  // Un chip por cada filtro puesto, con su "x".
  const activeChips = [
    q && { key: "q", label: `Búsqueda: “${q}”`, remove: () => setFilter("q", "") },
    categoryId && { key: "cat", label: categoryName, remove: () => setFilter("categoryId", "") },
    (filters.minPrice || filters.maxPrice) && {
      key: "price",
      label: `${filters.minPrice ? `Desde ${filters.minPrice}` : ""}${filters.minPrice && filters.maxPrice ? " " : ""}${filters.maxPrice ? `Hasta ${filters.maxPrice}` : ""} ${filters.currency}`.trim(),
      remove: () => setMany({ minPrice: "", maxPrice: "" }),
    },
    filters.currency && { key: "cur", label: `Moneda ${filters.currency}`, remove: () => setFilter("currency", "") },
    filters.onlyVerified && { key: "ver", label: "Tiendas verificadas", remove: () => setFilter("onlyVerified", "") },
    ...filters.payment.map((id) => ({ key: `pay-${id}`, label: checkoutLabel(id), remove: () => toggleInList("payment", id) })),
    ...filters.accepts.map((id) => ({ key: `acc-${id}`, label: `Acepta ${resolvePaymentMethod(id).label}`, remove: () => toggleInList("accepts", id) })),
    filters.discount && { key: "disc", label: "Con descuento", remove: () => setFilter("discount", "") },
    filters.wholesale && { key: "whole", label: "Precio por cantidad", remove: () => setFilter("wholesale", "") },
    filters.badge && { key: "badge", label: filters.badge, remove: () => setFilter("badge", "") },
    filters.minRating && { key: "rate", label: `${filters.minRating}★ o más`, remove: () => setFilter("minRating", "") },
    hasZoneFilter && { key: "zone", label: zoneName, remove: clearZone },
  ].filter(Boolean);

  return (
    <>
      <div>
        {/* PAGE HEADER */}
        <div className="border-b border-surface-container-high bg-surface-container-lowest">
          <div className="container-app py-7">
            <Breadcrumbs className="mb-2" items={[{ label: "Catálogo" }]} />
            <h1 className="font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">
              {hasZoneFilter ? `Catálogo en ${zoneName}` : "Catálogo completo"}
            </h1>
            <p className="mt-1.5 text-label-sm text-outline">
              {hasZoneFilter ? "Solo productos de tiendas de ese lugar" : "De todas las tiendas"} · las tiendas verificadas se muestran primero
            </p>
            <ZoneChip className="mt-3" />
          </div>
        </div>

        {/* MAIN */}
        <div className="container-app grid grid-cols-1 gap-8 py-6 lg:grid-cols-[290px_1fr] lg:items-start">
          {/* FILTROS (escritorio) */}
          {isDesktop && (
          <aside className="rounded-xl border border-surface-container-high bg-surface-container-lowest px-4 lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-110px)] lg:overflow-y-auto">
            <div className="flex items-center justify-between pt-3.5">
              <h2 className="text-[15px] font-extrabold text-on-surface">Filtros</h2>
              {activeChips.length > 0 && (
                <button type="button" onClick={clearFilters} className="min-h-9 text-[12.5px] font-semibold text-tertiary-accent hover:underline">Limpiar</button>
              )}
            </div>
            <ShopFilters filters={filters} setFilter={setFilter} setMany={setMany} toggleInList={toggleInList} categories={categories ?? []} facets={facets} />
          </aside>
          )}

          {/* GRID */}
          <div>
            <div className="mb-3 flex items-center justify-between gap-3">
              <button type="button" onClick={() => setSheetOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-[13.5px] font-bold text-on-surface lg:hidden">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filtros
                {activeChips.length > 0 && <span className="rounded-full bg-tertiary-accent px-1.5 py-0.5 text-[11px] leading-none text-white">{activeChips.length}</span>}
              </button>
              <span className="hidden text-[13.5px] text-outline sm:inline">
                {products.length} {products.length === 1 ? "producto" : "productos"} {hasZoneFilter ? `en ${zoneName}` : "en todo el país"}
              </span>
              <select
                value={sort}
                onChange={(e) => setSort(e.target.value)}
                aria-label="Ordenar por"
                className="min-h-11 min-w-0 flex-1 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 text-label-sm text-on-surface outline-none sm:max-w-[220px] sm:flex-none"
              >
                {SORT_OPTIONS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>
            <p className="mb-3 text-[13px] text-outline sm:hidden">
              {products.length} {products.length === 1 ? "producto" : "productos"} {hasZoneFilter ? `en ${zoneName}` : "en todo el país"}
            </p>
            {activeChips.length > 0 && (
              <div className="mb-4">
                <ActiveFilterChips items={activeChips} onClear={clearFilters} />
              </div>
            )}

            {isLoading && <ProductGridSkeleton count={15} className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5" />}

            {!isLoading && products.length > 0 && (
              <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
                {products.map((p) => (
                  <ProductCard key={p.id} product={p} trackSource={q ? "search" : "catalog"} />
                ))}
              </div>
            )}

            {!isLoading && products.length === 0 && elsewhere && (
              <ElsewhereResults query={q.trim()} zoneName={zoneName} zoneCountryId={zoneCountryId} elsewhere={elsewhere} onPickPlace={applyZone} />
            )}

            {!isLoading && products.length === 0 && !elsewhere && (
              <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest py-16 text-center">
                <div className="mb-1.5 text-title-lg font-semibold text-on-surface">
                  {hasZoneFilter && q.trim() ? `No encontramos “${q.trim()}” en ${zoneName}` : hasZoneFilter ? `Sin stock en ${zoneName}` : q.trim() ? `No encontramos productos con el nombre “${q.trim()}”` : "No hay productos que coincidan con estos filtros"}
                </div>
                {hasZoneFilter && (
                  <>
                    {nearbyProvinces.length > 0 && (
                      <>
                        <p className="mb-1 text-[13.5px] text-outline">Prueba en provincias cercanas:</p>
                        <div className="mb-2 text-[13.5px] font-semibold text-tertiary-accent">{nearbyProvinces.map((p) => p.name).join(" · ")}</div>
                      </>
                    )}
                    <button type="button" onClick={clearZone} className="min-h-11 text-[13.5px] font-semibold text-tertiary-accent underline">Ver productos de todos los lugares</button>
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* FILTROS (celular): hoja a pantalla completa con el mismo panel y un botón que muestra cuántos resultados hay */}
      {sheetOpen && !isDesktop && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-surface lg:hidden" role="dialog" aria-modal="true" aria-label="Filtros">
          <div className="flex items-center justify-between border-b border-surface-container-high bg-surface-container-lowest px-4 py-2.5">
            <h2 className="text-[17px] font-extrabold text-on-surface">Filtros</h2>
            <button type="button" onClick={() => setSheetOpen(false)} aria-label="Cerrar filtros" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-container">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto bg-surface-container-lowest px-4">
            <ShopFilters filters={filters} setFilter={setFilter} setMany={setMany} toggleInList={toggleInList} categories={categories ?? []} facets={facets} />
          </div>
          <div className="grid grid-cols-[auto_1fr] gap-2.5 border-t border-surface-container-high bg-surface-container-lowest p-3">
            <button type="button" onClick={clearFilters} disabled={!activeChips.length} className="min-h-12 rounded-xl border border-outline-variant px-5 text-[14px] font-semibold text-on-surface-variant disabled:opacity-40">Limpiar</button>
            <button type="button" onClick={() => setSheetOpen(false)} className="min-h-12 rounded-xl bg-secondary-container text-[14px] font-bold text-on-secondary-container">
              Ver {products.length} {products.length === 1 ? "producto" : "productos"}
            </button>
          </div>
        </div>
      )}

      <MarketplaceChatGate />
    </>
  );
}

// Lo buscado no está en la zona del cliente pero sí en otros lugares. Primero se dice claro que no es de su zona y dónde está;
// tocar un lugar cambia la zona a ese lugar. Debajo se ven los productos, cada tarjeta con el municipio o provincia de su tienda.
function ElsewhereResults({ query, zoneName, zoneCountryId, elsewhere, onPickPlace }) {
  const placeLabel = (p) => (p.provinceId && p.countryId !== zoneCountryId ? `${p.name}, ${p.countryName}` : p.name);
  const many = elsewhere.total !== 1;
  return (
    <div>
      <section aria-labelledby="elsewhere-title" className="mb-5 rounded-xl border border-surface-container-high bg-surface-container-lowest p-4 md:p-5">
        <h2 id="elsewhere-title" className="text-title-lg font-semibold text-on-surface">No encontramos “{query}” en {zoneName}</h2>
        <p className="mt-1 text-[13.5px] text-on-surface-variant">
          {many ? `Hay ${elsewhere.total} productos` : "Hay 1 producto"} en tiendas de otros lugares. Toca un lugar para comprar ahí, o mira {many ? "los productos" : "el producto"} aquí abajo.
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          {elsewhere.places.map((p) => (
            <button
              key={p.provinceId ?? p.countryId}
              type="button"
              onClick={() => onPickPlace({ countryId: p.countryId, provinceId: p.provinceId })}
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-[13.5px] font-semibold text-on-surface hover:border-tertiary-accent"
            >
              <MapPin className="h-4 w-4 text-tertiary-accent" aria-hidden="true" />
              {placeLabel(p)}
              <span className="text-outline">({p.count})</span>
            </button>
          ))}
        </div>
      </section>

      <h3 className="mb-3 text-[14px] font-bold text-on-surface">Fuera de tu zona</h3>
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5">
        {elsewhere.products.map((p) => (
          <ProductCard key={p.id} product={p} trackSource="search" />
        ))}
      </div>
    </div>
  );
}
