import { createContext, useContext, useState, useCallback, useEffect, useRef } from "react";
import toast from "../lib/toast.jsx";
import { api } from "../lib/api.js";
import { useAuth } from "./AuthContext.jsx";
import { resolveUnitPrice } from "../lib/pricing.js";

// Regla de negocio clave: el carrito pertenece a UN SOLO vendedor a la vez.
// Si el cliente agrega un producto de otra tienda, se muestra un conflicto
// (CartConflictModal) que ofrece vaciar el carrito actual primero.
// Persistido en localStorage para que sobreviva a un refresh de página.
const CartContext = createContext(null);
const STORAGE_KEY = "zeudin_cart";

// Bloque 143 (pedido explícito — corrige el criterio del Bloque 140: "a
// los productos se le pueda agregar más de 99 unidades, el monto a
// agregar es ilimitado dependiendo del stock del producto"): el Bloque 140
// diagnosticó mal el bug real (captura de un carrito con ~2147483671
// unidades) — asumió que un `stock` faltante era un descuido y agregó un
// techo DURO de 99 para TODOS los productos. Pero el producto de esa
// captura (Champú, `unlimitedStock:true`) SIEMPRE estuvo pensado para no
// tener techo — `AddToCartControl.jsx`/`Product.jsx`/`StoreChatWidget.jsx`
// ya mandaban `stock:null` a propósito para señalar justo eso ("`null`
// (no un número) le dice a CartContext que no hay techo real que
// respetar" — comentario que ya estaba ahí desde antes). Con `??`, `null`
// dispara el fallback igual que `undefined` — el Bloque 140 reemplazó ese
// `?? Infinity` (correcto, respeta el sentinel) por `?? MAX_CART_QUANTITY`,
// rompiendo la función real de "disponible siempre" para CUALQUIER
// producto ilimitado, no solo para el caso roto. `resolveStockCap` es el
// único lugar que decide el techo real, ahora sí correcto: `null` (el
// sentinel real) = sin techo; cualquier otro valor no-numérico (bug de
// verdad, no una decisión del vendedor) = 0, nunca "sin límite" por
// accidente — el techo real de un producto CON stock sigue siendo su
// stock real (puede ser mayor a 99 sin problema, ej. una tienda que vende
// 500 unidades de algo).
function resolveStockCap(stock) {
  if (stock === null) return Infinity;
  const n = Number(stock);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

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
    if (!parsed || typeof parsed !== "object") return { vendor: {}, items: [], discount: null };
    // Bloque 140/143: auto-cura una cantidad guardada que no sea un número
    // válido (NaN, negativa, etc. — un carrito de verdad corrupto) contra
    // el techo REAL del producto (resolveStockCap: sin techo si es
    // ilimitado, su stock real si no) — nunca contra un techo arbitrario.
    const items = Array.isArray(parsed.items)
      ? parsed.items.map((i) => ({
          ...i,
          quantity: Math.max(1, Math.min(Number(i.quantity) || 1, resolveStockCap(i.stock))),
        }))
      : [];
    return { vendor: parsed.vendor ?? {}, items, discount: parsed.discount ?? null };
  } catch {
    return { vendor: {}, items: [], discount: null };
  }
}

