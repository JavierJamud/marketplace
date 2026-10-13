import { useEffect, useState } from "react";
import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { SlidersHorizontal, X, Store as StoreIcon } from "lucide-react";
import { api } from "../../lib/api.js";
import { useZone } from "../../context/LocationContext.jsx";
import { useMediaQuery } from "../../lib/useMediaQuery.js";
import { StoreCard } from "../../components/StoreCard.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { SearchBox } from "../../components/ui/SearchBox.jsx";
import { ZoneChip } from "../../components/ZonePicker.jsx";
import { StoreFilters } from "../../components/shop/StoreFilters.jsx";
import { ActiveFilterChips } from "../../components/shop/ShopFilters.jsx";
import { MarketplaceChatGate } from "../../components/MarketplaceChatGate.jsx";
import { PAYMENT_METHODS } from "../../lib/paymentMethods.js";
import { CHECKOUT_PAY_CHOICES } from "../../lib/checkoutPayment.js";

// Página de tiendas. El lugar donde se compra (país, provincia o estado, municipio) es un filtro general del sitio que se elige
// en la portada o con el botón de arriba (ver ZonePicker); aquí solo se filtra por lo propio de cada tienda: tipo de
// establecimiento, tipo de negocio, verificación, precios, formas de pago y valoración. Todo vive en la URL, así que el enlace
// de una categoría de la portada llega ya filtrado y cualquier resultado se puede compartir.

const SORTS = [
  { value: "recent", label: "Verificadas y recientes" },
  { value: "rating", label: "Mejor valoradas" },
  { value: "products", label: "Con más productos" },
];
const FILTER_KEYS = ["isRestaurant", "isVerified", "businessCategoryId", "minPrice", "maxPrice", "currency", "payment", "accepts", "minRating", "q"];
const list = (v) => (v ? v.split(",").filter(Boolean) : []);

