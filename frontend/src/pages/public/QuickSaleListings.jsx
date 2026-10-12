import { useQuery } from "@tanstack/react-query";
import { Package } from "lucide-react";
import { api } from "../../lib/api.js";
import { QuickSaleCard } from "../../components/QuickSaleCard.jsx";
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
        {listings?.map((l) => (
          <QuickSaleCard key={l.id} listing={l} />
        ))}
      </div>
    </div>
  );
}
