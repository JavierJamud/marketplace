import { useEffect, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Link as RouterLink } from "react-router-dom";
import { X, Minus, Plus, Trash2, ShoppingBag, Tag, ImageOff } from "lucide-react";
import { api } from "../../lib/api.js";
import { formatPrice, formatMixedTotal } from "../../lib/format.js";
import { useCart } from "../../context/CartContext.jsx";
import { resolveUnitPrice, calcSavings } from "../../lib/pricing.js";
import { VerifiedBadge } from "../ui/VerifiedBadge.jsx";
import { ShareCartButton } from "../ShareCartButton.jsx";
import { ConfirmDeleteModal } from "../ConfirmDeleteModal.jsx";

// Bloque 147: mismo patrón usado en el resto del sitio (ProductCard.jsx,
// SharedCart.jsx, etc.) — `images`/`image` guarda paths relativos servidos
// por el backend (nunca por el frontend), salvo que el vendedor haya
// pegado un link externo, que ya llega absoluto.
function imgUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${api.defaults.baseURL}${path}`;
}

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
    updateQuantity,
    removeItem,
    clearCart,
    isDrawerOpen,
    closeCart,
    discount,
  } = useCart();
  const [confirmingClear, setConfirmingClear] = useState(false);

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
  const count = items.reduce((a, i) => a + i.quantity, 0);
  const subtotal = items.reduce((sum, i) => sum + resolveUnitPrice(i.price, i.priceTiers, i.quantity) * i.quantity, 0);

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
            <div className="flex items-center justify-between gap-2 px-5 py-3">
              {/* Bloque 148 (bug real reportado en vivo, con captura — el
                  ícono de tienda verificada aparecía pegado al botón
                  "Vaciar", como si fueran del mismo grupo): `VerifiedBadge`
                  documenta su propio uso como "siempre junto al nombre de
                  la tienda" — vivía suelto al final de la fila, lejos del
                  nombre, porque compartía el mismo `gap` que el botón de
                  vaciar. Ahora el badge va DENTRO del mismo grupo truncable
                  que el nombre (avatar + nombre + check, todo del lado
                  izquierdo), y "Vaciar" queda solo del lado derecho
                  (`justify-between` en el contenedor), sin ambigüedad de a
                  qué pertenece cada ícono. */}
              <div className="flex min-w-0 items-center gap-2.5">
                <div
                  className="flex h-8 w-8 flex-shrink-0 items-center justify-center rounded-full font-display text-[13px] font-bold text-white shadow-sm"
                  style={{ background: vendorColor ?? "#232F3E" }}
                >
                  {vendorName?.[0]}
                </div>
                <div className="flex min-w-0 items-center gap-1">
                  <span className="truncate text-label-sm font-bold text-on-surface">{vendorName}</span>
                  {isVerified && <VerifiedBadge size="sm" className="flex-shrink-0" />}
                </div>
              </div>
              {/* Bloque 147 (pedido explícito — "agregar un botón para
                  vaciarlo completamente"): mismo `clearCart()` que ya usa
                  el bot de tienda (StoreChatWidget.jsx) cuando el cliente
                  lo pide por chat — acá se suma un botón real y visible,
                  con confirmación para no perder el carrito por un toque
                  accidental. Bloque 148 (pedido explícito): pasa de texto
                  suelto a una píldora real — fondo transparente, borde fino
                  del mismo color que el texto, para que se lea como una
                  acción con su propio espacio, no como un link perdido en
                  la fila. */}
              <button
                type="button"
                onClick={() => setConfirmingClear(true)}
                className="flex-shrink-0 whitespace-nowrap rounded-full border border-error/35 px-2.5 py-1 text-[11px] font-bold text-error transition-colors hover:bg-error/10"
              >
                Vaciar
              </button>
            </div>

            {/* Ítems (scrollable) */}
            <div className="flex-1 overflow-y-auto px-4 py-1">
              <div className="flex flex-col gap-1.5">
                {items.map((it) => {
                  const unitPrice = resolveUnitPrice(it.price, it.priceTiers, it.quantity);
                  const savings = calcSavings(it.price, it.priceTiers, it.quantity);
                  // Bloque 147 (bug real reportado en vivo, con captura —
                  // "las imágenes de los productos no se ven en el carrito
                  // y si hago clic en un producto no me dirige a verlo"):
                  // un ítem agregado ANTES de este bloque (ya persistido en
                  // localStorage) puede no tener `slug` — sin eso no hay a
                  // dónde linkear, así que se degrada a texto/imagen sin
                  // clic en vez de armar un link roto.
                  const productHref = it.slug && vendorSlug ? `/producto/${vendorSlug}/${it.slug}` : null;
                  const thumb = (
                    <div className="flex h-14 w-14 flex-shrink-0 items-center justify-center overflow-hidden rounded-xl bg-surface-container">
                      {it.image ? (
                        <img src={imgUrl(it.image)} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <ImageOff className="h-5 w-5 text-outline/50" />
                      )}
                    </div>
                  );
                  return (
                    <div
                      key={`${it.productId}-${it.size ?? ""}`}
                      className="flex items-start gap-3 rounded-2xl p-2.5 transition-colors hover:bg-surface-container/60"
                    >
                      {productHref ? (
                        <RouterLink to={productHref} onClick={closeCart}>
                          {thumb}
                        </RouterLink>
                      ) : (
                        thumb
                      )}
                      <div className="min-w-0 flex-1">
                        {/* Bloque 140 (pedido explícito, con captura — "el
                            nombre debe mostrarse más completo llenando el
                            espacio de la línea"): antes `truncate` cortaba
                            el nombre a UNA sola línea apenas no entraba —
                            con el precio total viviendo en esta misma fila
                            (ver más abajo, ahora se movió), el nombre tenía
                            todavía menos ancho real disponible. `line-clamp-2`
                            deja que use las 2 líneas completas antes de
                            cortar con "…", y el total bajó a la fila de
                            abajo (junto al selector de cantidad) — el
                            nombre ahora tiene el ancho ENTERO de la tarjeta
                            para sí. */}
                        <div className="flex items-start gap-1.5 text-body-sm font-semibold text-on-surface">
                          {productHref ? (
                            <RouterLink to={productHref} onClick={closeCart} className="line-clamp-2 hover:underline">
                              {it.name}
                            </RouterLink>
                          ) : (
                            <span className="line-clamp-2">{it.name}</span>
                          )}
                          {it.size && (
                            <span className="mt-0.5 flex-shrink-0 rounded-full bg-surface-container px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant">
                              {it.size}
                            </span>
                          )}
                        </div>
                        <div className="mt-0.5 text-[11.5px] text-outline">
                          {formatPrice(unitPrice, it.currency)} c/u
                          {savings > 0 && <span className="ml-1.5 font-semibold text-tertiary-accent">· ahorras {formatPrice(savings, it.currency)}</span>}
                        </div>
                        <div className="mt-1.5 flex items-center justify-between gap-2">
                          <div className="flex items-center gap-2">
                            <div className="flex items-center gap-0.5 rounded-full bg-surface-container p-0.5">
                              {/* Bloque 215 (pedido explícito, con Amazon de
                                  referencia): antes esto SIEMPRE era "-"
                                  (clampeado a un mínimo de 1, nunca llegaba a
                                  sacarlo del carrito) y el bote de basura
                                  vivía aparte, siempre visible — quedaban 2
                                  formas de "borrar" y una de ellas parecía
                                  rota (bajaba y se quedaba pegado en 1). Con
                                  1 sola unidad, este mismo botón se convierte
                                  en la papelera (saca el producto entero); con
                                  2+ vuelve a ser el "-" de siempre. */}
                              {it.quantity <= 1 ? (
                                <button
                                  onClick={() => removeItem(it.productId, it.size)}
                                  title="Eliminar del carrito"
                                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-error transition-colors hover:bg-error/10"
                                >
                                  <Trash2 className="h-3 w-3" />
                                </button>
                              ) : (
                                <button
                                  onClick={() => updateQuantity(it.productId, it.quantity - 1, it.size)}
                                  className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-on-surface transition-colors hover:bg-surface-container-lowest"
                                >
                                  <Minus className="h-3 w-3" />
                                </button>
                              )}
                              {/* min-w en vez de w fijo (Bloque 140/143): la
                                  cantidad puede ser cualquier número real
                                  (el techo es el stock del producto, o
                                  ninguno si es "disponible siempre" — ver
                                  CartContext.jsx) — con un ancho fijo, un
                                  número de varios dígitos volvía a romper
                                  el layout como en el bug original. */}
                              <div className="min-w-[18px] flex-shrink-0 text-center text-[12px] font-semibold">{it.quantity}</div>
                              <button
                                onClick={() => updateQuantity(it.productId, it.quantity + 1, it.size)}
                                className="flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-on-surface transition-colors hover:bg-surface-container-lowest"
                              >
                                <Plus className="h-3 w-3" />
                              </button>
                            </div>
                          </div>
                          <div className="flex-shrink-0 text-body-sm font-bold text-on-surface">{formatPrice(unitPrice * it.quantity, it.currency)}</div>
                        </div>
                      </div>
                    </div>
                  );
                })}
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

              {/* Bloque 231 (pedido explícito — "el botón de completar
                  pedido no debe ser verde con ese ícono de mensaje, debe
                  ser un botón de los colores azul oscuro de la paleta...
                  con ícono de compra"): antes tomaba el verde de WhatsApp
                  (#25D366) con un ícono de burbuja de chat cuando la tienda
                  recibe pedidos por WhatsApp — que es la mayoría de las
                  tiendas por default, así que era el color que casi todo el
                  mundo veía. El checkout es una pantalla de ESTE sitio, no
                  de WhatsApp, así que usa el navy de marca (`bg-primary`)
                  siempre, sin importar a dónde le llegue el aviso al
                  vendedor por dentro. */}
              <RouterLink
                to="/checkout"
                onClick={closeCart}
                className="flex h-12 items-center justify-center gap-2 rounded-xl bg-primary text-label-md font-bold text-white shadow-md transition-all hover:-translate-y-0.5 hover:shadow-lg hover:brightness-110"
              >
                <ShoppingBag className="h-[18px] w-[18px]" />
                Completar pedido
              </RouterLink>
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

      {confirmingClear && (
        <ConfirmDeleteModal
          title="¿Vaciar el carrito?"
          description="Se van a sacar todos los productos que agregaste."
          confirmLabel="Vaciar carrito"
          zIndex="z-[70]"
          onConfirm={() => {
            clearCart();
            setConfirmingClear(false);
          }}
          onCancel={() => setConfirmingClear(false)}
        />
      )}
    </>
  );
}
