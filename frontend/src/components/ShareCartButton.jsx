import { useMutation } from "@tanstack/react-query";
import toast from "../lib/toast.jsx";
import { Share2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useCart } from "../context/CartContext.jsx";
import { copyToClipboard } from "../lib/clipboard.js";

// Bloque 54: genera un link público de un solo uso (SharedCart, ver
// sharedCart.controller.js) con los ítems ACTUALES del carrito — nunca
// guarda precio/nombre, se resuelven contra el catálogo real recién cuando
// el otro cliente abre el link (así nunca muestra un precio vencido). Se
// reusa igual en Cart.jsx (página completa) y CartDrawer.jsx (mini-carrito).
export function ShareCartButton({ className, iconOnly = false }) {
  const { vendorId, items } = useCart();

  const share = useMutation({
    mutationFn: async () =>
      (
        await api.post("/shared-carts", {
          vendorId,
          items: items.map((i) => ({ productId: i.productId, quantity: i.quantity, size: i.size ?? undefined })),
        })
      ).data,
    onSuccess: ({ id }) => {
      const url = `${window.location.origin}/carrito-compartido/${id}`;
      copyToClipboard(url)
        .then(() => toast.success("¡Enlace copiado! Compártelo para que vean y agreguen los mismos productos."))
        .catch(() => toast.error("No se pudo copiar el enlace."));
    },
    onError: (err) => toast.error(err.response?.data?.error ?? "No se pudo compartir el carrito."),
  });

  return (
    <button
      type="button"
      onClick={() => share.mutate()}
      disabled={share.isPending || items.length === 0}
      title="Compartir carrito"
      className={
        className ??
        "flex items-center gap-1.5 text-[12.5px] font-semibold text-tertiary-accent hover:underline disabled:cursor-not-allowed disabled:opacity-50"
      }
    >
      {/* Bloque 149 (pedido explícito — "elimina la animación del botón de
          compartir"): antes tenía un anillo pulsante (`animate-ping`) detrás
          del ícono cuando se usaba con `animated` (solo en CartDrawer.jsx) —
          se saca del todo, sin dejar la prop muerta. */}
      <Share2 className="h-3.5 w-3.5 flex-shrink-0" />
      {!iconOnly && <span>{share.isPending ? "Generando enlace..." : "Compartir carrito"}</span>}
    </button>
  );
}
