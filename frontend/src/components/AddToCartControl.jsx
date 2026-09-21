import { useState } from "react";
import { Minus, Plus, ShoppingBasket, ShoppingCart, Trash2, X } from "lucide-react";
import toast from "../lib/toast.jsx";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";

function toCartProduct(product, size = null) {
  return {
    id: product.id,
    name: product.name,
    // Bloque 147 (bug real reportado en vivo, con captura — el carrito
    // mostraba un cuadro gris vacío en vez de la foto del producto, y hacer
    // clic en una línea del carrito no llevaba a la ficha del producto):
    // `product.images`/`product.slug` nunca viajaban hasta CartContext —
    // el ítem del carrito se armaba solo con lo que hacía falta para el
    // precio/stock, nunca con lo necesario para mostrarlo o linkearlo.
    image: product.images?.[0] ?? null,
    slug: product.slug ?? null,
    price: Number(product.price),
    priceTiers: product.priceTiers ?? [],
    currency: product.currency,
    // Bloque 56: `null` (no un número) le dice a CartContext que este
    // producto no tiene techo real de stock que respetar. Bloque 66: con
    // talla, el techo real es el stock de ESA talla, no el total del producto.
    stock: product.unlimitedStock ? null : size ? Number(product.sizeStock?.[size] ?? 0) : product.stock,
    size,
    vendorId: product.vendorId ?? product.vendor?.id,
    vendorName: product.vendor?.companyName,
    vendorSlug: product.vendor?.slug,
    vendorColor: product.vendor?.color,
    vendorVerified: product.vendor?.isVerified,
    vendorWhatsapp: product.vendor?.whatsapp,
  };
}

