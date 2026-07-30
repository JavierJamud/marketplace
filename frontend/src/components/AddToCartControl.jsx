import { useState } from "react";
import { Minus, Plus, ShoppingCart, X } from "lucide-react";
import toast from "react-hot-toast";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";

function toCartProduct(product, size = null) {
  return {
    id: product.id,
    name: product.name,
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
// tienda) — mismo addItem/misma validación de stock de siempre, solo cambia
// la forma (rounded-full + ícono "+" en vez del ShoppingCart cuadrado ya
// usado en Store.jsx/Product.jsx) para no alterar el look ya shippeado en
// el resto del sitio, que sigue usando el default ("square").
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

  if (!existing) {
    return (
      <div className="flex items-center">
        {sizeChip}
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            addItem(toCartProduct(product, activeSize));
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
          {variant === "circle" ? <Plus className={iconDim} /> : <ShoppingCart className={iconDim} />}
        </button>
      </div>
    );
  }

  const atStockLimit = existing.quantity >= (existing.stock ?? Infinity);

  return (
    <div className="flex items-center">
      {sizeChip}
      <div className={`flex ${dim} flex-shrink-0 items-center ${shape} border border-secondary-container`}>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            existing.quantity <= 1
              ? removeItem(product.id, activeSize)
              : updateQuantity(product.id, existing.quantity - 1, activeSize);
          }}
          className="flex h-full w-1/3 items-center justify-center text-secondary"
        >
          <Minus className="h-3 w-3" />
        </button>
        <span className="flex-1 text-center text-[12px] font-bold text-on-surface">{existing.quantity}</span>
        <button
          onClick={(e) => {
            e.preventDefault();
            e.stopPropagation();
            if (atStockLimit) return;
            updateQuantity(product.id, existing.quantity + 1, activeSize);
          }}
          disabled={atStockLimit}
          title={atStockLimit ? "No hay más stock disponible" : undefined}
          className={`flex h-full w-1/3 items-center justify-center ${atStockLimit ? "cursor-not-allowed text-outline/40" : "text-secondary"}`}
        >
          <Plus className="h-3 w-3" />
        </button>
      </div>
    </div>
  );
}
