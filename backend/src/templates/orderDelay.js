import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph, itemsTable, totalRow, esc, resolveAssetUrl } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { orderCurrency, orderShippingText, orderGrandTotal } from "../lib/orderSummary.js";
import { orderDetailsMjml } from "./newOrderVendor.js";

// Correos de un pedido detenido (services/orderDelay.service.js): a la tienda, para que lo mueva o le escriba al cliente, y al
// cliente, para que sepa que su pedido sigue en curso y cómo contactar a la tienda. Al cliente nunca se le culpa a la tienda.

// Nombre del estado como lo ve cada uno (los mismos del panel de la tienda y de "Mis pedidos").
export const DELAY_STAGE = {
  NEW: { vendor: "Pendiente", customer: "esperando la confirmación de la tienda" },
  PREPARING: { vendor: "Vendido", customer: "en preparación" },
  READY: { vendor: "En camino", customer: "en camino" },
};

const panelLink = (order) => `${env.frontendUrl}/vendedor/pedidos?ver=${order.id}&tipo=orden`;

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

// `order` trae items (con la foto del producto) y vendor.companyName.
export async function orderDelayVendorEmail({ order, hours }) {
  const { siteName } = await getBrandSettings();
  const stage = DELAY_STAGE[order.status]?.vendor ?? order.status;
  const subject = `El pedido ${order.code} lleva ${hours} h en "${stage}"`;
  const html = await emailShell({
    preview: `Le avisamos a ${order.customerName ?? "tu cliente"} que su pedido va con retraso.`,
    title: "Un pedido lleva mucho tiempo sin avanzar",
    badge: { label: `${stage} · ${hours} h`, color: "#8A5100" },
    accentColor: "#8A5100",
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${esc(order.vendor.companyName)}</strong>, el pedido <strong>${esc(order.code)}</strong> lleva <strong>${hours} horas</strong> en "${esc(stage)}" sin cambiar de estado.`)}
      ${paragraph(`Le avisamos a ${esc(order.customerName ?? "tu cliente")} que su pedido va con retraso y le dimos tus datos de contacto. Si ya lo entregaste, márcalo como entregado en tu panel; si hay algún problema, escríbele para contarle.`)}
      ${await orderDetailsMjml(order)}
      ${ctaButton("Actualizar el pedido", panelLink(order))}
      ${smallNote("Este aviso te llega siempre, aunque tengas apagado el correo de pedidos, porque hay un cliente esperando.")}
    `,
  });
  return { subject, html };
}

// order.vendor: { companyName, logoUrl, slug, whatsapp, email }
export async function orderDelayCustomerEmail({ order, hours }) {
  const v = order.vendor;
  const stage = DELAY_STAGE[order.status]?.customer ?? "en curso";
  const waDigits = String(v.whatsapp ?? "").replace(/\D/g, "");
  const waLink = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(`Hola ${v.companyName}, les escribo por mi pedido ${order.code}.`)}` : null;
  const storeUrl = `${String(env.frontendUrl).replace(/\/$/, "")}/tienda/${v.slug}`;
  const contactRows = [
    waDigits ? `<strong>WhatsApp y teléfono:</strong> <a href="tel:+${waDigits}" style="color:#337475;">${esc(v.whatsapp)}</a>` : null,
    v.email ? `<strong>Correo:</strong> <a href="mailto:${esc(v.email)}?subject=${encodeURIComponent(`Pedido ${order.code}`)}" style="color:#337475;">${esc(v.email)}</a>` : null,
  ].filter(Boolean);
  const intro =
    order.status === "NEW"
      ? `Tu pedido <strong>${esc(order.code)}</strong> en <strong>${esc(v.companyName)}</strong> lleva ${hours} horas esperando la confirmación de la tienda. Ya le recordamos que lo revise.`
      : `Tu pedido <strong>${esc(order.code)}</strong> en <strong>${esc(v.companyName)}</strong> sigue ${esc(stage)} desde hace ${hours} horas. Le avisamos a la tienda para que lo actualice.`;

  const subject = `Tu pedido ${order.code} va con retraso`;
  const html = await emailShell({
    preview: `Tu pedido sigue ${stage}. Te dejamos el contacto de la tienda por si quieres escribirle.`,
    title: "Tu pedido va con retraso",
    storeName: v.companyName,
    storeLogoUrl: resolveAssetUrl(v.logoUrl),
    accentColor: "#337475",
    badge: { label: "Con retraso", color: "#8A5100" },
    bodyMjml: `
      ${paragraph(`Hola${order.customerName ? ` ${esc(order.customerName)}` : ""}, ${intro}`)}
      ${paragraph(order.status === "READY" ? "Si ya lo recibiste, no tienes que hacer nada. Si todavía no te llega, escríbele a la tienda con tu número de pedido." : "No tienes que hacer nada: te avisaremos cuando cambie. Si quieres saber cómo va, escríbele a la tienda con tu número de pedido.")}
      ${contactRows.length ? paragraph(contactRows.join("<br/>"), { padding: "0 0 8px" }) : ""}
      ${waLink ? ctaButton("Escribir a la tienda por WhatsApp", waLink) : ctaButton(`Ver la tienda ${esc(v.companyName)}`, storeUrl)}
      ${itemsBlock(order)}
      ${smallNote(`Tu número de pedido es ${esc(order.code)}.`)}
    `,
  });
  return { subject, html };
}
