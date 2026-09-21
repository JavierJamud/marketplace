import { env } from "../config/env.js";
import { emailShell, ctaButton, itemsTable, totalRow, paragraph, fmtCUP, resolveAssetUrl } from "./_shared.js";

// Mismos labels/colores que VendorOrders.jsx y CustomerPanel.jsx — una sola
// paleta de estados en todo el sistema, no una paralela para email.
const STATUS_LABEL = { NEW: "Nuevo", PREPARING: "Preparando", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Cancelado" };
const STATUS_COLOR = { NEW: "#337475", PREPARING: "#8A5100", READY: "#0A8F42", DELIVERED: "#0CAE53", CANCELLED: "#ba1a1a" };

// Bloque 231 (pedido explícito — "las plantillas de correo... deben
// contener más información de su pedido para que el cliente sepa qué
// artículos son"): antes este correo NO llevaba ningún artículo, solo el
// cambio de estado — ahora reusa la misma tabla con fotos que ya usa
// orderConfirmationEmail, así el cliente no tiene que volver al correo
// original para recordar qué pidió.
// order: { code, vendor: {companyName}, status, items?: [{..., product?: {images}}], total? }
export async function statusUpdateEmail(order) {
  const label = STATUS_LABEL[order.status] ?? order.status;
  const color = STATUS_COLOR[order.status] ?? "#75777c";
  const subject = `Tu pedido ${order.code} ahora está: ${label}`;
  const itemsWithImages = (order.items ?? []).map((i) => ({ ...i, imageUrl: resolveAssetUrl(i.product?.images?.[0]) }));
  const html = await emailShell({
    preview: `${order.vendor.companyName} actualizó tu pedido ${order.code} a "${label}"`,
    title: "Actualización de tu pedido",
    storeName: order.vendor.companyName,
    storeLogoUrl: resolveAssetUrl(order.vendor.logoUrl),
    accentColor: color,
    badge: { label, color },
    bodyMjml: `
      ${paragraph(`Tu pedido <strong>${order.code}</strong> en <strong>${order.vendor.companyName}</strong> cambió de estado:`)}
      ${itemsWithImages.length > 0 ? itemsTable(itemsWithImages) : ""}
      ${order.total != null ? totalRow("Total", fmtCUP(order.total)) : ""}
      ${ctaButton("Ver detalles", `${env.frontendUrl}/cuenta/panel`)}
    `,
  });
  return { subject, html };
}
