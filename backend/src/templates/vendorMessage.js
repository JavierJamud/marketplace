import { env } from "../config/env.js";
import { emailShell, ctaButton } from "./_shared.js";

// order: { code, vendor: {companyName, color} }, subject/message: texto que escribió el vendedor
export function vendorMessageEmail({ order, subject, message }) {
  const html = emailShell({
    title: subject,
    storeName: order.vendor.companyName,
    // Si la tienda tiene su propio color de marca, el header lo usa — si no,
    // cae al navy genérico de la plataforma (mismo comportamiento que el
    // avatar de la tienda en VendorLayout/Store.jsx).
    accentColor: order.vendor.color || undefined,
    bodyHtml: `
      <p style="color:#75777c;font-size:12.5px;margin:0 0 14px;">Mensaje de <strong style="color:#1b1b1d;">${order.vendor.companyName}</strong> sobre tu pedido ${order.code}</p>
      <p style="color:#44474c;font-size:14px;line-height:22px;white-space:pre-wrap;">${message}</p>
      ${ctaButton("Ver mi pedido", `${env.frontendUrl}/cuenta/panel`)}
    `,
  });
  return { subject, html };
}
