import { env } from "../config/env.js";
import { emailShell, ctaButton, statusBadge, paragraph, resolveAssetUrl } from "./_shared.js";

// Bloque 62: re-enganche — cliente que compró UNA sola vez en esta tienda
// hace 30+ días, y la tienda publicó una oferta activa nueva desde
// entonces (ver vendorLifecycle.job.js). `offers`: Offer[] (título,
// imageUrl, discountLabel) — un correo puede traer más de una si el job
// las agrupó, aunque hoy siempre se llama con una sola oferta (la que
// disparó el envío).
function offerCardMjml(offer) {
  const imgSrc = resolveAssetUrl(offer.imageUrl);
  return `
    ${imgSrc ? `<mj-image src="${imgSrc}" alt="${offer.title}" border-radius="12px" padding="0 0 10px" />` : ""}
    <mj-text font-size="15px" font-weight="800" color="#1b1b1d" padding="0 0 4px">${offer.title}</mj-text>
    ${offer.discountLabel ? statusBadge(offer.discountLabel, "#0CAE53") : ""}
  `;
}

export async function vendorWinbackEmail({ customer, vendor, offers }) {
  const subject = `${vendor.companyName} tiene ofertas nuevas para ti`;
  const html = await emailShell({
    preview: `${vendor.companyName} publicó ofertas nuevas — mira lo que tienen ahora`,
    title: `${vendor.companyName} tiene algo nuevo para ti`,
    storeName: vendor.companyName,
    storeLogoUrl: resolveAssetUrl(vendor.logoUrl),
    accentColor: vendor.color || undefined,
    bodyMjml: `
      ${paragraph(`Hola ${customer.fullName ?? ""}, hace un tiempo compraste en <strong>${vendor.companyName}</strong> — quisieron avisarte que tienen algo nuevo:`)}
      ${offers.map(offerCardMjml).join("")}
      ${ctaButton("Ver la tienda", `${env.frontendUrl}/tienda/${vendor.slug}`)}
    `,
  });
  return { subject, html };
}
