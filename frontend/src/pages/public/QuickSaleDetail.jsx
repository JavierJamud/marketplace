import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Package, ChevronLeft, ShieldAlert } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { waLink } from "../../lib/whatsapp.js";
import { Spinner } from "../../components/ui/Spinner.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { ReportFraudModal } from "../../components/ReportFraudModal.jsx";

// Detalle público de un anuncio de venta rápida. A diferencia de Product.jsx
// (que exige pasar por carrito/checkout, ver Bloque 68), acá el pedido es
// SIEMPRE directo por WhatsApp — no hay tienda/inventario/checkout detrás,
// es un anuncio clasificado entre particulares. Mismo criterio explícito
// del pedido original ("solo tendrán la opción de pedir por WhatsApp").
export default function QuickSaleDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const [reportFraudOpen, setReportFraudOpen] = useState(false);
  const [selectedImage, setSelectedImage] = useState(0);

  const { data: listing, isLoading } = useQuery({
    queryKey: ["public-customer-listing", id],
    queryFn: async () => (await api.get(`/customer-listings/${id}`)).data.listing,
  });

  if (isLoading) {
    return (
      <div className="container-app flex justify-center py-20">
        <Spinner />
      </div>
    );
  }

  if (!listing) {
    return (
      <div className="container-app py-20 text-center">
        <p className="text-title-lg text-on-surface">Este anuncio ya no está disponible.</p>
        <Link to="/ventas-rapidas" className="mt-3 inline-block text-body-md font-semibold text-tertiary-accent hover:underline">
          Ver otros anuncios
        </Link>
      </div>
    );
  }

  const images = listing.images ?? [];
  const image = images[selectedImage] ? `${api.defaults.baseURL}${images[selectedImage]}` : null;
  const message = `Hola, vi tu anuncio "${listing.name}" (${formatPrice(listing.price, listing.currency)}) en ZeuDin y me interesa.`;

  return (
    <div className="container-app py-9">
      <Link to="/ventas-rapidas" className="mb-5 inline-flex items-center gap-1 text-[13px] font-semibold text-on-surface-variant hover:text-on-surface">
        <ChevronLeft className="h-4 w-4" /> Volver a venta rápida
      </Link>

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <div>
          <div className="aspect-[7/4] w-full overflow-hidden rounded-2xl bg-surface-container">
            {image ? (
              <img src={image} alt={listing.name} className="h-full w-full object-cover" />
            ) : (
              <div className="flex h-full w-full items-center justify-center text-outline">
                <Package className="h-12 w-12" />
              </div>
            )}
          </div>
          {/* Pedido explícito: "casi igual a un producto de tienda" — mismo
              criterio de miniaturas que Product.jsx cuando hay más de 1 foto. */}
          {images.length > 1 && (
            <div className="mt-2.5 grid grid-cols-4 gap-2">
              {images.map((url, i) => (
                <button
                  key={url}
                  onClick={() => setSelectedImage(i)}
                  className={`aspect-[7/4] w-full overflow-hidden rounded-md border-2 transition-all ${
                    i === selectedImage ? "border-tertiary-accent opacity-100" : "border-transparent opacity-55 hover:opacity-85"
                  }`}
                >
                  <img src={`${api.defaults.baseURL}${url}`} alt="" className="h-full w-full object-cover" />
                </button>
              ))}
            </div>
          )}
        </div>

        <div>
          <span className="mb-2 inline-block rounded-full bg-tertiary-accent/10 px-3 py-1 text-[11.5px] font-bold text-tertiary-accent">
            Venta rápida — publicado por un cliente
          </span>
          <h1 className="mb-2 text-headline-md text-on-surface">{listing.name}</h1>
          <div className="mb-5 text-title-lg font-bold text-secondary">{formatPrice(listing.price, listing.currency)}</div>
          <p className="mb-7 whitespace-pre-line text-body-md text-on-surface-variant">{listing.description}</p>

          <a
            href={waLink(listing.owner.phone, message)}
            target="_blank"
            rel="noreferrer"
            className="inline-flex items-center gap-2 rounded-xl bg-[#25D366] px-6 py-3 text-label-md font-bold text-white shadow-md transition-all hover:brightness-105 hover:shadow-lg active:scale-95"
          >
            <MessageCircle className="h-[18px] w-[18px]" />
            Pedir por WhatsApp
          </a>

          {/* Pedido explícito: solo visible para clientes logueados. */}
          {user?.role === "CUSTOMER" && (
            <button
              onClick={() => setReportFraudOpen(true)}
              className="ml-3 inline-flex items-center gap-1.5 text-[12.5px] font-semibold text-outline hover:text-error"
            >
              <ShieldAlert className="h-4 w-4" /> Reportar estafa
            </button>
          )}
        </div>
      </div>

      <ReportFraudModal
        open={reportFraudOpen}
        onClose={() => setReportFraudOpen(false)}
        targetField="customerListingId"
        targetId={listing.id}
        targetLabel={`el anuncio "${listing.name}"`}
      />
    </div>
  );
}