export default function Stores() {
  const { zoneParams, zoneKey, zoneName, hasZoneFilter, clearFilter: clearZone } = useZone();
  const [searchParams, setSearchParams] = useSearchParams();
  const isDesktop = useMediaQuery("(min-width: 1024px)");
  const [sheetOpen, setSheetOpen] = useState(false);

  const rest = searchParams.get("isRestaurant");
  const ver = searchParams.get("isVerified");
  const filters = {
    kind: rest === "true" || rest === "false" ? rest : "",
    verified: ver === "true" || ver === "false" ? ver : "",
    businessCategoryIds: list(searchParams.get("businessCategoryId")),
    minPrice: searchParams.get("minPrice") ?? "",
    maxPrice: searchParams.get("maxPrice") ?? "",
    currency: searchParams.get("currency") ?? "",
    payment: list(searchParams.get("payment")).filter((m) => ["cod", "online", "cash"].includes(m)),
    accepts: list(searchParams.get("accepts")),
    minRating: searchParams.get("minRating") ?? "",
  };
  const sort = SORTS.some((s) => s.value === searchParams.get("sort")) ? searchParams.get("sort") : "recent";
  const q = searchParams.get("q") ?? "";

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
  const clearFilters = () =>
    setSearchParams((p) => {
      [...FILTER_KEYS, "sort"].forEach((k) => p.delete(k));
      return p;
    });

  // El texto de búsqueda se escribe sin esperar a la red: pasa a la URL (y a la consulta) cuando el visitante hace una pausa.
  const [text, setText] = useState(q);
  useEffect(() => setText(q), [q]);
  useEffect(() => {
    if (text === q) return undefined;
    const id = setTimeout(() => setFilter("q", text.trim()), 300);
    return () => clearTimeout(id);
  }, [text]); // eslint-disable-line react-hooks/exhaustive-deps

  // El fondo no se desplaza mientras está abierta la hoja de filtros del celular.
  useEffect(() => {
    if (!sheetOpen) return undefined;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [sheetOpen]);

  const { data: businessCategories } = useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => (await api.get("/business-categories")).data.categories,
  });

  const { data: vendors, isLoading, isError, refetch } = useQuery({
    queryKey: ["vendors", zoneKey, searchParams.toString()],
    placeholderData: keepPreviousData,
    queryFn: async () =>
      (
        await api.get("/vendors", {
          params: {
            ...zoneParams,
            q: q || undefined,
            isRestaurant: filters.kind || undefined,
            isVerified: filters.verified || undefined,
            businessCategoryId: filters.businessCategoryIds.join(",") || undefined,
            minPrice: filters.minPrice || undefined,
            maxPrice: filters.maxPrice || undefined,
            currency: filters.currency || undefined,
            payment: filters.payment.join(",") || undefined,
            accepts: filters.accepts.join(",") || undefined,
            minRating: filters.minRating || undefined,
            sort,
          },
        })
      ).data.vendors,
  });

  const total = vendors?.length ?? 0;
  const noun = filters.kind === "true" ? (total === 1 ? "restaurante" : "restaurantes") : total === 1 ? "tienda" : "tiendas";

  const catName = (id) => businessCategories?.find((c) => c.id === id)?.name ?? "Tipo de negocio";
  const activeChips = [
    filters.kind && { key: "kind", label: filters.kind === "true" ? "Restaurantes" : "Tiendas", remove: () => setFilter("isRestaurant", "") },
    ...filters.businessCategoryIds.map((id) => ({ key: `cat-${id}`, label: catName(id), remove: () => toggleInList("businessCategoryId", id) })),
    filters.verified && { key: "ver", label: filters.verified === "true" ? "Verificadas" : "Sin verificar", remove: () => setFilter("isVerified", "") },
    (filters.minPrice || filters.maxPrice) && {
      key: "price",
      label: `${filters.minPrice ? `Desde ${filters.minPrice}` : ""}${filters.minPrice && filters.maxPrice ? " " : ""}${filters.maxPrice ? `Hasta ${filters.maxPrice}` : ""} ${filters.currency}`.trim(),
      remove: () => setMany({ minPrice: "", maxPrice: "" }),
    },
    filters.currency && !(filters.minPrice || filters.maxPrice) && { key: "cur", label: `Productos en ${filters.currency}`, remove: () => setFilter("currency", "") },
    ...filters.payment.map((id) => ({ key: `pay-${id}`, label: CHECKOUT_PAY_CHOICES.find((o) => o.id === id)?.title ?? id, remove: () => toggleInList("payment", id) })),
    ...filters.accepts.map((id) => ({ key: `acc-${id}`, label: `Acepta ${PAYMENT_METHODS.find((m) => m.id === id)?.label ?? id}`, remove: () => toggleInList("accepts", id) })),
    filters.minRating && { key: "rate", label: `${filters.minRating}★ o más`, remove: () => setFilter("minRating", "") },
    q && { key: "q", label: `“${q}”`, remove: () => setFilter("q", "") },
  ].filter(Boolean);

  const title = filters.kind === "true" ? "Restaurantes con menú QR" : filters.verified === "true" ? "Tiendas verificadas" : filters.verified === "false" ? "Tiendas sin verificar" : "Todas las tiendas";
  const panel = <StoreFilters filters={filters} setFilter={setFilter} setMany={setMany} toggleInList={toggleInList} businessCategories={businessCategories ?? []} />;

  return (
    <>
      <div className="container-app py-5 md:py-9">
        <h1 className="mb-1 text-headline-lg-mobile text-on-surface md:text-headline-lg">{title}</h1>
        <p className="mb-3 text-body-md text-on-surface-variant">
          {total} {noun} {hasZoneFilter ? `en ${zoneName}` : "en total"} · las verificadas se muestran primero.
        </p>
        <ZoneChip className="mb-5" />

        <div className="grid grid-cols-1 gap-6 lg:grid-cols-[290px_1fr] lg:items-start lg:gap-8">
          {isDesktop && (
            <aside className="rounded-xl border border-surface-container-high bg-surface-container-lowest px-4 lg:sticky lg:top-[88px] lg:max-h-[calc(100vh-110px)] lg:overflow-y-auto">
              <div className="flex items-center justify-between pt-3.5">
                <h2 className="text-[15px] font-extrabold text-on-surface">Filtros</h2>
                {activeChips.length > 0 && (
                  <button type="button" onClick={clearFilters} className="min-h-9 text-[12.5px] font-semibold text-tertiary-accent hover:underline">Limpiar</button>
                )}
              </div>
              {panel}
            </aside>
          )}

          <div className="min-w-0">
            <div className="mb-3 flex flex-wrap items-center gap-2.5">
              <SearchBox className="min-w-0 flex-1 basis-full sm:basis-64" value={text} onChange={setText} placeholder="Buscar tienda por nombre" />
              <button type="button" onClick={() => setSheetOpen(true)} className="inline-flex min-h-11 items-center gap-2 rounded-full border border-outline-variant bg-surface-container-lowest px-4 text-[13.5px] font-bold text-on-surface lg:hidden">
                <SlidersHorizontal className="h-4 w-4" aria-hidden="true" /> Filtros
                {activeChips.length > 0 && <span className="rounded-full bg-tertiary-accent px-1.5 py-0.5 text-[11px] leading-none text-white">{activeChips.length}</span>}
              </button>
              <select
                value={sort}
                onChange={(e) => setFilter("sort", e.target.value === "recent" ? "" : e.target.value)}
                aria-label="Ordenar por"
                className="min-h-11 min-w-0 flex-1 rounded-full border border-outline-variant bg-surface-container-lowest px-3.5 text-label-sm text-on-surface outline-none sm:max-w-[230px] sm:flex-none lg:ml-auto"
              >
                {SORTS.map((s) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
            </div>

            {activeChips.length > 0 && (
              <div className="mb-4">
                <ActiveFilterChips items={activeChips} onClear={clearFilters} />
              </div>
            )}

            {isError && (
              <EmptyState
                icon={StoreIcon}
                title="No pudimos cargar las tiendas"
                description="Revisa tu conexión e inténtalo de nuevo."
                action={<button type="button" onClick={() => refetch()} className="min-h-11 rounded-xl bg-secondary-container px-5 text-[14px] font-bold text-on-secondary-container">Reintentar</button>}
              />
            )}

            {isLoading && <p className="text-body-md text-on-surface-variant">Cargando tiendas...</p>}

            {!isLoading && !isError && total === 0 && (
              <EmptyState
                icon={StoreIcon}
                title={activeChips.length || hasZoneFilter ? "Ninguna tienda coincide con estos filtros" : "No hay tiendas todavía"}
                description={activeChips.length || hasZoneFilter ? "Quita alguno de los filtros o cambia el lugar para ver más." : undefined}
                action={
                  activeChips.length > 0 || hasZoneFilter ? (
                    <div className="flex flex-wrap justify-center gap-2">
                      {activeChips.length > 0 && <button type="button" onClick={clearFilters} className="min-h-11 rounded-xl bg-secondary-container px-5 text-[14px] font-bold text-on-secondary-container">Quitar filtros</button>}
                      {hasZoneFilter && <button type="button" onClick={clearZone} className="min-h-11 rounded-xl border border-outline-variant px-5 text-[14px] font-semibold text-on-surface-variant">Ver todos los lugares</button>}
                    </div>
                  ) : undefined
                }
              />
            )}

            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 xl:grid-cols-3">
              {vendors?.map((v) => (
                <StoreCard key={v.id} vendor={v} />
              ))}
            </div>
          </div>
        </div>
      </div>

      {/* FILTROS (celular): hoja a pantalla completa con el mismo panel y un botón que muestra cuántas tiendas hay */}
      {sheetOpen && !isDesktop && (
        <div className="fixed inset-0 z-[70] flex flex-col bg-surface lg:hidden" role="dialog" aria-modal="true" aria-label="Filtros de tiendas">
          <div className="flex items-center justify-between border-b border-surface-container-high bg-surface-container-lowest px-4 py-2.5">
            <h2 className="text-[17px] font-extrabold text-on-surface">Filtros</h2>
            <button type="button" onClick={() => setSheetOpen(false)} aria-label="Cerrar filtros" className="flex h-11 w-11 items-center justify-center rounded-full hover:bg-surface-container">
              <X className="h-5 w-5" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto bg-surface-container-lowest px-4">{panel}</div>
          <div className="grid grid-cols-[auto_1fr] gap-2.5 border-t border-surface-container-high bg-surface-container-lowest p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
            <button type="button" onClick={clearFilters} disabled={!activeChips.length} className="min-h-12 rounded-xl border border-outline-variant px-5 text-[14px] font-semibold text-on-surface-variant disabled:opacity-40">Limpiar</button>
            <button type="button" onClick={() => setSheetOpen(false)} className="min-h-12 rounded-xl bg-secondary-container text-[14px] font-bold text-on-secondary-container">
              Ver {total} {noun}
            </button>
          </div>
        </div>
      )}

      <MarketplaceChatGate />
    </>
  );
}
