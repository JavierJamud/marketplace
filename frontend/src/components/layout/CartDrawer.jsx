import { useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { X, Minus, Plus, Trash2, MessageCircle, ShoppingBag, Tag } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice, formatMixedTotal } from "../../lib/format.js";
import { useCart } from "../../context/CartContext.jsx";
import { waLink } from "../../lib/whatsapp.js";
import { VerifiedBadge } from "../ui/VerifiedBadge.jsx";
import { ShareCartButton } from "../ShareCartButton.jsx";

// Mini-carrito: se abre encima de la página actual desde el ícono del
// Header (sin navegar) — solo "Completar pedido"/"Checkout con dirección"
// cambia de página. Mismo contenido/lógica que Cart.jsx (página completa),
// condensado para un panel lateral; /carrito sigue existiendo aparte para
// quien llegue por link directo.
export function CartDrawer() {
  const {
    items,
    vendorName,
    vendorSlug,
    vendorColor,
    vendorVerified,
    vendorWhatsapp,
    updateQuantity,
    removeItem,
    isDrawerOpen,
    closeCart,
    discount,
  } = useCart();

  const { data: vendor } = useQuery({
    queryKey: ["vendor", vendorSlug],
    queryFn: async () => (await api.get(`/vendors/${vendorSlug}`)).data.vendor,
    enabled: !!vendorSlug && isDrawerOpen,
  });

  useEffect(() => {
    if (!isDrawerOpen) return;
    function onKey(e) {
      if (e.key === "Escape") closeCart();
    }
    document.addEventListener("keydown", onKey);
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = "";
    };
  }, [isDrawerOpen, closeCart]);

  const isVerified = vendor?.isVerified ?? vendorVerified;
  const whatsapp = vendor?.whatsapp ?? vendorWhatsapp;
  const wantsPanel = vendor?.orderDestination === "PANEL";
  const count = items.reduce((a, i) => a + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);

  const waText = `Hola ${vendorName}, quiero pedir:\n${items
    .map((i) => `• ${i.quantity}× ${i.name}${i.size ? ` (talla ${i.size})` : ""}`)
    .join("\n")}\nTotal aprox: ${formatMixedTotal(items)}`;

  return (
    <>
      {/* Backdrop — vidrio esmerilado, más moderno que un negro plano */}
      <div
        onClick={closeCart}
        className={`fixed inset-0 z-[60] bg-inverse-surface/30 backdrop-blur-[3px] transition-opacity duration-300 ${
          isDrawerOpen ? "pointer-events-auto opacity-100" : "pointer-events-none opacity-0"
        }`}
      />

      {/* Panel — tarjeta flotante separada de los 4 bordes (no un drawer a
          ras de pantalla), esquinas redondeadas y transición ease-out-expo
          (traslado + fade + leve escala) para una sensación más "moderna"
          que un simple slide lineal. */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Carrito de compras"
        aria-hidden={!isDrawerOpen}
        className={`fixed inset-y-3 right-3 left-3 z-[61] flex origin-right flex-col overflow-hidden rounded-[28px] bg-surface-container-lowest shadow-[0_24px_70px_-12px_rgba(20,20,30,0.35)] ring-1 ring-black/[0.04] transition-all duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)] sm:inset-y-4 sm:left-auto sm:right-4 sm:w-full sm:max-w-[400px] ${
          isDrawerOpen
            ? "pointer-events-auto translate-x-0 scale-100 opacity-100"
            : "pointer-events-none translate-x-8 scale-[0.97] opacity-0 sm:translate-x-6"
        }`}
      >
        <div className="flex items-center justify-between bg-surface-container/60 px-5 py-4">
          <h2 className="flex items-center gap-2 font-display text-title-lg text-on-surface">
            <ShoppingBag className="h-5 w-5 text-tertiary-accent" />
            Tu carrito {count > 0 && <span className="text-label-sm font-semibold text-outline">({count})</span>}
          </h2>
          <div className="flex items-center gap-1">
            {items.length > 0 && (
              <ShareCartButton
                iconOnly
                animated
                className="flex h-9 w-9 items-center justify-center rounded-full text-tertiary-accent transition-colors hover:bg-surface-container-high disabled:opacity-40"
              />
            )}
            <button
              onClick={closeCart}
              aria-label="Cerrar carrito"
              className="flex h-9 w-9 items-center justify-center rounded-full text-outline transition-colors hover:bg-surface-container-high hover:text-on-surface"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        </div>

        {items.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-3 px-6 text-center">
            <div className="flex h-16 w-16 items-center justify-center rounded-full bg-surface-container text-3xl">🛒</div>
            <div className="text-title-md font-bold text-on-surface">Tu carrito está vacío</div>
            <p className="text-body-sm text-on-surface-variant">Explora el catálogo y agrega productos.</p>
            <RouterLink
              to="/catalogo"
              onClick={closeCart}
              className="mt-2 rounded-xl bg-secondary-container px-5 py-2.5 text-label-md font-bold text-on-secondary-container transition-transform hover:scale-[1.02] hover:brightness-95"
            >
              Ir al catálogo
            </RouterLink>
          </div>
        ) : (
          <>
            {/* Vendedor */}
            <div className="flex items-center gap-2.5 px-5 py-3">
              <div
                className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full font-display text-[13px] font-bold text-white shadow-sm"
                style={{ background: vendorColor ?? "#232F3E" }}
              >
                {vendorName?.[0]}
              </div>
              <div className="min-w-0 flex-1">
                <div className="truncate text-label-sm font-bold text-on-surface">{vendorName}</div>
              </div>
              {isVerified && <VerifiedBadge size="sm" />}
            </div>

            {/* Ítems (scrollable) */}
            <div className="flex-1 overflow-y-auto px-4 py-1">
              <div className="flex flex-col gap-1.5">
                {items.map((it) => (
                  <div
                    key={`${it.productId}-${it.size ?? ""}`}
                    className="flex items-center gap-3 rounded-2xl p-2.5 transition-colors hover:bg-surface-container/60"
                  >
                    <div className="h-14 w-14 flex-shrink-0 rounded-xl bg-surface-container" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 truncate text-body-sm font-semibold text-on-surface">
                        {it.name}
                        {it.size && (
                          <span className="flex-shrink-0 rounded-full bg-surface-container px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant">
                            {it.size}
                          </span>
                        )}
                      </div>
                      <div className="mt-0.5 text-[11.5px] text-outline">{formatPrice(it.price, it.currency)} c/u</div>
                      <div className="mt-1.5 flex items-center gap-2">
                        <div className="flex items-center gap-0.5 rounded-full bg-surface-container p-0.5">
                          <button
                            onClick={() => updateQuantity(it.productId, Math.max(1, it.quantity - 1), it.size)}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface transition-colors hover:bg-surface-container-lowest"
                          >
                            <Minus className="h-3 w-3" />
                          </button>
                          <div className="w-6 text-center text-[12px] font-semibold">{it.quantity}</div>
                          <button
                            onClick={() => updateQuantity(it.productId, it.quantity + 1, it.size)}
                            className="flex h-6 w-6 items-center justify-center rounded-full text-on-surface transition-colors hover:bg-surface-container-lowest"
                          >
                            <Plus className="h-3 w-3" />
                          </button>
                        </div>
                        <button
                          onClick={() => removeItem(it.productId, it.size)}
                          className="flex h-6 w-6 items-center justify-center rounded-full text-error transition-colors hover:bg-error/10"
                        >
                          <Trash2 className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    </div>
                    <div className="flex-shrink-0 text-body-sm font-bold text-on-surface">{formatPrice(it.price * it.quantity, it.currency)}</div>
                  </div>
                ))}
              </div>
            </div>

            {/* Resumen + CTA */}
            <div className="bg-surface-container/60 px-5 py-4">
              {discount && (
                <div className="mb-2 flex items-center justify-between text-[12.5px] font-semibold text-verified-dark">
                  <span className="flex items-center gap-1">
                    <Tag className="h-3.5 w-3.5" /> {discount.code}
                  </span>
                  <span>-{formatPrice(discount.amount)}</span>
                </div>
              )}
              <div className="mb-3 flex justify-between text-title-md font-bold text-on-surface">
                <span>Total</span>
                <span>{discount ? formatPrice(Math.max(0, subtotal - discount.amount)) : formatMixedTotal(items)}</span>
              </div>

              {wantsPanel ? (
                <RouterLink
                  to="/checkout"
                  onClick={closeCart}
                  className="flex h-12 items-center justify-center rounded-xl bg-primary-container text-label-md font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg hover:brightness-95"
                >
                  Completar pedido
                </RouterLink>
              ) : (
                <>
                  {whatsapp && (
                    <a
                      href={waLink(whatsapp, waText)}
                      target="_blank"
                      rel="noreferrer"
                      className="mb-2 flex h-12 items-center justify-center gap-2 rounded-xl bg-[#25D366] text-label-md font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg hover:opacity-90"
                    >
                      <MessageCircle className="h-[18px] w-[18px]" /> Pedir por WhatsApp
                    </a>
                  )}
                  <RouterLink
                    to="/checkout"
                    onClick={closeCart}
                    className="flex h-11 items-center justify-center rounded-xl border border-primary-container text-label-md font-bold text-primary-container transition-colors hover:bg-primary-container/5"
                  >
                    Checkout con dirección
                  </RouterLink>
                </>
              )}
              <RouterLink
                to="/carrito"
                onClick={closeCart}
                className="mt-3 block text-center text-[12.5px] font-semibold text-tertiary-accent hover:underline"
              >
                Ver carrito completo →
              </RouterLink>
            </div>
          </>
        )}
      </aside>
    </>
  );
}
