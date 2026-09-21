import { useCart } from "../context/CartContext.jsx";
import { usePlatformSettings } from "../lib/usePlatformSettings.js";
import { Button } from "./ui/Button.jsx";
import { AlertTriangle } from "lucide-react";
import toast from "../lib/toast.jsx";

// Cuando el cliente intenta agregar un producto de otra tienda mientras ya
// tiene un carrito activo. Regla de negocio: un solo vendedor a la vez.
export function CartConflictModal() {
  const { siteName } = usePlatformSettings();
  const { pendingConflict, resolveConflict, vendorName } = useCart();

  if (!pendingConflict) return null;

  // Bug real reportado en vivo (con captura): el momento en que el producto
  // se agrega DE VERDAD es acá (al confirmar "Vaciar y continuar" —
  // resolveConflict(true) recién ahí vacía el carrito viejo y agrega el
  // nuevo ítem, ver CartContext.jsx), pero antes no había NINGÚN toast que
  // lo confirmara — el único toast de "Agregado al carrito ✓" salía antes,
  // apenas se hacía clic en "Agregar" en la tarjeta, mintiendo (todavía no
  // se había agregado nada, solo se abrió este modal). El nombre del
  // producto se guarda ANTES de resolver — resolveConflict(true) limpia
  // `pendingConflict` de inmediato.
  function handleReplace() {
    const productName = pendingConflict.product.name;
    resolveConflict(true);
    toast.success(`Carrito vaciado — "${productName}" agregado ✓`);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-surface-container-lowest p-6 shadow-lg">
        <AlertTriangle className="mb-3 h-8 w-8 text-secondary-container" />
        <h3 className="mb-2 text-title-lg text-on-surface">Tu carrito tiene otra tienda</h3>
        <p className="mb-6 text-body-md text-on-surface-variant">
          Tienes productos de <strong>{vendorName}</strong>. En {siteName} solo puedes comprar a un vendedor a la vez.
          ¿Quieres vaciar tu carrito y empezar un pedido nuevo con esta tienda?
        </p>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => resolveConflict(false)}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={handleReplace}>
            Vaciar y continuar
          </Button>
        </div>
      </div>
    </div>
  );
}
