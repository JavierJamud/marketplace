import { prisma } from "./prisma.js";

// Etiquetas de cada tipo de movimiento de un pedido (se muestran en el historial del panel y en los PDF).
export const ORDER_EVENT_LABEL = {
  CREATED: "Pedido recibido",
  CONFIRMED: "Venta confirmada por la tienda",
  PREPARING: "En preparación",
  READY: "Listo para entregar",
  DELIVERED: "Entregado al cliente",
  CANCELLED: "Pedido cancelado",
  INVOICE_SENT: "Factura enviada al cliente",
  INVOICE_DOWNLOADED: "Factura generada",
  WARRANTY_SENT: "Garantía enviada al cliente",
  WARRANTY_DOWNLOADED: "Garantía generada",
};

// Anota un movimiento. Nunca rompe lo que lo llamó: si falla el registro, la acción principal ya se hizo.
export async function recordOrderEvent(orderId, type, detail = null, client = prisma) {
  try {
    await client.orderEvent.create({ data: { orderId, type, detail } });
  } catch {
    /* el historial es auxiliar */
  }
}
