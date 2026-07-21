import { createContext, useContext, useState, useCallback, useEffect } from "react";
import toast from "react-hot-toast";

// Regla de negocio clave: el carrito pertenece a UN SOLO vendedor a la vez.
// Si el cliente agrega un producto de otra tienda, se muestra un conflicto
// (CartConflictModal) que ofrece vaciar el carrito actual primero.
// Persistido en localStorage para que sobreviva a un refresh de página.
const CartContext = createContext(null);
const STORAGE_KEY = "zeudin_cart";

function vendorMeta(product) {
  return {
    vendorId: product.vendorId,
    vendorName: product.vendorName,
    vendorSlug: product.vendorSlug,
    vendorColor: product.vendorColor,
    vendorVerified: product.vendorVerified,
    vendorWhatsapp: product.vendorWhatsapp,
  };
}

function readStored() {
  try {
    const parsed = JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "null");
    return parsed && typeof parsed === "object" ? parsed : { vendor: {}, items: [] };
  } catch {
    return { vendor: {}, items: [] };
  }
}

export function CartProvider({ children }) {
  const initial = readStored();
  const [vendor, setVendor] = useState(initial.vendor);
  const [items, setItems] = useState(initial.items); // { productId, name, price, quantity, selectedOptions }
  const [pendingConflict, setPendingConflict] = useState(null);
  // Contador que se incrementa en cada agregado exitoso (no en conflicto ni
  // en cambios de cantidad desde el carrito). El Header lo usa como "key"
  // para reiniciar la animación del ícono sin necesitar un timer propio.
  const [bump, setBump] = useState(0);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ vendor, items }));
  }, [vendor, items]);

  const addItem = useCallback(
    (product, quantity = 1, selectedOptions = {}) => {
      if (vendor.vendorId && vendor.vendorId !== product.vendorId) {
        setPendingConflict({ product, quantity, selectedOptions });
        return { conflict: true };
      }

      // Techo de stock: nunca se acumula más de lo disponible, ni sumando
      // desde distintas pantallas (Home, catálogo, tienda, producto). Piso
      // de 1 siempre — un ítem en el carrito con cantidad 0 no tiene
      // sentido (bug reportado: quedaba en 0 en vez de 1 en el primer
      // agregado); Math.max(1, ...) lo hace matemáticamente imposible sin
      // importar qué valor traiga stock/quantity.
      const stock = product.stock ?? Infinity;
      setVendor(vendorMeta(product));
      setItems((prev) => {
        const existing = prev.find((i) => i.productId === product.id);
        if (existing) {
          const nextQty = Math.max(1, Math.min(existing.quantity + quantity, stock));
          return prev.map((i) => (i.productId === product.id ? { ...i, quantity: nextQty, stock } : i));
        }
        return [
          ...prev,
          { productId: product.id, name: product.name, price: product.price, quantity: Math.max(1, Math.min(quantity, stock)), stock, selectedOptions },
        ];
      });
      setBump((b) => b + 1);
      return { conflict: false };
    },
    [vendor.vendorId]
  );

  const resolveConflict = useCallback(
    (keepNewVendor) => {
      if (!pendingConflict) return;
      if (keepNewVendor) {
        const { product, quantity, selectedOptions } = pendingConflict;
        const stock = product.stock ?? Infinity;
        setVendor(vendorMeta(product));
        setItems([{ productId: product.id, name: product.name, price: product.price, quantity: Math.max(1, Math.min(quantity, stock)), stock, selectedOptions }]);
        setBump((b) => b + 1);
      }
      setPendingConflict(null);
    },
    [pendingConflict]
  );

  const removeItem = (productId) => {
    setItems((prev) => prev.filter((i) => i.productId !== productId));
    toast.success("Producto eliminado del carrito");
  };

  const updateQuantity = (productId, quantity) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === productId);
      if (!existing) return prev;
      const clamped = Math.max(1, Math.min(quantity, existing.stock ?? Infinity));
      // Sube el número de a poco desde el stepper (+) también cuenta como
      // "agregar" a efectos visuales: reinicia la animación del ícono.
      if (clamped > existing.quantity) setBump((b) => b + 1);
      return prev.map((i) => (i.productId === productId ? { ...i, quantity: clamped } : i));
    });
  };

  const clearCart = () => {
    setItems([]);
    setVendor({});
  };

  const total = items.reduce((sum, i) => sum + i.price * i.quantity, 0);

  return (
    <CartContext.Provider
      value={{
        vendorId: vendor.vendorId ?? null,
        vendorName: vendor.vendorName ?? null,
        vendorSlug: vendor.vendorSlug ?? null,
        vendorColor: vendor.vendorColor ?? null,
        vendorVerified: vendor.vendorVerified ?? false,
        vendorWhatsapp: vendor.vendorWhatsapp ?? null,
        items,
        total,
        bump,
        pendingConflict,
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        resolveConflict,
      }}
    >
      {children}
    </CartContext.Provider>
  );
}

export function useCart() {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error("useCart debe usarse dentro de <CartProvider>");
  return ctx;
}
