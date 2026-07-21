import { env } from "../config/env.js";
import { emailShell, ctaButton, statusBadge } from "./_shared.js";

// Mismos labels/colores que VendorOrders.jsx y CustomerPanel.jsx — una sola
// paleta de estados en todo el sistema, no una paralela para email.
const STATUS_LABEL = { NEW: "Nuevo", PREPARING: "Preparando", READY: "Listo", DELIVERED: "Entregado", CANCELLED: "Cancelado" };
const STATUS_COLOR = { NEW: "#337475", PREPARING: "#8A5100", READY: "#0A8F42", DELIVERED: "#0CAE53", CANCELLED: "#ba1a1a" };

// order: { code, vendor: {companyName}, status }
export function statusUpdateEmail(order) {
  const label = STATUS_LABEL[order.status] ?? order.status;
  const color = STATUS_COLOR[order.status] ?? "#75777c";
  const subject = `Tu pedido ${order.code} ahora está: ${label}`;
  const html = emailShell({
    title: "Actualización de tu pedido",
    storeName: order.vendor.companyName,
    bodyHtml: `
      <p style="color:#44474c;font-size:14px;line-height:21px;">Tu pedido <strong>${order.code}</strong> en <strong>${order.vendor.companyName}</strong> cambió de estado:</p>
      <div style="margin:16px 0;">${statusBadge(label, color)}</div>
      ${ctaButton("Ver detalles", `${env.frontendUrl}/cuenta/panel`)}
    `,
  });
  return { subject, html };
}