// Botón de "agregar" que se convierte en stepper (-/cantidad/+) en cuanto el
// producto ya está en el carrito, para que el cliente vea de un vistazo
// cuánto tiene agregado sin tener que abrir el carrito.
// Bloque 34: variant="circle" (usado por la tarjeta de producto del chat de
// tienda y por DigitalMenuProductCard.jsx) — mismo addItem/misma validación
// de stock de siempre, solo cambia la forma (rounded-full) y el ícono
// (Bloque 213, pedido explícito, con imagen de referencia: ShoppingBasket
// en vez de Plus, para que se lea de un vistazo como "agregar" — el
// ShoppingCart cuadrado del default ("square") sigue igual en Store.jsx/
// Product.jsx, sin cambios).
// Bloque 66 (pedido explícito): un producto con tallas ya no redirige a la
// ficha del producto — la talla se elige en la propia tarjeta con pills
// compactas (mismo patrón visual que Product.jsx) y, una vez elegida, se
// comporta igual que cualquier otro producto (botón/stepper), con la talla
// como parte de la identidad del ítem en el carrito.
export function AddToCartControl({ product, size = "md", variant = "square" }) {
  const { items, addItem, updateQuantity, removeItem } = useCart();
  const { user } = useAuth();
  const [selectedSize, setSelectedSize] = useState(null);
  const hasSizes = product.sizes?.length > 0;
  const activeSize = hasSizes ? selectedSize : null;
  const existing = items.find((i) => i.productId === product.id && i.size === activeSize);
  const dim = size === "sm" ? "h-[34px] w-[34px]" : "h-9 w-9";
  // Bloque 116 (bug real reportado en vivo, con captura — "-512+" apretado
  // y roto): el stepper (-/cantidad/+) reusaba `dim`, que fija un ANCHO
  // cuadrado pensado para el botón de un solo ícono de arriba — con una
  // cantidad de varios dígitos (2+ unidades en el carrito llega fácil a
  // 3 dígitos), el centro no tenía espacio real y el número se superponía
  // con los botones +/-. Acá solo se reusa la ALTURA de `dim`; el ancho
  // queda libre (min-width razonable para 1-2 dígitos, crece solo con el
  // contenido) y los botones +/- pasan a un ancho fijo en vez de 1/3 del
  // cuadrado, para que sea SIEMPRE el número el que se estira, nunca ellos.
  const stepperHeight = size === "sm" ? "h-[34px]" : "h-9";
  const stepperBtnWidth = size === "sm" ? "w-7" : "w-8";
  const iconDim = size === "sm" ? "h-[15px] w-[15px]" : "h-4 w-4";
  const shape = variant === "circle" ? "rounded-full" : "rounded";

  if (hasSizes && !selectedSize) {
    return (
      <div className="flex max-w-[160px] flex-wrap justify-end gap-1">
        {product.sizes.map((s) => {
          const stockForSize = Number(product.sizeStock?.[s] ?? 0);
          return (
            <button
              key={s}
              type="button"
              disabled={stockForSize === 0}
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setSelectedSize(s);
              }}
              title={stockForSize === 0 ? "Sin stock" : `Elegir talla ${s}`}
              className={`rounded-full border px-2 py-0.5 text-[10px] font-bold leading-4 transition-colors ${
                stockForSize === 0
                  ? "cursor-not-allowed border-outline-variant text-outline/40 line-through"
                  : "border-outline-variant text-on-surface-variant hover:border-tertiary-accent hover:text-tertiary-accent"
              }`}
            >
              {s}
            </button>
          );
        })}
      </div>
    );
  }

  // Chip chico con la talla elegida — permite volver a elegir sin salir de
  // la tarjeta ni perder el resto del contexto (precio, foto, etc.).
  const sizeChip = hasSizes && selectedSize && (
    <button
      type="button"
      onClick={(e) => {
        e.preventDefault();
        e.stopPropagation();
        setSelectedSize(null);
      }}
      title="Cambiar talla"
      className="mr-1 flex flex-shrink-0 items-center gap-0.5 rounded-full bg-surface-container px-1.5 py-0.5 text-[10px] font-bold text-on-surface-variant"
    >
      {selectedSize}
      <X className="h-2.5 w-2.5" />
    </button>
  );

  // Bug real reportado en vivo (con captura): un producto SIN tallas y con
  // stock 0 (no unlimitedStock) igual se podía agregar al carrito — este
  // botón nunca chequeaba stock para nada, a diferencia del selector de
  // tallas de arriba (que sí deshabilita cada talla agotada). Con tallas, no
  // hace falta repetir el chequeo acá: `activeSize` solo llega a existir si
  // el cliente pudo elegir una talla con stock > 0 (las agotadas ya vienen
  // deshabilitadas arriba).
  const outOfStock = !hasSizes && !product.unlimitedStock && Number(product.stock) === 0;

  if (!existing) {
    if (outOfStock) {
      return (
        <span
          title="Sin stock"
          className={`flex ${dim} flex-shrink-0 cursor-not-allowed items-center justify-center ${shape} bg-surface-container text-outline/50`}
        >
          {variant === "circle" ? <ShoppingBasket className={iconDim} /> : <ShoppingCart className={iconDim} />}
        </span>
      );
    }
    return (
      <div className="flex items-center">
        {sizeChip}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            // Bug real reportado en vivo (con captura): este toast salía
            // SIEMPRE, incluso cuando `addItem` detecta que el carrito ya
            // tiene otra tienda — en ese caso no agrega nada de verdad, solo
            // abre CartConflictModal, así que "Agregado al carrito ✓" era
            // mentira. Mismo chequeo que ya usa StoreChatWidget.jsx: el
            // toast de éxito solo sale si `addItem` confirma que agregó de
            // verdad (el conflicto lo confirma el modal al resolverse, ver
            // CartConflictModal.jsx).
            const result = addItem(toCartProduct(product, activeSize));
            if (result.conflict) return;
            toast.success("Agregado al carrito ✓");
            // Tracking mínimo para "clientes potenciales" — solo el primer
            // agregado (no los +/- del stepper), solo clientes logueados.
            const vendorId = product.vendorId ?? product.vendor?.id;
            if (user?.role === "CUSTOMER" && vendorId) {
              api.post(`/vendors/${vendorId}/engagement`, { type: "CART_ADD" }).catch(() => {});
            }
          }}
          title="Agregar al carrito"
          className={`flex ${dim} flex-shrink-0 items-center justify-center ${shape} bg-secondary-container text-on-secondary-container hover:brightness-95`}
        >
          {variant === "circle" ? <ShoppingBasket className={iconDim} /> : <ShoppingCart className={iconDim} />}
        </button>
      </div>
    );
  }

  // `existing.stock` es `null` cuando `toCartProduct` (arriba) marcó el
  // producto como "disponible siempre" — con `??`, `null` cae al mismo
  // fallback que `undefined` (Infinity, sin techo), que es justo el
  // sentinel que se busca acá. Bloque 143 (corrige el Bloque 140, que
  // rompió esto con un techo duro de 99 para CUALQUIER producto): el techo
  // real vuelve a ser el stock real del producto, o ninguno si es ilimitado.
  const atStockLimit = existing.quantity >= (existing.stock ?? Infinity);

  return (
    <div className="flex items-center">
      {sizeChip}
      <div className={`flex ${stepperHeight} min-w-[76px] flex-shrink-0 items-stretch ${shape} border border-secondary-container`}>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            existing.quantity <= 1
              ? removeItem(product.id, activeSize)
              : updateQuantity(product.id, existing.quantity - 1, activeSize);
          }}
          title={existing.quantity <= 1 ? "Eliminar del carrito" : undefined}
          className={`flex ${stepperBtnWidth} flex-shrink-0 items-center justify-center ${existing.quantity <= 1 ? "text-error" : "text-secondary"}`}
        >
          {/* Bloque 215 (pedido explícito, con captura — mismo criterio ya
              aplicado en CartDrawer.jsx/Cart.jsx): el onClick de arriba YA
              llamaba removeItem con 1 sola unidad — lo único que faltaba acá
              era el ícono, que siempre quedaba en "-" así de verdad se
              sacara el producto o no. Con 1 unidad se ve la papelera; con
              2+ vuelve a ser el "-" de siempre. */}
          {existing.quantity <= 1 ? <Trash2 className="h-3 w-3" /> : <Minus className="h-3 w-3" />}
        </button>
        <span className="flex min-w-0 flex-1 items-center justify-center overflow-hidden whitespace-nowrap px-1 text-[12px] font-bold text-on-surface">
          {existing.quantity}
        </span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (atStockLimit) return;
            updateQuantity(product.id, existing.quantity + 1, activeSize);
          }}
          disabled={atStockLimit}
          title={atStockLimit ? "No hay más stock disponible" : undefined}
          className={`flex ${stepperBtnWidth} flex-shrink-0 items-center justify-center ${atStockLimit ? "cursor-not-allowed text-outline/40" : "text-secondary"}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