export function CartProvider({ children }) {
  const initial = readStored();
  const [vendor, setVendor] = useState(initial.vendor);
  const [items, setItems] = useState(initial.items); // { productId, name, price, quantity, selectedOptions }
  const [pendingConflict, setPendingConflict] = useState(null);
  // Bloque 52: código de descuento aplicado a ESTE carrito (siempre de la
  // tienda vigente — el carrito es de un solo vendedor). { code, type,
  // value, amount } tal cual lo devuelve POST /discount-codes/validate — se
  // revalida igual server-side al confirmar el pedido (ver Checkout.jsx),
  // esto es solo lo que se muestra mientras se arma la compra.
  const [discount, setDiscount] = useState(initial.discount ?? null);
  // Contador que se incrementa en cada agregado exitoso (no en conflicto ni
  // en cambios de cantidad desde el carrito). El Header lo usa como "key"
  // para reiniciar la animación del ícono sin necesitar un timer propio.
  const [bump, setBump] = useState(0);
  // Mini-carrito: el ícono del Header abre este panel encima de la página
  // actual en vez de navegar a /carrito — solo "Continuar al checkout" (o
  // "Ver carrito completo") cambia de página de verdad. /carrito sigue
  // existiendo como página completa aparte (link directo, compartir, etc.).
  const [isDrawerOpen, setIsDrawerOpen] = useState(false);
  const openCart = useCallback(() => setIsDrawerOpen(true), []);
  const closeCart = useCallback(() => setIsDrawerOpen(false), []);

  // Bloque 54: carrito persistente por cuenta — mientras haya sesión, cada
  // cambio se guarda (debounced) en el servidor (CartSnapshot), y al iniciar
  // sesión en OTRO dispositivo se restaura desde ahí. `useAuth()` funciona
  // acá porque CartProvider está anidado DENTRO de AuthProvider (ver main.jsx).
  const { user } = useAuth();
  const hasSyncedRef = useRef(false);
  const saveTimerRef = useRef(null);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ vendor, items, discount }));
  }, [vendor, items, discount]);

  // Reemplaza el carrito entero (vendedor + ítems + descuento opcional) — se
  // usa al restaurar el carrito guardado en la cuenta (carrito local vacío)
  // y al importar un carrito compartido cuando hace falta reemplazar el
  // propio (ver SharedCart.jsx).
  const replaceCart = useCallback((nextVendor, nextItems, nextDiscount = null) => {
    setVendor(nextVendor);
    setItems(nextItems);
    setDiscount(nextDiscount);
    setBump((b) => b + 1);
  }, []);

  // Fusiona ítems de OTRO carrito (de la misma tienda) con el actual — suma
  // cantidades si el producto+talla ya estaba, respetando el stock de cada
  // uno; agrega el resto como líneas nuevas. Usado al restaurar el carrito
  // de cuenta cuando el dispositivo YA tenía algo de la misma tienda, y al
  // importar un carrito compartido de la misma tienda que ya se está viendo.
  const mergeItems = useCallback((incoming) => {
    setItems((prev) => {
      const merged = [...prev];
      for (const inc of incoming) {
        const idx = merged.findIndex((i) => i.productId === inc.productId && i.size === inc.size);
        if (idx >= 0) {
          const cap = inc.stock ?? merged[idx].stock ?? Infinity;
          merged[idx] = { ...merged[idx], quantity: Math.min(merged[idx].quantity + inc.quantity, cap) };
        } else {
          merged.push(inc);
        }
      }
      return merged;
    });
    setBump((b) => b + 1);
  }, []);

  // Al iniciar sesión (en cualquier dispositivo): trae el carrito guardado
  // en la cuenta. Si el carrito de ESTE dispositivo está vacío, lo adopta
  // tal cual (el caso principal pedido: "inicio sesión en otro dispositivo y
  // aparece mi carrito"). Si ya tenía algo de la MISMA tienda, lo fusiona.
  // Si tenía algo de OTRA tienda, se prioriza lo que ya había en este
  // dispositivo — el próximo cambio termina pisando el snapshot del server
  // de todas formas, así que no hace falta un modal de conflicto acá.
  useEffect(() => {
    if (!user) {
      hasSyncedRef.current = false;
      return;
    }
    if (hasSyncedRef.current) return;
    hasSyncedRef.current = true;

    (async () => {
      try {
        const { data } = await api.get("/cart/me");
        if (!data.cart || !data.cart.items?.length) return;
        const local = readStored();
        if (!local.items?.length) {
          replaceCart(data.cart.vendorMeta, data.cart.items, data.cart.discount ?? null);
        } else if (local.vendor?.vendorId === data.cart.vendorMeta?.vendorId) {
          mergeItems(data.cart.items);
        }
      } catch {
        // sin conexión o sesión vencida — el carrito local sigue funcionando igual.
      }
    })();
  }, [user, replaceCart, mergeItems]);

  // Guarda (debounced) el carrito en la cuenta en cada cambio mientras haya
  // sesión — vacío = se borra el snapshot (pedido confirmado o vaciado a
  // mano), así no revive productos viejos en el próximo dispositivo.
  useEffect(() => {
    if (!user) return;
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      if (items.length === 0) {
        api.delete("/cart/me").catch(() => {});
      } else {
        api.put("/cart/me", { vendorMeta: vendor, items, discount }).catch(() => {});
      }
    }, 700);
    return () => clearTimeout(saveTimerRef.current);
  }, [user, vendor, items, discount]);

  // Bloque 52: con tallas, un mismo producto puede tener varias líneas en el
  // carrito (una por talla) — la identidad de un ítem pasa a ser
  // productId+size (size null para productos sin tallas, que siguen
  // comportándose exactamente igual que antes).
  const addItem = useCallback(
    (product, quantity = 1, selectedOptions = {}) => {
      // Bloque 107: además de comparar vendedores, se exige que el carrito
      // realmente tenga algo — refuerzo defensivo para que un `vendor`
      // viejo que quedara pegado por cualquier otro camino futuro (no solo
      // el de removeItem, ya arreglado arriba) nunca dispare un conflicto
      // falso sobre un carrito que en los hechos está vacío.
      if (items.length > 0 && vendor.vendorId && vendor.vendorId !== product.vendorId) {
        setPendingConflict({ product, quantity, selectedOptions });
        return { conflict: true };
      }

      // Techo de stock: nunca se acumula más de lo disponible, ni sumando
      // desde distintas pantallas (Home, catálogo, tienda, producto). Piso
      // de 1 siempre — un ítem en el carrito con cantidad 0 no tiene
      // sentido (bug reportado: quedaba en 0 en vez de 1 en el primer
      // agregado); Math.max(1, ...) lo hace matemáticamente imposible sin
      // importar qué valor traiga stock/quantity.
      const stock = resolveStockCap(product.stock);
      const size = product.size ?? null;
      const currency = product.currency ?? "CUP";
      setVendor(vendorMeta(product));
      setItems((prev) => {
        const existing = prev.find((i) => i.productId === product.id && i.size === size);
        if (existing) {
          const nextQty = Math.max(1, Math.min(existing.quantity + quantity, stock));
          // priceTiers se refresca con lo que trae `product` (por si el
          // vendedor los cambió desde la última visita) en vez de conservar
          // lo que ya había en el carrito.
          return prev.map((i) =>
            i.productId === product.id && i.size === size
              ? {
                  ...i,
                  quantity: nextQty,
                  stock,
                  priceTiers: product.priceTiers ?? i.priceTiers,
                  image: product.image ?? i.image ?? null,
                  slug: product.slug ?? i.slug ?? null,
                }
              : i
          );
        }
        return [
          ...prev,
          {
            productId: product.id,
            name: product.name,
            // Bloque 147 (bug real reportado en vivo — el carrito no
            // mostraba la foto del producto ni linkeaba a su ficha):
            // `image`/`slug` viajan desde cada punto de entrada
            // (AddToCartControl.jsx/Product.jsx/StoreChatWidget.jsx) — acá
            // solo se guardan tal cual llegan, mismo criterio que el resto
            // de los campos de este objeto.
            image: product.image ?? null,
            slug: product.slug ?? null,
            price: product.price,
            priceTiers: product.priceTiers ?? [],
            currency,
            size,
            quantity: Math.max(1, Math.min(quantity, stock)),
            stock,
            selectedOptions,
          },
        ];
      });
      setBump((b) => b + 1);
      return { conflict: false };
    },
    [vendor.vendorId, items.length]
  );

  const resolveConflict = useCallback(
    (keepNewVendor) => {
      if (!pendingConflict) return;
      if (keepNewVendor) {
        const { product, quantity, selectedOptions } = pendingConflict;
        const stock = product.stock ?? Infinity;
        const size = product.size ?? null;
        const currency = product.currency ?? "CUP";
        setVendor(vendorMeta(product));
        setItems([
          {
            productId: product.id,
            name: product.name,
            image: product.image ?? null,
            slug: product.slug ?? null,
            price: product.price,
            priceTiers: product.priceTiers ?? [],
            currency,
            size,
            quantity: Math.max(1, Math.min(quantity, stock)),
            stock,
            selectedOptions,
          },
        ]);
        // Bloque 52: un código de descuento pertenece a la tienda anterior —
        // cambiar de vendedor lo invalida (el carrito vuelve a ser de la
        // nueva tienda, sin descuento aplicado).
        setDiscount(null);
        setBump((b) => b + 1);
      }
      setPendingConflict(null);
    },
    [pendingConflict]
  );

  // Bloque 107 (bug real reportado en vivo: "el carrito está vacío pero me
  // dice que tiene otra tienda"): quitar productos DE A UNO (a diferencia
  // de clearCart, el botón "Vaciar") solo tocaba `items` — si el cliente
  // terminaba en 0 productos sacándolos manualmente uno por uno, `vendor`
  // se quedaba con el vendedor viejo pegado. addItem (más abajo) chequea
  // conflicto mirando SOLO `vendor.vendorId`, nunca si `items` está vacío
  // de verdad — con el carrito vacío pero `vendor` viejo todavía puesto, el
  // próximo producto de OTRA tienda disparaba el modal de conflicto sobre
  // un carrito que en los hechos no tenía nada. Mismo criterio que
  // clearCart: si sacar este ítem deja el carrito en 0, se resetea vendor
  // (y el código de descuento, que es de la tienda vigente) junto con items.
  const removeItem = (productId, size = null) => {
    setItems((prev) => {
      const next = prev.filter((i) => !(i.productId === productId && i.size === size));
      if (next.length === 0) {
        setVendor({});
        setDiscount(null);
      }
      return next;
    });
    toast.success("Producto eliminado del carrito");
  };

  const updateQuantity = (productId, quantity, size = null) => {
    setItems((prev) => {
      const existing = prev.find((i) => i.productId === productId && i.size === size);
      if (!existing) return prev;
      const clamped = Math.max(1, Math.min(quantity, resolveStockCap(existing.stock)));
      // Sube el número de a poco desde el stepper (+) también cuenta como
      // "agregar" a efectos visuales: reinicia la animación del ícono.
      if (clamped > existing.quantity) setBump((b) => b + 1);
      return prev.map((i) => (i.productId === productId && i.size === size ? { ...i, quantity: clamped } : i));
    });
  };

  const clearCart = () => {
    setItems([]);
    setVendor({});
    setDiscount(null);
  };

  // Bloque 55: cada línea puede tener precios por cantidad — el total real
  // se calcula resolviendo el precio unitario según la cantidad de ESA
  // línea, igual que hace el backend al confirmar el pedido (nunca un
  // simple price*quantity con el precio de 1 sola unidad).
  const total = items.reduce((sum, i) => sum + resolveUnitPrice(i.price, i.priceTiers, i.quantity) * i.quantity, 0);
  const discountAmount = discount?.amount ?? 0;
  const totalWithDiscount = Math.max(0, total - discountAmount);

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
        totalWithDiscount,
        bump,
        pendingConflict,
        isDrawerOpen,
        openCart,
        closeCart,
        discount,
        setDiscount,
        clearDiscount: () => setDiscount(null),
        addItem,
        removeItem,
        updateQuantity,
        clearCart,
        resolveConflict,
        replaceCart,
        mergeItems,
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
