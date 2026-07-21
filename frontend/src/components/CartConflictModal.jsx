import { useCart } from "../context/CartContext.jsx";
import { Button } from "./ui/Button.jsx";
import { AlertTriangle } from "lucide-react";

// Cuando el cliente intenta agregar un producto de otra tienda mientras ya
// tiene un carrito activo. Regla de negocio: un solo vendedor a la vez.
export function CartConflictModal() {
  const { pendingConflict, resolveConflict, vendorName } = useCart();

  if (!pendingConflict) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-inverse-surface/40 p-4">
      <div className="w-full max-w-sm rounded-lg bg-surface-container-lowest p-6 shadow-lg">
        <AlertTriangle className="mb-3 h-8 w-8 text-secondary-container" />
        <h3 className="mb-2 text-title-lg text-on-surface">Tu carrito tiene otra tienda</h3>
        <p className="mb-6 text-body-md text-on-surface-variant">
          Tienes productos de <strong>{vendorName}</strong>. En ZeuDin solo puedes comprar a un vendedor a la vez.
          ¿Quieres vaciar tu carrito y empezar un pedido nuevo con esta tienda?
        </p>
        <div className="flex gap-3">
          <Button variant="outline" className="flex-1" onClick={() => resolveConflict(false)}>
            Cancelar
          </Button>
          <Button className="flex-1" onClick={() => resolveConflict(true)}>
            Vaciar y continuar
          </Button>
        </div>
      </div>
    </div>
  );
}
