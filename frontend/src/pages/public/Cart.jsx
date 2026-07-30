import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "react-hot-toast";
import { Minus, Plus, Trash2, MessageCircle, Tag, X } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice, formatMixedTotal } from "../../lib/format.js";
import { useCart } from "../../context/CartContext.jsx";
import { resolveUnitPrice, calcSavings } from "../../lib/pricing.js";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ShareCartButton } from "../../components/ShareCartButton.jsx";

// Bloque 52: solo tiene sentido si TODOS los ítems del carrito están en la
// misma moneda (el carrito ya es de un solo vendedor, pero un vendedor puede
// cargar productos en distintas monedas — ver Product.currency) — con
// monedas mezcladas no hay forma honesta de aplicar un descuento en CUP
// sobre un total que no es un número único, así que el campo se oculta.
function singleCurrencySubtotal(items) {
  const currencies = new Set(items.map((i) => i.currency ?? "CUP"));
  if (currencies.size > 1) return null;
  return items.reduce((sum, i) => sum + resolveUnitPrice(i.price, i.priceTiers, i.quantity) * i.quantity, 0);
}

export default function Cart() {
  const { items, vendorId, vendorName, vendorSlug, vendorColor, vendorVerified, updateQuantity, removeItem, discount, setDiscount, clearDiscount } = useCart();
  const [itemToRemove, setItemToRemove] = useState(null);
  const [codeInput, setCodeInput] = useState("");
  const subtotal = singleCurrencySubtotal(items);

  const applyDiscount = useMutation({
    mutationFn: async () =>
      (await api.post("/discount-codes/validate", { vendorId, code: codeInput.trim(), subtotal })).data,
    onSuccess: ({ discount: applied }) => {
      setDiscount(applied);
      setCodeInput("");
      toast.success(`Código "${applied.code}" aplicado — descuento de ${formatPrice(applied.amount)}.`);
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo aplicar el código."),
  });

  const { data: vendor } = useQuery({
    queryKey: ["vendor", vendorSlug],
    queryFn: async () => (await api.get(`/vendors/${vendorSlug}`)).data.vendor,
    enabled: !!vendorSlug,
  });

  const location = vendor?.locations?.[0];
  const locationLabel = location ? `${location.municipality?.name ?? ""}, ${location.province?.name}` : "";
  const color = vendor?.color ?? vendorColor ?? "#232F3E";
  const isVerified = vendor?.isVerified ?? vendorVerified;
  // Bloque 68 (pedido explícito): el destino elegido por la tienda ya NO
  // decide si se salta el formulario (siempre se pasa por /checkout) — solo
  // cambia el color/label del botón, para que el cliente sepa qué esperar
  // después de confirmar (ver Checkout.jsx, que arma el mensaje real de
  // WhatsApp recién con los datos ya completos).
  const orderDestination = vendor?.orderDestination ?? "WHATSAPP";
  const emphasizeWhatsapp = orderDestination !== "PANEL";

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

  return (
    <div className="container-app max-w-[1080px] py-9">
      <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
        <h1 className="font-display text-headline-lg text-on-surface">Tu carrito</h1>
        <ShareCartButton className="flex items-center gap-1.5 rounded-md border border-outline-variant px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50" />
      </div>

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
            {items.map((it) => {
              const unitPrice = resolveUnitPrice(it.price, it.priceTiers, it.quantity);
              const savings = calcSavings(it.price, it.priceTiers, it.quantity);
              return (
                <div key={`${it.productId}-${it.size ?? ""}`} className="flex items-center gap-3.5 border-b border-surface-container px-[18px] py-4 last:border-b-0">
                  <div className="h-16 w-16 flex-shrink-0 rounded-md bg-surface-container" />
                  <div className="flex-1">
                    <div className="flex items-center gap-1.5 text-body-md font-semibold text-on-surface">
                      {it.name}
                      {it.size && (
                        <span className="rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-bold text-on-surface-variant">Talla {it.size}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-outline">{formatPrice(unitPrice, it.currency)} c/u</div>
                    {savings > 0 && (
                      <div className="mt-0.5 text-[11.5px] font-semibold text-tertiary-accent">Ahorras {formatPrice(savings, it.currency)} por mayoreo</div>
                    )}
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
                  <div className="w-24 flex-shrink-0 text-right text-body-md font-bold text-on-surface">{formatPrice(unitPrice * it.quantity, it.currency)}</div>
                  <button onClick={() => setItemToRemove(it)} className="p-1.5 text-error">
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              );
            })}
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

          {/* Bloque 52: código de descuento — solo con un subtotal de una
              sola moneda (ver singleCurrencySubtotal), aplica solo a los
              productos de esta tienda (el carrito ya es de un solo vendedor). */}
          {subtotal != null &&
            (discount ? (
              <div className="mb-2.5 flex items-center justify-between rounded-md bg-verified/10 px-3 py-2 text-[12.5px] font-semibold text-verified-dark">
                <span className="flex items-center gap-1.5">
                  <Tag className="h-3.5 w-3.5" /> {discount.code} aplicado (-{formatPrice(discount.amount)})
                </span>
                <button onClick={clearDiscount} className="rounded-full p-1 hover:bg-verified/15" title="Quitar código">
                  <X className="h-3.5 w-3.5" />
                </button>
              </div>
            ) : (
              <div className="mb-2.5 flex gap-2">
                <input
                  value={codeInput}
                  onChange={(e) => setCodeInput(e.target.value.toUpperCase())}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") {
                      e.preventDefault();
                      if (codeInput.trim()) applyDiscount.mutate();
                    }
                  }}
                  placeholder="Código de descuento"
                  className="h-10 flex-1 rounded border border-outline-variant bg-surface-container-lowest px-3 text-[13px] outline-none focus:border-tertiary-accent"
                />
                <button
                  onClick={() => applyDiscount.mutate()}
                  disabled={!codeInput.trim() || applyDiscount.isPending}
                  className="flex-shrink-0 rounded-md border border-outline-variant px-3.5 text-[12.5px] font-bold text-on-surface-variant hover:bg-surface-container disabled:opacity-50"
                >
                  {applyDiscount.isPending ? "..." : "Aplicar"}
                </button>
              </div>
            ))}

          {discount && (
            <div className="mb-2.5 flex justify-between text-[13.5px] font-semibold text-verified-dark">
              <span>Descuento ({vendorName})</span>
              <span>-{formatPrice(discount.amount)}</span>
            </div>
          )}

          <div className="mb-[18px] flex justify-between border-t border-surface-container-high pt-3 text-title-lg font-bold text-on-surface">
            <span>Total</span>
            <span>{discount && subtotal != null ? formatPrice(Math.max(0, subtotal - discount.amount)) : formatMixedTotal(items)}</span>
          </div>
          <Link
            to="/checkout"
            className={`flex h-12 items-center justify-center gap-2 rounded text-label-md font-bold text-white ${
              emphasizeWhatsapp ? "bg-[#25D366]" : "bg-primary-container"
            }`}
          >
            {emphasizeWhatsapp && <MessageCircle className="h-[18px] w-[18px]" />}
            Completar pedido
          </Link>
          <p className="mt-3.5 text-center text-[11.5px] leading-4 text-outline">
            {orderDestination === "PANEL"
              ? "Esta tienda gestiona sus pedidos desde su panel. Completa tus datos y te contactarán para coordinar."
              : orderDestination === "BOTH"
              ? "Completa tus datos — la tienda recibe tu pedido en su panel y también te puede coordinar por WhatsApp."
              : `Completa tus datos — al confirmar te ofrecemos mandarle el pedido a ${vendorName} por WhatsApp.`}
          </p>
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
