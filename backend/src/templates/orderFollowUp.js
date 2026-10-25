import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph, itemsTable, totalRow, esc, resolveAssetUrl } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { orderCurrency, orderShippingText, orderGrandTotal } from "../lib/orderSummary.js";
import { orderDetailsMjml } from "./newOrderVendor.js";

// Correos de un pedido que la tienda no responde (services/orderFollowUp.service.js): tres a la tienda (recordatorio, aviso
// de que se cerrará y cierre) y dos al cliente (pedido cerrado y pedido reactivado).
// Al cliente nunca se le culpa a la tienda: el pedido "no se confirmó a tiempo", y se le dan los datos de contacto para
// retomarlo directamente con ella.

// Fecha y hora en Cuba, como la lee una persona: "domingo, 27 de octubre, 2:00 p. m.".
export function cubaDateTime(d) {
  return new Date(d).toLocaleString("es-CU", { weekday: "long", day: "numeric", month: "long", hour: "numeric", minute: "2-digit", hour12: true, timeZone: "America/Havana" });
}

const panelLink = (order) => `${env.frontendUrl}/vendedor/pedidos?ver=${order.id}&tipo=orden`;
const ALWAYS_NOTE = "Este aviso te llega siempre, aunque tengas apagado el correo de pedidos nuevos, porque hay un cliente esperando tu respuesta.";

const VENDOR_COPY = {
  reminder: ({ order, hours, closesAt }) => ({
    subject: `Recordatorio: el pedido ${order.code} sigue esperando tu respuesta`,
    title: "Un cliente sigue esperando tu respuesta",
    badge: { label: `Sin respuesta · ${hours} h`, color: "#8A5100" },
    intro: [
      `Hola equipo de <strong>${esc(order.vendor.companyName)}</strong>, el pedido <strong>${esc(order.code)}</strong> lleva <strong>${hours} horas</strong> sin respuesta y ${esc(order.customerName ?? "el cliente")} sigue esperando.`,
      `Confírmalo en tu panel, o recházalo con un motivo si no puedes atenderlo. Si no lo respondes, el sistema lo cerrará el <strong>${esc(cubaDateTime(closesAt))}</strong> (hora de Cuba) y le avisará al cliente.`,
    ],
    cta: "Responder el pedido",
  }),
  warning: ({ order, hours, closesAt }) => ({
    subject: `El pedido ${order.code} se cerrará el ${cubaDateTime(closesAt)} si no lo respondes`,
    title: "Este pedido se cerrará pronto",
    badge: { label: "Se cerrará pronto", color: "#ba1a1a" },
    intro: [
      `Hola equipo de <strong>${esc(order.vendor.companyName)}</strong>, el pedido <strong>${esc(order.code)}</strong> lleva <strong>${hours} horas</strong> sin respuesta.`,
      `Si no lo confirmas o lo rechazas antes del <strong>${esc(cubaDateTime(closesAt))}</strong> (hora de Cuba), el sistema lo cerrará y le dirá al cliente que la tienda no alcanzó a confirmarlo a tiempo.`,
      "Si ya hablaste con el cliente por WhatsApp o por teléfono, confírmalo en el panel para que no se cierre.",
    ],
    cta: "Responder el pedido",
  }),
  cancelled: ({ order, hours }) => ({
    subject: `Cerramos el pedido ${order.code} porque no tuvo respuesta`,
    title: "Cerramos un pedido sin respuesta",
    badge: { label: "Cerrado sin respuesta", color: "#65676c" },
    intro: [
      `Hola equipo de <strong>${esc(order.vendor.companyName)}</strong>, el pedido <strong>${esc(order.code)}</strong> pasó <strong>${hours} horas</strong> sin confirmar, así que lo cerramos y le avisamos a ${esc(order.customerName ?? "el cliente")}.`,
      "Al cliente le dijimos que la tienda no alcanzó a confirmarlo a tiempo, sin dar otro motivo, y le pasamos tus datos de contacto para que pueda escribirte.",
      "Si te escribe y todavía puedes atenderlo, abre el pedido en tu panel y toca <strong>Reactivar pedido</strong>: vuelve a quedar pendiente y el cliente recibe un aviso de que lo estás revisando.",
    ],
    cta: "Ver el pedido en mi panel",
  }),
};

// stage: reminder | warning | cancelled. `order` trae items (con la foto del producto) y vendor.companyName.
export async function orderFollowUpVendorEmail({ stage, order, hours, closesAt }) {
  const { siteName } = await getBrandSettings();
  const copy = VENDOR_COPY[stage]({ order, hours, closesAt });
  const html = await emailShell({
    preview: copy.title,
    title: copy.title,
    badge: copy.badge,
    accentColor: copy.badge.color,
    storeName: siteName,
    bodyMjml: `
      ${copy.intro.map((p) => paragraph(p)).join("\n")}
      ${await orderDetailsMjml(order)}
      ${ctaButton(copy.cta, panelLink(order))}
      ${smallNote(ALWAYS_NOTE)}
    `,
  });
  return { subject: copy.subject, html };
}

