import { env } from "../config/env.js";
import { emailShell, ctaButton, paragraph, resolveAssetUrl } from "./_shared.js";

// order: { code, vendor: {companyName, color} }, subject/message: texto que escribió el vendedor
export async function vendorMessageEmail({ order, subject, message }) {
  // Pedido explícito (Bloque 49): todo asunto necesita algo que lo distinga
  // (nombre de cliente/vendedor, número de referencia) para no verse
  // idéntico en filtros anti-spam — acá el vendedor escribe el asunto libre,
  // así que se le agrega el código de pedido si no lo puso ya.
  const finalSubject = subject.includes(order.code) ? subject : `${subject} (Pedido ${order.code})`;
  const html = await emailShell({
    preview: message.slice(0, 120),
    title: subject,
    storeName: order.vendor.companyName,
    storeLogoUrl: resolveAssetUrl(order.vendor.logoUrl),
    // Si la tienda tiene su propio color de marca, el header lo usa — si no,
    // cae al navy genérico de la plataforma (mismo comportamiento que el
    // avatar de la tienda en VendorLayout/Store.jsx).
    accentColor: order.vendor.color || undefined,
    bodyMjml: `
      ${paragraph(`Mensaje de <strong style="color:#1b1b1d;">${order.vendor.companyName}</strong> sobre tu pedido ${order.code}`, { color: "#75777c", size: "12.5px", padding: "0 0 14px" })}
      ${paragraph(message.replace(/\n/g, "<br/>"), { color: "#44474c", size: "14px", lineHeight: "22px" })}
      ${ctaButton("Ver mi pedido", `${env.frontendUrl}/cuenta/panel`)}
    `,
  });
  return { subject: finalSubject, html };
}
