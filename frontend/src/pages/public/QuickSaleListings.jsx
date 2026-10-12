import { useMemo, useState } from "react";
import { useSearchParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { SearchBox } from "../../components/ui/SearchBox.jsx";
import { Package } from "lucide-react";
import { api } from "../../lib/api.js";
import { QuickSaleCard } from "../../components/QuickSaleCard.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";

// Listado público de anuncios de venta rápida de clientes SIN tienda.
// Deliberadamente separado de Shop.jsx (esa query ya es compleja — plan/
// ubicación/verificación de Vendor — y CustomerListing no tiene nada de
// eso: es un anuncio clasificado simple, con dueño = User).
const CONDITION_FILTERS = [
  { id: "", label: "Todos" },
  { id: "NEW", label: "Nuevo" },
  { id: "USED", label: "Usado" },
  { id: "REFURBISHED", label: "Reacondicionado" },
];

export default function QuickSaleListings() {
  const [params] = useSearchParams();
  const [search, setSearch] = useState(() => params.get("q") ?? "");
  const [condition, setCondition] = useState("");
  const { data: listings, isLoading } = useQuery({
    queryKey: ["public-customer-listings"],
    queryFn: async () => (await api.get("/customer-listings")).data.listings,
  });

  // Se busca en el título, la descripción, las palabras clave, la zona y la provincia.
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (listings ?? [])
      .filter((l) => !condition || l.condition === condition)
      .filter((l) => !q || q.split(/\s+/).every((p) => [l.name, l.description, (l.tags ?? []).join(" "), l.locationNote, l.owner?.province?.name].join(" ").toLowerCase().includes(p)));
  }, [listings, search, condition]);

  return (
    <div className="container-app py-11">
      <h1 className="mb-1 text-headline-lg text-on-surface">Venta rápida</h1>
      <p className="mb-7 text-body-md text-on-surface-variant">
        Productos publicados directamente por clientes — sin tienda, se coordina todo por WhatsApp.
      </p>

      {(listings?.length ?? 0) > 0 && (
        <div className="mb-6 flex flex-col gap-3">
          <SearchBox className="max-w-[520px]" value={search} onChange={setSearch} placeholder="Buscar por nombre, palabra clave o zona" resultText={search.trim() || condition ? `${shown.length} de ${listings.length} anuncios` : undefined} />
          <div className="flex flex-wrap gap-2" role="group" aria-label="Estado del artículo">
            {CONDITION_FILTERS.map((c) => (
              <button key={c.id} type="button" onClick={() => setCondition(c.id)} aria-pressed={condition === c.id} className={`min-h-10 rounded-full border px-4 text-[13px] font-semibold ${condition === c.id ? "border-primary-container bg-primary-container text-white" : "border-outline-variant bg-surface-container-lowest text-on-surface-variant"}`}>
                {c.label}
              </button>
            ))}
          </div>
        </div>
      )}
      {!isLoading && (!listings || listings.length === 0) && (
        <EmptyState icon={Package} title="No hay anuncios de venta rápida por ahora" />
      )}
      {!isLoading && listings?.length > 0 && shown.length === 0 && <p className="text-body-md text-on-surface-variant">Ningún anuncio coincide con tu búsqueda.</p>}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {shown.map((l) => (
          <QuickSaleCard key={l.id} listing={l} />
        ))}
      </div>
    </div>
  );
}
