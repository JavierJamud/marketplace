import { useState } from "react";
import { Link } from "react-router-dom";
import { useQuery, useMutation } from "@tanstack/react-query";
import toast from "../../lib/toast.jsx";
import { Minus, Plus, Trash2, ShoppingBag, Tag, X, ImageOff } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice, formatMixedTotal } from "../../lib/format.js";
import { useCart } from "../../context/CartContext.jsx";
import { resolveUnitPrice, calcSavings } from "../../lib/pricing.js";
import { VerifiedBadge } from "../../components/ui/VerifiedBadge.jsx";
import { ConfirmDeleteModal } from "../../components/ConfirmDeleteModal.jsx";
import { ShareCartButton } from "../../components/ShareCartButton.jsx";

// Bloque 147: mismo patrón que CartDrawer.jsx/ProductCard.jsx/SharedCart.jsx.
function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

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
  const { items, vendorId, vendorName, vendorSlug, vendorColor, vendorVerified, updateQuantity, removeItem, clearCart, discount, setDiscount, clearDiscount } = useCart();
  const [itemToRemove, setItemToRemove] = useState(null);
  const [confirmingClear, setConfirmingClear] = useState(false);
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
  // Bloque 68 (pedido explícito): el destino elegido por la tienda decide
  // el texto de ayuda bajo el botón, para que el cliente sepa qué esperar
  // después de confirmar (ver Checkout.jsx, que arma el mensaje real de
  // WhatsApp recién con los datos ya completos). Bloque 231: ya NO decide
  // el color/ícono del botón — ver el comentario junto al <Link> de abajo.
  const orderDestination = vendor?.orderDestination ?? "WHATSAPP";

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
        <div className="flex flex-wrap items-center gap-2">
          <ShareCartButton className="flex items-center gap-1.5 rounded-md border border-outline-variant px-3.5 py-2 text-[12.5px] font-semibold text-on-surface-variant hover:bg-surface-container disabled:opacity-50" />
          {/* Bloque 147 (pedido explícito): mismo `clearCart()` que ya existía
              en CartContext.jsx (usado por el bot de tienda al pedir "vaciá
              el carrito" por chat) — acá se suma un botón real y visible.
              Bloque 148 (pedido explícito — "contenedor transparente, con
              borde fino de un color redondeado"): mismo criterio de píldora
              que `CartDrawer.jsx` — fondo transparente, borde fino en el
              mismo color que el texto (antes un borde gris neutro, igual
              al de "Compartir", que no comunicaba que era una acción
              destructiva distinta). */}
          <button
            type="button"
            onClick={() => setConfirmingClear(true)}
            className="flex flex-shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-error/35 px-3.5 py-2 text-[12.5px] font-bold text-error transition-colors hover:bg-error/10"
          >
            <Trash2 className="h-3.5 w-3.5" /> Vaciar carrito
          </button>
        </div>
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
              // Bloque 147 (bug real reportado en vivo, con captura — sin
              // fotos y sin clic a la ficha del producto): un ítem viejo ya
              // persistido en localStorage puede no tener `slug` todavía —
              // se degrada a texto/imagen sin clic en vez de armar un link roto.
              const productHref = it.slug && vendorSlug ? `/producto/${vendorSlug}/${it.slug}` : null;
              const thumb = (
                <div className="flex h-16 w-16 flex-shrink-0 items-center justify-center overflow-hidden rounded-md bg-surface-container">
                  {it.image ? (
                    <img src={imgUrl(it.image)} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <ImageOff className="h-5 w-5 text-outline/50" />
                  )}
                </div>
              );
              return (
                <div key={`${it.productId}-${it.size ?? ""}`} className="flex flex-wrap items-center gap-3.5 border-b border-surface-container px-[18px] py-4 last:border-b-0">
                  {productHref ? <Link to={productHref}>{thumb}</Link> : thumb}
                  <div className="min-w-[140px] flex-1">
                    <div className="flex items-center gap-1.5 text-body-md font-semibold text-on-surface">
                      {productHref ? (
                        <Link to={productHref} className="hover:underline">
                          {it.name}
                        </Link>
                      ) : (
                        it.name
                      )}
                      {it.size && (
                        <span className="rounded-full bg-surface-container px-2 py-0.5 text-[11px] font-bold text-on-surface-variant">Talla {it.size}</span>
                      )}
                    </div>
                    <div className="mt-0.5 text-[12.5px] text-outline">{formatPrice(unitPrice, it.currency)} c/u</div>
                    {savings > 0 && (
                      <div className="mt-0.5 text-[11.5px] font-semibold text-tertiary-accent">Ahorras {formatPrice(savings, it.currency)} por mayoreo</div>
                    )}
                  </div>
                  <div className="flex w-full items-center justify-between gap-3.5 sm:w-auto sm:justify-end">
                    <div className="flex items-center rounded border border-outline-variant">
                      {/* Bloque 215 (pedido explícito, con Amazon de
                          referencia): antes esto SIEMPRE era "-" (clampeado
                          a un mínimo de 1, nunca sacaba el producto del
                          carrito) y el bote de basura vivía aparte, junto al
                          precio — quedaban 2 formas de "borrar" y una de
                          ellas parecía rota (bajaba y se quedaba pegado en
                          1). Con 1 sola unidad, este mismo botón pasa a ser
                          la papelera (misma confirmación de siempre, ver
                          setItemToRemove/ConfirmDeleteModal más abajo); con
                          2+ vuelve a ser el "-" de siempre. */}
                      {it.quantity <= 1 ? (
                        <button onClick={() => setItemToRemove(it)} title="Eliminar del carrito" className="flex h-9 w-8 items-center justify-center text-error">
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      ) : (
                        <button onClick={() => updateQuantity(it.productId, it.quantity - 1, it.size)} className="flex h-9 w-8 items-center justify-center text-on-surface">
                          <Minus className="h-3.5 w-3.5" />
                        </button>
                      )}
                      {/* min-w en vez de w fijo (Bloque 143): un producto
                          "disponible siempre" no tiene techo de cantidad —
                          un número de varios dígitos no debe romper el
                          layout (mismo criterio ya aplicado en
                          CartDrawer.jsx). */}
                      <div className="min-w-[34px] px-1 text-center text-body-md font-semibold">{it.quantity}</div>
                      <button onClick={() => updateQuantity(it.productId, it.quantity + 1, it.size)} className="flex h-9 w-8 items-center justify-center text-on-surface">
                        <Plus className="h-3.5 w-3.5" />
                      </button>
                    </div>
                    <div className="flex items-center gap-1">
                      <div className="min-w-20 flex-shrink-0 text-right text-body-md font-bold text-on-surface sm:min-w-24">{formatPrice(unitPrice * it.quantity, it.currency)}</div>
                    </div>
                  </div>
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
          {/* Bloque 231 (pedido explícito — mismo cambio que CartDrawer.jsx:
              siempre navy de marca + ícono de compra, nunca el verde de
              WhatsApp — el checkout es una pantalla de este sitio, no de
              WhatsApp). */}
          <Link
            to="/checkout"
            className="flex h-12 items-center justify-center gap-2 rounded bg-primary text-label-md font-bold text-white hover:brightness-110"
          >
            <ShoppingBag className="h-[18px] w-[18px]" />
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

      {confirmingClear && (
        <ConfirmDeleteModal
          title="¿Vaciar el carrito?"
          description="Se van a sacar todos los productos que agregaste."
          confirmLabel="Vaciar carrito"
          onConfirm={() => {
            clearCart();
            setConfirmingClear(false);
          }}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </div>
  );
}
