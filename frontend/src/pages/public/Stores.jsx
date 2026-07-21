import { useQuery } from "@tanstack/react-query";
import { useSearchParams } from "react-router-dom";
import { MapPin, X, Store as StoreIcon } from "lucide-react";
import { api } from "../../lib/api.js";
import { useZone } from "../../context/LocationContext.jsx";
import { StoreCard } from "../../components/StoreCard.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { CategoryIcon } from "../../components/ui/CategoryIcon.jsx";

// Bloque 17: el selector de provincia/municipio se mudó del header global
// (visible en todo el sitio) a esta pantalla — es donde realmente tiene
// sentido como filtro de búsqueda. Mismo dataset/estado de siempre
// (useZone/LocationContext), nada duplicado.
// Bloque 18: se suma el filtro de "tipo de negocio" — combinable con los de
// arriba. Se guarda en la URL (como isRestaurant) para que el link de una
// categoría del Home llegue acá ya filtrado y el resultado sea compartible.
export default function Stores() {
  const { provinces, municipalities, provinceId, municipalityId, provinceName, hasProvinceFilter, setProvince, setMunicipality, clearFilter } =
    useZone();
  const [searchParams, setSearchParams] = useSearchParams();
  const isRestaurant = searchParams.get("isRestaurant") === "true";
  const businessCategoryId = searchParams.get("businessCategoryId") ?? "";

  function setBusinessCategoryId(id) {
    const next = new URLSearchParams(searchParams);
    if (id) next.set("businessCategoryId", id);
    else next.delete("businessCategoryId");
    setSearchParams(next);
  }

  const { data: businessCategories } = useQuery({
    queryKey: ["business-categories"],
    queryFn: async () => (await api.get("/business-categories")).data.categories,
  });
  const selectedBusinessCategory = businessCategories?.find((c) => c.id === businessCategoryId);

  const { data: vendors, isLoading } = useQuery({
    queryKey: ["vendors", provinceId, municipalityId, isRestaurant, businessCategoryId],
    queryFn: async () =>
      (
        await api.get("/vendors", {
          params: {
            provinceId: provinceId || undefined,
            municipalityId: municipalityId || undefined,
            isRestaurant: isRestaurant || undefined,
            businessCategoryId: businessCategoryId || undefined,
          },
        })
      ).data.vendors,
  });

  return (
    <div className="container-app py-11">
      <h1 className="mb-1 text-headline-lg text-on-surface">{isRestaurant ? "Restaurantes con menú QR" : "Todas las tiendas"}</h1>
      <p className="mb-5 text-body-md text-on-surface-variant">
        {vendors?.length ?? 0} {isRestaurant ? "restaurantes" : "tiendas"} en {provinceName} · las verificadas se muestran primero.
      </p>

      <div className="mb-7 flex flex-wrap items-center gap-2.5 rounded-md border border-surface-container-high bg-surface-container-lowest px-4 py-3.5">
        <MapPin className="h-4 w-4 flex-shrink-0 text-tertiary-accent" />
        <select
          value={provinceId ?? ""}
          onChange={(e) => setProvince(e.target.value)}
          className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] font-semibold text-on-surface outline-none"
        >
          <option value="">Todas las provincias</option>
          {provinces.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        {hasProvinceFilter && municipalities.length > 0 && (
          <select
            value={municipalityId ?? ""}
            onChange={(e) => setMunicipality(e.target.value || null)}
            className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] text-on-surface-variant outline-none"
          >
            <option value="">Todos los municipios</option>
            {municipalities.map((m) => (
              <option key={m.id} value={m.id}>
                {m.name}
              </option>
            ))}
          </select>
        )}
        {hasProvinceFilter && (
          <button onClick={clearFilter} className="flex items-center gap-1 text-[12.5px] font-semibold text-tertiary-accent hover:underline">
            <X className="h-3.5 w-3.5" /> Limpiar filtro
          </button>
        )}

        <span className="mx-0.5 hidden h-6 w-px bg-surface-container-high sm:block" />

        {selectedBusinessCategory && (
          <span className="flex h-7 w-7 flex-shrink-0 items-center justify-center rounded-full bg-tertiary-accent/10">
            <CategoryIcon name={selectedBusinessCategory.icon} className="h-3.5 w-3.5 text-tertiary-accent" />
          </span>
        )}
        <select
          value={businessCategoryId}
          onChange={(e) => setBusinessCategoryId(e.target.value)}
          className="rounded border border-outline-variant bg-surface-container-lowest px-3 py-2 text-[13px] font-semibold text-on-surface outline-none"
        >
          <option value="">Todos los tipos de negocio</option>
          {businessCategories?.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
        {businessCategoryId && (
          <button
            onClick={() => setBusinessCategoryId("")}
            className="flex items-center gap-1 text-[12.5px] font-semibold text-tertiary-accent hover:underline"
          >
            <X className="h-3.5 w-3.5" /> Limpiar
          </button>
        )}
      </div>

      {!isLoading && (!vendors || vendors.length === 0) && (
        <EmptyState icon={StoreIcon} title={isRestaurant ? "No hay restaurantes en esta provincia todavía" : "No hay tiendas en esta provincia todavía"} />
      )}

      <div className="grid grid-cols-1 gap-5 sm:grid-cols-2 lg:grid-cols-3">
        {vendors?.map((v) => (
          <StoreCard key={v.id} vendor={v} />
        ))}
      </div>
    </div>
  );
}
