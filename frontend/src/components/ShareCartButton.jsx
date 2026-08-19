import { useMutation } from "@tanstack/react-query";
import toast from "../lib/toast.jsx";
import { Share2 } from "lucide-react";
import { api } from "../lib/api.js";
import { useCart } from "../context/CartContext.jsx";

// Bloque 54: genera un link público de un solo uso (SharedCart, ver
// sharedCart.controller.js) con los ítems ACTUALES del carrito — nunca
// guarda precio/nombre, se resuelven contra el catálogo real recién cuando
// el otro cliente abre el link (así nunca muestra un precio vencido). Se
// reusa igual en Cart.jsx (página completa) y CartDrawer.jsx (mini-carrito).
export function ShareCartButton({ className, iconOnly = false, animated = false }) {
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
      navigator.clipboard
        .writeText(url)
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
      <span className="relative inline-flex h-3.5 w-3.5 flex-shrink-0">
        {/* Anillo pulsante detrás del ícono — "esto se puede compartir",
            sin ser tan invasivo como animar el ícono en sí. Se apaga solo
            mientras se genera el enlace (share.isPending), para no seguir
            "invitando a hacer clic" en un botón ya ocupado. */}
        {animated && !share.isPending && (
          <span className="absolute inset-0 animate-ping rounded-full bg-tertiary-accent/50" />
        )}
        <Share2 className="relative h-3.5 w-3.5" />
      </span>
      {!iconOnly && <span>{share.isPending ? "Generando enlace..." : "Compartir carrito"}</span>}
    </button>
  );
}
