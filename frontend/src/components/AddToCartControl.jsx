import { Minus, Plus, ShoppingCart } from "lucide-react";
import toast from "react-hot-toast";
import { useCart } from "../context/CartContext.jsx";
import { useAuth } from "../context/AuthContext.jsx";
import { api } from "../lib/api.js";

function toCartProduct(product) {
  return {
    id: product.id,
    name: product.name,
    price: Number(product.price),
    stock: product.stock,
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
export function AddToCartControl({ product, size = "md", variant = "square" }) {
  const { items, addItem, updateQuantity, removeItem } = useCart();
  const { user } = useAuth();
  const existing = items.find((i) => i.productId === product.id);
  const dim = size === "sm" ? "h-[34px] w-[34px]" : "h-9 w-9";
  const iconDim = size === "sm" ? "h-[15px] w-[15px]" : "h-4 w-4";
  const shape = variant === "circle" ? "rounded-full" : "rounded";

  if (!existing) {
    return (
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          addItem(toCartProduct(product));
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
    );
  }

  const atStockLimit = existing.quantity >= (existing.stock ?? Infinity);

  return (
    <div className={`flex ${dim} flex-shrink-0 items-center ${shape} border border-secondary-container`}>
      <button
        onClick={(e) => {
          e.preventDefault();
          e.stopPropagation();
          existing.quantity <= 1 ? removeItem(product.id) : updateQuantity(product.id, existing.quantity - 1);
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
          updateQuantity(product.id, existing.quantity + 1);
        }}
        disabled={atStockLimit}
        title={atStockLimit ? "No hay más stock disponible" : undefined}
        className={`flex h-full w-1/3 items-center justify-center ${atStockLimit ? "cursor-not-allowed text-outline/40" : "text-secondary"}`}
      >
        <Plus className="h-3 w-3" />
      </button>
    </div>
  );
}
