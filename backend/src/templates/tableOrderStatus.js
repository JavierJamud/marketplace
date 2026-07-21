import { emailShell, statusBadge } from "./_shared.js";

// Mismos 3 estados de KitchenStatus (schema.prisma), no una paleta paralela.
const STATUS_LABEL = { RECEIVED: "Recibido", PREPARING: "Preparando", READY: "Listo para retirar" };
const STATUS_COLOR = { RECEIVED: "#337475", PREPARING: "#8A5100", READY: "#0A8F42" };

export function tableOrderStatusEmail({ vendorName, tableNumber, kitchenStatus }) {
  const label = STATUS_LABEL[kitchenStatus] ?? kitchenStatus;
  const color = STATUS_COLOR[kitchenStatus] ?? "#75777c";
  const subject = `Tu pedido de mesa en ${vendorName}: ${label}`;
  const html = emailShell({
    title: `Mesa ${tableNumber} — ${vendorName}`,
    storeName: vendorName,
    bodyHtml: `
      <p style="color:#44474c;font-size:14px;line-height:21px;">Tu pedido cambió de estado:</p>
      <div style="margin:16px 0;">${statusBadge(label, color)}</div>
    `,
  });
  return { subject, html };
}
