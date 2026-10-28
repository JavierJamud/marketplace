import { prisma } from "./prisma.js";
import { notifyCustomerOrderEvent } from "./notify.js";

// Etiquetas de cada tipo de movimiento de un pedido (se muestran en el historial del panel y en los PDF).
export const ORDER_EVENT_LABEL = {
  CREATED: "Pedido recibido",
  CONFIRMED: "Venta confirmada por la tienda",
  PREPARING: "En preparación",
  READY: "Listo para entregar",
  DELIVERED: "Entregado al cliente",
  CANCELLED: "Pedido cancelado",
  REMINDER_SENT: "Recordatorio a la tienda: pedido sin respuesta",
  CANCEL_WARNING_SENT: "Aviso a la tienda: el pedido se cerrará si no lo responde",
  AUTO_CANCELLED: "Cerrado por el sistema: la tienda no lo confirmó a tiempo",
  REACTIVATED: "Reactivado por la tienda",
  EDITED_BY_CUSTOMER: "Productos modificados por el cliente",
  INVOICE_SENT: "Factura enviada al cliente",
  INVOICE_DOWNLOADED: "Factura generada",
  WARRANTY_SENT: "Garantía enviada al cliente",
  WARRANTY_DOWNLOADED: "Garantía generada",
  DELAY_NOTICE: "Aviso de retraso a la tienda y al cliente",
};

// Anota un movimiento. Nunca rompe lo que lo llamó: si falla el registro, la acción principal ya se hizo.
export async function recordOrderEvent(orderId, type, detail = null, client = prisma) {
  try {
    await client.orderEvent.create({ data: { orderId, type, detail } });
    void notifyCustomerOrderEvent(orderId, type, detail).catch(() => {});
  } catch {
    /* el historial es auxiliar */
  }
}
