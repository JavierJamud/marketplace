import { useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { api } from "../../lib/api.js";
import { useZone } from "../../context/LocationContext.jsx";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { AddToCartControl } from "../../components/AddToCartControl.jsx";

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function imgUrl(path) {
  return `${api.defaults.baseURL}${path}`;
}

const PAY_OPTIONS = [
  { id: "whatsapp", label: "WhatsApp" },
  { id: "cod", label: "Contra entrega" },
  { id: "prepaid", label: "Transferencia CUP" },
];

const SORT_OPTIONS = [
  { value: "relevance", label: "Más relevantes" },
  { value: "price-asc", label: "Precio: menor a mayor" },
  { value: "price-desc", label: "Precio: mayor a menor" },
  { value: "rating", label: "Mejor calificados" },
];

function ProductTile({ product }) {
  const discount = product.oldPrice ? Math.round(100 - (Number(product.price) / Number(product.oldPrice)) * 100) : null;
  const location = product.vendor?.locations?.[0];

  return (
    <div className="overflow-hidden rounded-lg border border-surface-container-high bg-surface-container-lowest shadow-sm">
      <Link to={`/producto/${product.vendor?.slug}/${product.slug}`} className="relative block">
        {(product.badge || discount) && (
          <span
            className={`absolute left-3 top-3 z-10 rounded-full px-2.5 py-1 text-[11px] font-bold text-white ${
              discount ? "bg-error" : "bg-tertiary-accent"
            }`}
          >
            {product.badge ?? `-${discount}%`}
          </span>
        )}
        <div className="h-[180px] w-full overflow-hidden bg-surface-container">
          {product.images?.[0] ? (
            <img src={imgUrl(product.images[0])} alt={product.name} className="h-full w-full object-cover" />
          ) : (
            <div className="flex h-full w-full items-center justify-center text-label-sm text-outline">Sin foto</div>
          )}
        </div>
      </Link>
      <div className="p-4">
        <div className="mb-1 flex items-center gap-1">
          <span className="text-[11px] font-bold text-tertiary-accent">{product.vendor?.companyName}</span>
          {product.vendor?.isVerified && <VerifiedBadge size="sm" />}
        </div>
        <Link to={`/producto/${product.vendor?.slug}/${product.slug}`} className="mb-1.5 block text-body-md font-semibold leading-tight text-on-surface">
          {product.name}
        </Link>
        <div className="mb-2.5 text-[11.5px] text-outline">
          {location?.municipality?.name ?? location?.province?.name ?? "Cuba"} · {product.stock > 0 ? "Disponible" : "Sin stock"}
        </div>
        <div className="flex items-center justify-between">
          <div>
            <span className="text-base font-bold text-on-surface">{fmtCUP(product.price)}</span>
            {product.oldPrice && <span className="ml-1.5 text-label-sm text-outline line-through">{fmtCUP(product.oldPrice)}</span>}
          </div>
          <AddToCartControl product={product} />
        </div>
      </div>
    </div>
  );
}

export default function Shop() {
  const [searchParams, setSearchParams] = useSearchParams();
  const { provinceId, municipalityId, provinceName, hasProvinceFilter } = useZone();

  const q = searchParams.get("q") ?? "";
  const categoryId = searchParams.get("categoryId") ?? "";

  const [maxPrice, setMaxPrice] = useState(10000);
  const [pay, setPay] = useState({ whatsapp: true, cod: true, prepaid: true });
  // Bloque 30: arranca desde la URL (mismo criterio que q/categoryId arriba)
  // — así "Solo verificadas" activado en el dropdown de SearchBar sigue
  // activo al llegar acá con "Ver todos los resultados".
  const [onlyVerified, setOnlyVerified] = useState(searchParams.get("onlyVerified") === "true");
  const [sort, setSort] = useState("relevance");

  const { data: categories } = useQuery({
    queryKey: ["categories"],
    queryFn: async () => (await api.get("/categories")).data.categories,
  });

  const paymentParam = Object.entries(pay)
    .filter(([, checked]) => checked)
    .map(([id]) => id)
    .join(",");

  const { data, isLoading } = useQuery({
    queryKey: ["shop-products", q, categoryId, provinceId, municipalityId, maxPrice, paymentParam, onlyVerified, sort],
    queryFn: async () =>
      (
        await api.get("/search", {
          params: {
            q: q || undefined,
            categoryId: categoryId || undefined,
            provinceId: provinceId || undefined,
            municipalityId: municipalityId || undefined,
            maxPrice,
            payment: paymentParam || undefined,
            onlyVerified: onlyVerified || undefined,
            sort,
          },
        })
      ).data,
  });

  const products = data?.products ?? [];
  const nearbyProvinces = data?.nearbyProvinces ?? [];

  function clearFilters() {
    setMaxPrice(10000);
    setPay({ whatsapp: true, cod: true, prepaid: true });
    setOnlyVerified(false);
    setSort("relevance");
    setSearchParams((p) => {
      p.delete("categoryId");
      p.delete("q");
      return p;
    });
  }

  return (
    <div>
      {/* PAGE HEADER */}
      <div className="border-b border-surface-container-high bg-surface-container-lowest">
        <div className="container-app py-7">
          <div className="mb-2 text-label-sm text-outline">
            <Link to="/" className="text-outline hover:text-primary-container">Inicio</Link> / <span className="text-on-surface">Catálogo</span>
          </div>
          <h1 className="font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">
            {hasProvinceFilter ? `Catálogo en ${provinceName}` : "Catálogo completo"}
          </h1>
          <p className="mt-1.5 text-label-sm text-outline">
            {hasProvinceFilter ? "Resultados filtrados por tu provincia" : "Todas las provincias"} · las tiendas verificadas se muestran primero
          </p>
        </div>
      </div>

      {/* CATEGORY PILLS */}
      <div className="container-app flex flex-wrap gap-2.5 pt-5">
        <button
          onClick={() => setSearchParams((p) => { p.delete("categoryId"); return p; })}
          className={`rounded-full border px-[18px] py-2.5 text-label-md font-semibold ${
            !categoryId ? "border-primary-container bg-primary-container text-white" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
          }`}
        >
          Todos
        </button>
        {categories?.map((c) => (
          <button
            key={c.id}
            onClick={() => setSearchParams((p) => { p.set("categoryId", c.id); return p; })}
            className={`rounded-full border px-[18px] py-2.5 text-label-md font-semibold ${
              categoryId === c.id ? "border-primary-container bg-primary-container text-white" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"
            }`}
          >
            {c.name}
          </button>
        ))}
      </div>

      {/* MAIN */}
      <div className="container-app grid grid-cols-1 gap-8 py-6 lg:grid-cols-[250px_1fr] lg:items-start">
        {/* SIDEBAR */}
        <aside className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-5 lg:sticky lg:top-[88px]">
          <div className="mb-3 text-label-md font-bold text-on-surface">Precio máximo</div>
          <input
            type="range"
            min={0}
            max={10000}
            step={100}
            value={maxPrice}
            onChange={(e) => setMaxPrice(Number(e.target.value))}
            className="mb-1.5 w-full accent-secondary-container"
          />
          <div className="mb-6 text-label-sm text-outline">Hasta {fmtCUP(maxPrice)}</div>

          <div className="mb-3 text-label-md font-bold text-on-surface">Método de pago</div>
          <div className="mb-6 flex flex-col gap-2.5">
            {PAY_OPTIONS.map((pf) => (
              <label key={pf.id} className="flex cursor-pointer items-center gap-2.5">
                <input
                  type="checkbox"
                  checked={pay[pf.id]}
                  onChange={() => setPay((p) => ({ ...p, [pf.id]: !p[pf.id] }))}
                  className="h-[15px] w-[15px] accent-tertiary-accent"
                />
                <span className="text-[13.5px] text-on-surface-variant">{pf.label}</span>
              </label>
            ))}
          </div>

          <label className="mb-2 flex cursor-pointer items-center gap-2.5">
            <input
              type="checkbox"
              checked={onlyVerified}
              onChange={() => setOnlyVerified((v) => !v)}
              className="h-[15px] w-[15px] accent-tertiary-accent"
            />
            <span className="text-[13.5px] font-semibold text-on-surface-variant">Solo tiendas verificadas</span>
          </label>
          <button onClick={clearFilters} className="mt-3.5 w-full rounded border border-outline-variant py-2.5 text-label-md text-on-surface-variant">
            Limpiar filtros
          </button>
        </aside>

        {/* GRID */}
        <div>
          <div className="mb-[18px] flex items-center justify-between">
            <span className="text-[13.5px] text-outline">
              {products.length} productos {hasProvinceFilter ? `en ${provinceName}` : "en todo el país"}
            </span>
            <select
              value={sort}
              onChange={(e) => setSort(e.target.value)}
              className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-label-sm text-on-surface outline-none"
            >
              {SORT_OPTIONS.map((s) => (
                <option key={s.value} value={s.value}>{s.label}</option>
              ))}
            </select>
          </div>

          {isLoading && <p className="text-body-md text-on-surface-variant">Cargando productos...</p>}

          {!isLoading && products.length > 0 && (
            <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {products.map((p) => (
                <ProductTile key={p.id} product={p} />
              ))}
            </div>
          )}

          {!isLoading && products.length === 0 && (
            <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest py-16 text-center">
              <div className="mb-1.5 text-title-lg font-semibold text-on-surface">
                {hasProvinceFilter ? `Sin stock en ${provinceName}` : "No hay productos que coincidan con estos filtros"}
              </div>
              {hasProvinceFilter && (
                <>
                  <p className="mb-1 text-[13.5px] text-outline">Probá en provincias cercanas:</p>
                  <div className="text-[13.5px] font-semibold text-tertiary-accent">
                    {nearbyProvinces.length ? nearbyProvinces.map((p) => p.name).join(" · ") : "otras provincias"}
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
