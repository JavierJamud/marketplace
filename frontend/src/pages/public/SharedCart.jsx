import { useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { PackageSearch, CheckCircle2, ShoppingBag, AlertTriangle } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice } from "../../lib/format.js";
import { useCart } from "../../context/CartContext.jsx";
import { EmptyState } from "../../components/ui/EmptyState.jsx";
import { ConfirmModal } from "../../components/ConfirmModal.jsx";

function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

function vendorMetaFrom(vendor) {
  return {
    vendorId: vendor.id,
    vendorName: vendor.companyName,
    vendorSlug: vendor.slug,
    vendorColor: vendor.color,
    vendorVerified: vendor.isVerified,
    vendorWhatsapp: vendor.whatsapp,
  };
}

// Bloque 54: página que abre alguien que recibió un link de "Compartir
// carrito" (ver ShareCartButton.jsx). Los productos se resuelven contra el
// catálogo REAL en el backend (getSharedCart) — acá solo se decide cómo
// incorporarlos al carrito de QUIEN ABRE el link: si su carrito está vacío
// o es de la misma tienda, se agregan directo; si tiene productos de OTRA
// tienda, se pide confirmación antes de reemplazar (mismo criterio de "un
// solo vendedor por carrito" que rige en todo el sitio).
export default function SharedCart() {
  const { id } = useParams();
  const { vendorId: myVendorId, vendorName: myVendorName, items: myItems, replaceCart, mergeItems } = useCart();
  const [committed, setCommitted] = useState(false);
  const [needsConfirm, setNeedsConfirm] = useState(false);
  const [cancelled, setCancelled] = useState(false);
  const [revealCount, setRevealCount] = useState(0);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["shared-cart", id],
    queryFn: async () => (await api.get(`/shared-carts/${id}`)).data,
    retry: false,
  });

  function commit() {
    if (!myVendorId || myVendorId === data.vendor.id) {
      if (!myVendorId) replaceCart(vendorMetaFrom(data.vendor), data.items);
      else mergeItems(data.items);
    } else {
      replaceCart(vendorMetaFrom(data.vendor), data.items);
    }
    setNeedsConfirm(false);
    setCommitted(true);
  }

  useEffect(() => {
    if (!data || committed) return;
    const differentVendor = myVendorId && myVendorId !== data.vendor.id && myItems.length > 0;
    if (differentVendor) {
      setNeedsConfirm(true);
      return;
    }
    commit();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

  // Animación puramente cosmética — el carrito ya se actualizó de verdad
  // apenas se confirma (arriba); esto solo va revelando las tarjetas una por
  // una para que se sienta como "importando" en vez de aparecer todo junto.
  useEffect(() => {
    if (!committed || !data) return;
    setRevealCount(0);
    const timers = data.items.map((_, i) => setTimeout(() => setRevealCount((c) => c + 1), 220 * (i + 1)));
    return () => timers.forEach(clearTimeout);
  }, [committed, data]);

  if (isLoading) {
    return (
      <div className="container-app flex min-h-[60vh] flex-col items-center justify-center gap-4 py-14 text-center">
        <div className="h-10 w-10 animate-spin rounded-full border-[3px] border-tertiary-accent/25 border-t-tertiary-accent" />
        <p className="text-body-md text-on-surface-variant">Cargando el carrito compartido...</p>
      </div>
    );
  }

  if (isError || !data) {
    return (
      <div className="container-app py-14">
        <EmptyState
          icon={PackageSearch}
          title="Este carrito compartido ya no existe"
          description="El enlace puede haber vencido o la tienda ya no está disponible."
          action={
            <Link to="/catalogo" className="rounded bg-primary-container px-5 py-2.5 text-label-md font-bold text-white hover:brightness-95">
              Ir al catálogo →
            </Link>
          }
        />
      </div>
    );
  }

  return (
    <div className="container-app max-w-[640px] py-14">
      <div className="mb-2 flex items-center gap-2">
        <ShoppingBag className="h-5 w-5 text-tertiary-accent" />
        <p className="text-label-sm font-semibold uppercase tracking-wide text-tertiary-accent">Carrito compartido</p>
      </div>
      <h1 className="mb-2 font-display text-headline-lg-mobile text-on-surface md:text-headline-lg">{data.vendor.companyName}</h1>
      <p className="mb-8 text-body-md text-on-surface-variant">
        {committed ? "Estos productos ya se agregaron a tu carrito:" : "Alguien compartió este carrito contigo."}
      </p>

      {data.droppedCount > 0 && (
        <div className="mb-5 flex items-start gap-2.5 rounded-lg bg-[#8a5100]/[0.08] p-3.5 text-[12.5px] text-[#8a5100]">
          <AlertTriangle className="mt-0.5 h-4 w-4 flex-shrink-0" />
          {data.droppedCount === 1
            ? "Un producto de este carrito ya no está disponible y no se incluyó."
            : `${data.droppedCount} productos de este carrito ya no están disponibles y no se incluyeron.`}
        </div>
      )}

      {cancelled ? (
        <EmptyState
          icon={ShoppingBag}
          title="No se agregó nada a tu carrito"
          description={`Tu carrito con productos de ${myVendorName} sigue igual que antes.`}
          action={
            <Link to="/carrito" className="rounded bg-primary-container px-5 py-2.5 text-label-md font-bold text-white hover:brightness-95">
              Ver mi carrito →
            </Link>
          }
        />
      ) : data.items.length === 0 ? (
        <EmptyState icon={PackageSearch} title="Ningún producto de este carrito sigue disponible" description="Puede que se hayan agotado o que la tienda los haya dado de baja." />
      ) : (
        <div className="flex flex-col gap-3">
          {data.items.map((item, i) => (
            <div
              key={`${item.productId}-${item.size ?? ""}`}
              className={`flex items-center gap-3.5 rounded-lg border border-surface-container-high bg-surface-container-lowest p-4 transition-all duration-500 ${
                committed && i < revealCount ? "translate-y-0 opacity-100" : "translate-y-2 opacity-0"
              }`}
            >
              <div className="h-14 w-14 flex-shrink-0 overflow-hidden rounded-md bg-surface-container">
                {item.image && <img src={imgUrl(item.image)} alt="" className="h-full w-full object-cover" />}
              </div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center gap-1.5 truncate text-body-sm font-semibold text-on-surface">
                  {item.name}
                  {item.size && (
                    <span className="flex-shrink-0 rounded-full bg-surface-container px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant">
                      Talla {item.size}
                    </span>
                  )}
                </div>
                <div className="text-[12.5px] text-outline">
                  {item.quantity} × {formatPrice(item.price, item.currency)}
                </div>
              </div>
              {committed && i < revealCount && <CheckCircle2 className="h-5 w-5 flex-shrink-0 text-verified" />}
            </div>
          ))}
        </div>
      )}

      {committed && (
        <Link
          to="/carrito"
          className="mt-8 flex h-12 items-center justify-center rounded bg-primary-container text-label-md font-bold text-white hover:brightness-95"
        >
          Ver mi carrito
        </Link>
      )}

      <ConfirmModal
        open={needsConfirm}
        title="¿Reemplazar tu carrito?"
        message={`Tu carrito actual tiene productos de ${myVendorName} — para agregar los de ${data.vendor.companyName} hay que reemplazarlo (un carrito solo puede tener productos de una tienda a la vez).`}
        confirmLabel="Sí, reemplazar"
        confirmDisabled={false}
        onConfirm={commit}
        onCancel={() => {
          setNeedsConfirm(false);
          setCancelled(true);
        }}
      />
    </div>
  );
}
