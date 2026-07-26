import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { Minus, Plus, Trash2, MessageCircle } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice, formatMixedTotal } from "../../lib/format.js";
import { usePlatformSettings } from "../../lib/usePlatformSettings.js";
import { useCart } from "../../context/CartContext.jsx";
import { waLink } from "../../lib/whatsapp.js";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";

export default function Cart() {
  const { siteName } = usePlatformSettings();
  const { items, vendorName, vendorSlug, vendorColor, vendorVerified, vendorWhatsapp, updateQuantity, removeItem } = useCart();
  const [itemToRemove, setItemToRemove] = useState(null);

  const { data: vendor } = useQuery({
    queryKey: ["vendor", vendorSlug],
    queryFn: async () => (await api.get(`/vendors/${vendorSlug}`)).data.vendor,
    enabled: !!vendorSlug,
  });

  const location = vendor?.locations?.[0];
  const locationLabel = location ? `${location.municipality?.name ?? ""}, ${location.province?.name}` : "";
  const color = vendor?.color ?? vendorColor ?? "#232F3E";
  const isVerified = vendor?.isVerified ?? vendorVerified;
  const whatsapp = vendor?.whatsapp ?? vendorWhatsapp;
  // El vendedor elige en su configuración si sus pedidos van directo a
  // WhatsApp o a su panel — se muestra un solo atajo, no los dos a la vez.
  const wantsPanel = vendor?.orderDestination === "PANEL";

  if (items.length === 0) {
    return (
      <div className="container-app max-w-[1080px] py-9">
        <h1 className="mb-6 font-display text-headline-lg text-on-surface">Tu carrito</h1>
        <div className="mx-auto max-w-[480px] rounded-lg border border-surface-container-high bg-surface-container-lowest py-16 text-center">
          <div className="mb-3.5 text-4xl">🛒</div>
          <div className="mb-1.5 text-title-lg font-bold text-on-surface">Tu carrito está vacío</div>
          <p className="mb-5 text-[13.5px] text-outline">Explora el catálogo de tu provincia y agrega productos.</p>
          <Link to="/catalogo" className="inline-block rounded bg-secondary-container px-6 py-3 text-label-md font-bold text-on-secondary-container">
            Ir al catálogo
          </Link>
        </div>
      </div>
    );
  }

  const waText = `Hola ${vendorName}, quiero pedir:\n${items
    .map((i) => `• ${i.quantity}× ${i.name}${i.size ? ` (talla ${i.size})` : ""}`)
    .join("\n")}\nTotal aprox: ${formatMixedTotal(items)}`;

  return (
    <div className="container-app max-w-[1080px] py-9">
      <h1 className="mb-6 font-display text-headline-lg text-on-surface">Tu carrito</h1>

      <div className="grid grid-cols-1 gap-7 lg:grid-cols-[1fr_340px] lg:items-start">
        <div>
          {/* Vendedor */}
          <div className="mb-3.5 flex items-center gap-2.5 rounded-md border border-surface-container-high bg-surface-container-lowest px-[18px] py-3.5">
            <div
              className="flex h-[38px] w-[38px] flex-shrink-0 items-center justify-center rounded-full font-display text-[15px] font-bold text-white"
              style={{ background: color }}
            >
              {vendorName?.[0]}
            </div>
            <div className="flex-1">
              <div className="text-label-md font-bold text-on-surface">{vendorName}</div>
              <div className="text-[12px] text-outline">Pedido a esta tienda{locationLabel ? ` · ${locationLabel}` : ""}</div>
            </div>
            {isVerified && <VerifiedBadge size="sm" />}
          </div>

          <div className="overflow-hidden rounded-md border border-surface-container-high bg-surface-container-lowest">
            {items.map((it) => (
              <div key={`${it.productId}-${it.size ?? ""}`} className="flex items-center gap-3.5 border-b border-surface-container px-[18px] py-4 last:border-b-0">
                <div className="h-16 w-16 flex-shrink-0 rounded-md bg-surface-container" />
                <div className="flex-1">
                  <div className="flex items-center gap-1.5 text-body-md font-semibold text-on-surface">
                    {it.name}
                    {it.size && (
                      <span className="rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-bold text-on-surface-variant">Talla {it.size}</span>
                    )}
                  </div>
                  <div className="mt-0.5 text-[12.5px] text-outline">{formatPrice(it.price, it.currency)} c/u</div>
                </div>
                <div className="flex items-center rounded border border-outline-variant">
                  <button onClick={() => updateQuantity(it.productId, Math.max(1, it.quantity - 1), it.size)} className="flex h-9 w-8 items-center justify-center text-on-surface">
                    <Minus className="h-3.5 w-3.5" />
                  </button>
                  <div className="w-[34px] text-center text-body-md font-semibold">{it.quantity}</div>
                  <button onClick={() => updateQuantity(it.productId, it.quantity + 1, it.size)} className="flex h-9 w-8 items-center justify-center text-on-surface">
                    <Plus className="h-3.5 w-3.5" />
                  </button>
                </div>
                <div className="w-24 flex-shrink-0 text-right text-body-md font-bold text-on-surface">{formatPrice(it.price * it.quantity, it.currency)}</div>
                <button onClick={() => setItemToRemove(it)} className="p-1.5 text-error">
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            ))}
          </div>
        </div>

        {/* RESUMEN */}
        <div className="rounded-lg border border-surface-container-high bg-surface-container-lowest p-[22px] lg:sticky lg:top-6">
          <div className="mb-4 font-display text-title-lg text-on-surface">Resumen del pedido</div>
          <div className="mb-2.5 flex justify-between text-[13.5px] text-on-surface-variant">
            <span>Subtotal</span>
            <span>{formatMixedTotal(items)}</span>
          </div>
          <div className="mb-2.5 flex justify-between text-[13.5px] text-on-surface-variant">
            <span>Envío</span>
            <span className="text-tertiary-accent">A coordinar</span>
          </div>
          <div className="mb-[18px] flex justify-between border-t border-surface-container-high pt-3 text-title-lg font-bold text-on-surface">
            <span>Total</span>
            <span>{formatMixedTotal(items)}</span>
          </div>
          {wantsPanel ? (
            <>
              <Link to="/checkout" className="flex h-12 items-center justify-center rounded bg-primary-container text-label-md font-bold text-white">
                Completar pedido
              </Link>
              <p className="mt-3.5 text-center text-[11.5px] leading-4 text-outline">
                Esta tienda gestiona sus pedidos desde su panel. Completa tus datos y te contactarán para coordinar.
              </p>
            </>
          ) : (
            <>
              {whatsapp && (
                <a
                  href={waLink(whatsapp, waText)}
                  target="_blank"
                  rel="noreferrer"
                  className="mb-2.5 flex h-12 items-center justify-center gap-2 rounded bg-[#25D366] text-label-md font-bold text-white"
                >
                  <MessageCircle className="h-[18px] w-[18px]" /> Pedir por WhatsApp
                </a>
              )}
              <Link to="/checkout" className="flex h-[46px] items-center justify-center rounded bg-primary-container text-label-md font-bold text-white">
                Checkout con dirección
              </Link>
              <p className="mt-3.5 text-center text-[11.5px] leading-4 text-outline">
                No se cobra nada en {siteName} — coordinas el pago directo con el vendedor (contra entrega, en línea o efectivo).
              </p>
            </>
          )}
        </div>
      </div>

      {itemToRemove && (
        <ConfirmDeleteModal
          title={`¿Eliminar "${itemToRemove.name}"?`}
          description="Se va a sacar por completo del carrito."
          confirmLabel="Eliminar"
          onConfirm={() => {
            removeItem(itemToRemove.productId, itemToRemove.size);
            setItemToRemove(null);
          }}
          onCancel={() => setItemToRemove(null)}
        />
      )}
    </div>
  );
}
