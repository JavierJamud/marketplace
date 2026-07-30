import { emailShell, paragraph } from "./_shared.js";

// Mismos 3 estados de KitchenStatus (schema.prisma), no una paleta paralela.
const STATUS_LABEL = { RECEIVED: "Recibido", PREPARING: "Preparando", READY: "Listo para retirar" };
const STATUS_COLOR = { RECEIVED: "#337475", PREPARING: "#8A5100", READY: "#0A8F42" };

export async function tableOrderStatusEmail({ vendorName, tableNumber, kitchenStatus }) {
  const label = STATUS_LABEL[kitchenStatus] ?? kitchenStatus;
  const color = STATUS_COLOR[kitchenStatus] ?? "#75777c";
  // Bloque 49: se agrega el número de mesa — junto con vendorName ya
  // distingue cada envío (varias mesas de la misma tienda no comparten
  // asunto idéntico).
  const subject = `Mesa ${tableNumber} en ${vendorName}: ${label}`;
  const html = await emailShell({
    preview: `Tu pedido de la mesa ${tableNumber} en ${vendorName} ahora está: ${label}`,
    title: `Mesa ${tableNumber} — ${vendorName}`,
    storeName: vendorName,
    accentColor: color,
    badge: { label, color },
    bodyMjml: `
      ${paragraph("Tu pedido cambió de estado:")}
    `,
  });
  return { subject, html };
}
