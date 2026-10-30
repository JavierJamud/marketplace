import { env } from "../config/env.js";
import { emailShell, ctaButton, statusBadge, paragraph, resolveAssetUrl, pickVariant, esc } from "./_shared.js";
import { unsubscribeFooter } from "./customerReminders.js";

// Bloque 62: re-enganche: cliente que compró UNA sola vez en esta tienda hace 30+ días, y la tienda publicó una oferta de
// tienda nueva (ver vendorLifecycle.job.js). `offers`: [{ title, discountLabel, code, expiresAt, imageUrl? }]. Hoy siempre
// se llama con una sola oferta (la que disparó el envío).
// Título y etiqueta de descuento los escribe la tienda y el correo va a su cliente: se escapan (statusBadge no escapa).
function offerCardMjml(offer) {
  const imgSrc = resolveAssetUrl(offer.imageUrl);
  return `
    ${imgSrc ? `<mj-image src="${imgSrc}" alt="${esc(offer.title)}" border-radius="12px" padding="0 0 10px" />` : ""}
    <mj-text font-size="15px" font-weight="800" color="#1b1b1d" padding="0 0 4px">${esc(offer.title)}</mj-text>
    ${offer.discountLabel ? statusBadge(esc(offer.discountLabel), "#0CAE53") : ""}
    ${offer.code ? paragraph(`Usa el código <strong>${esc(offer.code)}</strong> al pagar${offer.expiresAt ? `, antes del ${new Date(offer.expiresAt).toLocaleDateString("es-CU", { day: "numeric", month: "long", timeZone: "America/Havana" })}` : ""}.`, { padding: "8px 0 4px" }) : ""}
  `;
}

// unsubscribeUrl: enlace firmado de baja (lib/marketingEmail.js). Es un correo de promoción, así que el pie lleva la baja
// igual que los recordatorios de carrito y puntos; sin enlace (llamada vieja) queda el pie normal.
export async function vendorWinbackEmail({ customer, vendor, offers, unsubscribeUrl }) {
  const subject = pickVariant(`${vendor.id}${customer.email}`, [`${vendor.companyName} tiene ofertas nuevas para ti`, `Novedades de ${vendor.companyName}`, `Lo nuevo en ${vendor.companyName}`]);
  const html = await emailShell({
    showSocial: true,
    footerNote: unsubscribeUrl ? unsubscribeFooter(unsubscribeUrl, { reason: "Te escribimos porque compraste en esta tienda.", label: "No quiero recibir estos correos" }) : undefined,
    preview: `${vendor.companyName} publicó ofertas nuevas. Mira lo que tienen ahora`,
    title: `${vendor.companyName} tiene algo nuevo para ti`,
    storeName: vendor.companyName,
    storeLogoUrl: resolveAssetUrl(vendor.logoUrl),
    accentColor: vendor.color || undefined,
    bodyMjml: `
      ${paragraph(`${customer.fullName ? `Hola ${esc(customer.fullName)}` : "Hola"}, hace un tiempo compraste en <strong>${esc(vendor.companyName)}</strong> y quieren avisarte que tienen algo nuevo:`)}
      ${offers.map(offerCardMjml).join("")}
      ${ctaButton("Ver la tienda", `${env.frontendUrl}/tienda/${vendor.slug}`)}
    `,
  });
  return { subject, html };
}
