import { env } from "../config/env.js";
import { emailShell, ctaButton, paragraph, resolveAssetUrl } from "./_shared.js";

// Mismos labels/colores que VendorOrders.jsx y CustomerPanel.jsx — una sola
// paleta de estados en todo el sistema, no una paralela para email.
const STATUS_LABEL = { NEW: "Nuevo", PREPARING: "Preparando", READY: "Listo", DELIVERED: "Entregado", CANCELLED: "Cancelado" };
const STATUS_COLOR = { NEW: "#337475", PREPARING: "#8A5100", READY: "#0A8F42", DELIVERED: "#0CAE53", CANCELLED: "#ba1a1a" };

// order: { code, vendor: {companyName}, status }
export async function statusUpdateEmail(order) {
  const label = STATUS_LABEL[order.status] ?? order.status;
  const color = STATUS_COLOR[order.status] ?? "#75777c";
  const subject = `Tu pedido ${order.code} ahora está: ${label}`;
  const html = await emailShell({
    preview: `${order.vendor.companyName} actualizó tu pedido ${order.code} a "${label}"`,
    title: "Actualización de tu pedido",
    storeName: order.vendor.companyName,
    storeLogoUrl: resolveAssetUrl(order.vendor.logoUrl),
    accentColor: color,
    badge: { label, color },
    bodyMjml: `
      ${paragraph(`Tu pedido <strong>${order.code}</strong> en <strong>${order.vendor.companyName}</strong> cambió de estado:`)}
      ${ctaButton("Ver detalles", `${env.frontendUrl}/cuenta/panel`)}
    `,
  });
  return { subject, html };
}