// Mensaje que el cliente le manda a la tienda por WhatsApp desde el correo o desde su cuenta. Lo comparte el frontend
// (lib/orderFollowUp.js) para que diga lo mismo en todos lados.
export function reopenWhatsappText(order, siteName) {
  return `Hola ${order.vendor.companyName}, hice el pedido ${order.code} en ${siteName} y se cerró porque no se confirmó a tiempo. ¿Todavía pueden atenderlo?`;
}

function itemsBlock(order) {
  const currency = orderCurrency(order);
  const items = (order.items ?? []).map((i) => ({ name: i.name, size: i.size, quantity: i.quantity, price: i.price, currency: i.currency ?? currency, imageUrl: resolveAssetUrl(i.product?.images?.[0]) }));
  if (!items.length) return "";
  return `
      ${itemsTable(items)}
      ${totalRow("Envío", orderShippingText(order))}
      ${totalRow("Total", orderGrandTotal(order))}
  `;
}

// order.vendor: { companyName, logoUrl, slug, whatsapp, email, companyAddress }
export async function orderAutoCancelledCustomerEmail({ order, hours }) {
  const { siteName } = await getBrandSettings();
  const v = order.vendor;
  const waDigits = String(v.whatsapp ?? "").replace(/\D/g, "");
  const waLink = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(reopenWhatsappText(order, siteName))}` : null;
  const storeUrl = `${String(env.frontendUrl).replace(/\/$/, "")}/tienda/${v.slug}`;
  const contactRows = [
    waDigits ? `<strong>WhatsApp y teléfono:</strong> <a href="tel:+${waDigits}" style="color:#337475;">${esc(v.whatsapp)}</a>` : null,
    v.email ? `<strong>Correo:</strong> <a href="mailto:${esc(v.email)}?subject=${encodeURIComponent(`Pedido ${order.code}`)}" style="color:#337475;">${esc(v.email)}</a>` : null,
    v.companyAddress ? `<strong>Dirección:</strong> ${esc(v.companyAddress)}` : null,
  ].filter(Boolean);

  const subject = `Tu pedido ${order.code} no se confirmó a tiempo`;
  const html = await emailShell({
    preview: `${v.companyName} no alcanzó a confirmar tu pedido. Puedes escribirle directo para retomarlo.`,
    title: "Tu pedido no se confirmó a tiempo",
    storeName: esc(v.companyName),
    storeLogoUrl: resolveAssetUrl(v.logoUrl),
    accentColor: "#337475",
    badge: { label: "Cerrado sin confirmar", color: "#65676c" },
    bodyMjml: `
      ${paragraph(`Hola${order.customerName ? ` ${esc(order.customerName)}` : ""}, <strong>${esc(v.companyName)}</strong> no alcanzó a confirmar tu pedido <strong>${esc(order.code)}</strong> en ${hours} horas, así que lo cerramos para que no sigas esperando.`)}
      ${paragraph("Puede pasar cuando una tienda tiene muchos pedidos o no ha podido revisar su panel estos días. Si ya hiciste algún pago o transferencia, escríbele a la tienda con tu número de pedido para resolverlo.")}
      ${paragraph(`<strong>¿Todavía quieres estos productos?</strong><br/>Escríbele directo a la tienda con tu número de pedido <strong>${esc(order.code)}</strong>. Si lo retoma, la tienda puede reactivar este mismo pedido y te avisaremos por aquí.`, { padding: "6px 0 8px" })}
      ${contactRows.length ? paragraph(contactRows.join("<br/>"), { padding: "0 0 8px" }) : ""}
      ${waLink ? ctaButton("Escribir a la tienda por WhatsApp", waLink) : ctaButton(`Ver la tienda ${esc(v.companyName)}`, storeUrl)}
      ${itemsBlock(order)}
      ${smallNote(`Tu número de pedido es ${esc(order.code)}. También puedes ver los datos de la tienda en <a href="${storeUrl}" style="color:#337475;">${esc(storeUrl.replace(/^https?:\/\//, ""))}</a>.`)}
    `,
  });
  return { subject, html };
}

export async function orderReactivatedCustomerEmail({ order }) {
  const v = order.vendor;
  const subject = `Tu pedido ${order.code} está activo otra vez`;
  const html = await emailShell({
    preview: `${v.companyName} retomó tu pedido ${order.code} y lo está revisando.`,
    title: "La tienda retomó tu pedido",
    storeName: esc(v.companyName),
    storeLogoUrl: resolveAssetUrl(v.logoUrl),
    accentColor: "#337475",
    badge: { label: "Reactivado", color: "#337475" },
    bodyMjml: `
      ${paragraph(`Hola${order.customerName ? ` ${esc(order.customerName)}` : ""}, <strong>${esc(v.companyName)}</strong> reactivó tu pedido <strong>${esc(order.code)}</strong> y lo está revisando. Te avisaremos en cuanto lo confirme.`)}
      ${itemsBlock(order)}
      ${ctaButton("Ver el avance del pedido", `${env.frontendUrl}/rastrear-pedido?pedido=${encodeURIComponent(order.code)}`)}
    `,
  });
  return { subject, html };
}
