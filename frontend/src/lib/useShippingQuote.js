import { useQuery, keepPreviousData } from "@tanstack/react-query";
import { api } from "./api.js";

// Envío que el servidor cobraría por este carrito (el mismo cálculo que al crear el pedido, ver backend lib/shipping.js).
// Se vuelve a pedir al cambiar productos, cantidades o la provincia de entrega.
export function useShippingQuote({ vendorId, items, provinceId = null }) {
  const lines = (items ?? []).map((i) => ({ productId: i.productId, quantity: i.quantity }));
  return useQuery({
    queryKey: ["shipping-quote", vendorId, provinceId, lines],
    queryFn: async () => (await api.post("/orders/shipping-quote", { vendorId, provinceId, items: lines })).data.shipping,
    enabled: !!vendorId && lines.length > 0,
    placeholderData: keepPreviousData,
    staleTime: 30_000,
  });
}
