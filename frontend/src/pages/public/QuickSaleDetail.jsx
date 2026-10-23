import { useState } from "react";
import { useParams, Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { MessageCircle, Package, ShieldAlert, MapPin, Phone } from "lucide-react";
import { ListingGallery } from "../../components/ListingGallery.jsx";
import { conditionLabel } from "../../components/customer/ListingFormFields.jsx";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { waLink } from "../../lib/whatsapp.js";
import { Skeleton, SkeletonGroup } from "../../components/ui/Skeleton.jsx";
import { useAuth } from "../../context/AuthContext.jsx";
import { ReportFraudModal } from "../../components/ReportFraudModal.jsx";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { Breadcrumbs } from "../../components/Breadcrumbs.jsx";

// Detalle público de un anuncio de venta rápida. A diferencia de Product.jsx
// (que exige pasar por carrito/checkout, ver Bloque 68), acá el pedido es
// SIEMPRE directo por WhatsApp — no hay tienda/inventario/checkout detrás,
// es un anuncio clasificado entre particulares. Mismo criterio explícito
// del pedido original ("solo tendrán la opción de pedir por WhatsApp").
export default function QuickSaleDetail() {
  const { id } = useParams();
  const { user } = useAuth();
  const { siteName } = usePlatformSettings();
  const [reportFraudOpen, setReportFraudOpen] = useState(false);

  const { data: listing, isLoading } = useQuery({
    queryKey: ["public-customer-listing", id],
    queryFn: async () => (await api.get(`/customer-listings/${id}`)).data.listing,
  });

  if (isLoading) {
    return (
      <SkeletonGroup label="Cargando anuncio" className="container-app py-4 md:py-9">
        <Skeleton width={170} height={14} className="mb-6" />
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2" aria-hidden="true">
          <div className="aspect-[7/4] w-full">
            <Skeleton height="100%" borderRadius={16} containerClassName="block h-full leading-none" />
          </div>
          <div>
            <div className="mb-3 flex gap-2">
              <Skeleton width={90} height={24} borderRadius={999} />
              <Skeleton width={70} height={24} borderRadius={999} />
            </div>
            <Skeleton width="80%" height={28} className="mb-2" />
            <Skeleton width={130} height={22} className="mb-4" />
            <Skeleton count={3} height={13} />
            <Skeleton height={48} borderRadius={12} className="mt-5" />
          </div>
        </div>
      </SkeletonGroup>
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
  const tiers = [...(listing.priceTiers ?? [])].sort((a, b) => a.minQty - b.minQty);
  const message = `Hola, vi tu anuncio "${listing.name}" (${formatPrice(listing.price, listing.currency)}) en ${siteName} y me interesa.`;

  return (
    <div className="container-app py-4 md:py-9">
      <Breadcrumbs className="mb-4" items={[{ label: "Venta rápida", to: "/ventas-rapidas" }, { label: listing.name }]} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
        <ListingGallery images={images.map((u) => `${api.defaults.baseURL}${u}`)} alt={listing.name} />

        <div>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="rounded-full bg-tertiary-accent/10 px-3 py-1 text-[11.5px] font-bold text-tertiary-accent">
              Venta rápida · Publicado por {listing.owner?.name ?? "un cliente"}
            </span>
            {conditionLabel(listing.condition) && <span className="rounded-full bg-secondary-container/30 px-3 py-1 text-[11.5px] font-bold text-on-secondary-container">{conditionLabel(listing.condition)}</span>}
            {listing.quantity > 1 && <span className="rounded-full bg-surface-container px-3 py-1 text-[11.5px] font-bold text-on-surface-variant">{listing.quantity} disponibles</span>}
          </div>
          <h1 className="mb-2 text-headline-md text-on-surface">{listing.name}</h1>
          <div className="mb-1 text-title-lg font-bold text-secondary">
            {formatPrice(listing.price, listing.currency)}
            {(listing.quantity > 1 || tiers.length > 0) && <span className="ml-1.5 text-[13px] font-semibold text-outline">por unidad</span>}
          </div>
          {tiers.length > 0 && (
            <ul className="mb-4 mt-2 flex flex-col gap-1.5 rounded-xl bg-surface-container/60 p-3 text-[13px] text-on-surface">
              {tiers.map((t) => (
                <li key={t.minQty} className="flex justify-between gap-3">
                  <span>Desde {t.minQty} unidades</span>
                  <span className="font-bold">{formatPrice(t.price, listing.currency)} c/u</span>
                </li>
              ))}
            </ul>
          )}
          {(listing.location?.province || listing.locationNote) && (
            <p className="mb-3 mt-3 flex items-start gap-1.5 text-[13px] text-on-surface-variant">
              <MapPin className="mt-0.5 h-4 w-4 flex-shrink-0" aria-hidden="true" />
              <span>
                <strong className="text-on-surface">{[listing.locationNote, listing.location?.municipality, listing.location?.province, listing.location?.country].filter(Boolean).join(", ")}</strong>
              </span>
            </p>
          )}
          <p className="mb-4 whitespace-pre-line text-body-md text-on-surface-variant">{listing.description}</p>
          {listing.tags?.length > 0 && (
            <div className="mb-6 flex flex-wrap gap-1.5">
              {listing.tags.map((t) => (
                <Link key={t} to={`/ventas-rapidas?q=${encodeURIComponent(t)}`} className="inline-flex min-h-8 items-center rounded-full bg-surface-container px-3 text-[12px] font-semibold text-on-surface-variant hover:bg-surface-container-high">
                  #{t}
                </Link>
              ))}
            </div>
          )}

          {/* Las ventas van directo con quien publicó el anuncio: WhatsApp o llamada al teléfono que dejó. */}
          <div className="rounded-2xl border border-surface-container-high bg-surface-container-lowest p-4">
            <div className="text-[12px] font-bold uppercase tracking-wide text-outline">Contacta a quien lo vende</div>
            <div className="mt-1 text-[15px] font-bold text-on-surface">{listing.owner?.name ?? "Cliente de " + siteName}</div>
            {listing.owner?.phone && <div className="mt-0.5 flex items-center gap-1.5 text-[14px] text-on-surface-variant"><Phone className="h-4 w-4" aria-hidden="true" /> {listing.owner.phone}</div>}
            <div className="mt-3 grid grid-cols-1 gap-2.5 sm:grid-cols-2">
              <a
                href={waLink(listing.owner.phone, message)}
                onClick={() => api.post(`/customer-listings/${listing.id}/contact-click`).catch(() => {})}
                target="_blank"
                rel="noreferrer"
                className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl bg-[#25D366] px-5 text-label-md font-bold text-primary shadow-md transition-all hover:brightness-95"
              >
                <MessageCircle className="h-[18px] w-[18px]" />
                Pedir por WhatsApp
              </a>
              <a href={`tel:${String(listing.owner.phone).replace(/[^\d+]/g, "")}`} className="inline-flex min-h-12 items-center justify-center gap-2 rounded-xl border border-outline-variant px-5 text-label-md font-bold text-on-surface hover:bg-surface-container">
                <Phone className="h-[18px] w-[18px]" />
                Llamar
              </a>
            </div>
          </div>

          {/* Reportar: cualquier cuenta con sesión (el servidor no deja reportar lo propio). Botón discreto, a pedido del dueño. */}
          {user && (
            <button onClick={() => setReportFraudOpen(true)} className="mt-4 inline-flex min-h-11 items-center gap-1.5 rounded-xl border border-outline-variant px-4 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container">
              <ShieldAlert className="h-4 w-4" aria-hidden="true" /> Reportar esta venta rápida
            </button>
          )}
        </div>
      </div>

      <ReportFraudModal
        open={reportFraudOpen}
        onClose={() => setReportFraudOpen(false)}
        targetField="customerListingId"
        targetId={listing.id}
        targetLabel={`la venta rápida "${listing.name}"`}
      />
    </div>
  );
}
