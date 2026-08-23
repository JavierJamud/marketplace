import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { EmptyState } from "../../components/ui/EmptyState.jsx";

// Listado público de anuncios de venta rápida de clientes SIN tienda.
// Deliberadamente separado de Shop.jsx (esa query ya es compleja — plan/
// ubicación/verificación de Vendor — y CustomerListing no tiene nada de
// eso: es un anuncio clasificado simple, con dueño = User).
export default function QuickSaleListings() {
  const { data: listings, isLoading } = useQuery({
    queryKey: ["public-customer-listings"],
    queryFn: async () => (await api.get("/customer-listings")).data.listings,
  });

  return (
    <div className="container-app py-11">
      <h1 className="mb-1 text-headline-lg text-on-surface">Venta rápida</h1>
      <p className="mb-7 text-body-md text-on-surface-variant">
        Productos publicados directamente por clientes — sin tienda, se coordina todo por WhatsApp.
      </p>

      {!isLoading && (!listings || listings.length === 0) && (
        <EmptyState icon={Package} title="No hay anuncios de venta rápida por ahora" />
      )}

      <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-4">
        {listings?.map((l) => {
          const image = l.images?.[0] ? `${api.defaults.baseURL}${l.images[0]}` : null;
          return (
            <Link
              key={l.id}
              to={`/ventas-rapidas/${l.id}`}
              className="overflow-hidden rounded-[22px] bg-surface-container-lowest shadow-[0_1px_3px_rgba(27,27,29,0.07),0_1px_2px_rgba(27,27,29,0.05)] transition-shadow hover:shadow-lg"
            >
              <div className="relative aspect-[7/4] w-full overflow-hidden bg-surface-container">
                {image ? (
                  <img src={image} alt={l.name} className="h-full w-full object-cover" />
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-outline">
                    <Package className="h-8 w-8" />
                  </div>
                )}
              </div>
              <div className="p-3">
                <div className="mb-0.5 truncate text-[13.5px] font-bold text-on-surface">{l.name}</div>
                <div className="text-[14px] font-bold text-secondary">{formatPrice(l.price, l.currency)}</div>
              </div>
            </Link>
          );
        })}
      </div>
    </div>
  );
}
