import { env } from "../config/env.js";
import { emailShell, ctaButton, itemsTable, totalRow, paragraph, smallNote, resolveAssetUrl, esc } from "./_shared.js";
import { money, orderCurrency } from "../lib/orderSummary.js";

// Correo para el cliente que intentó cancelar un pedido que la tienda ya empezó a atender (en preparación, en camino o entregado).
// Desde la plataforma solo se cancela un pedido mientras la tienda no lo confirma; después hay que hablar con la tienda. Este correo
// le dice exactamente qué pedido es, en qué estado está y cómo contactar a la tienda para pedir la cancelación.

const STATUS_LABEL = { NEW: "Recibido", PREPARING: "En preparación", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Cancelado" };
const STATUS_COLOR = { NEW: "#337475", PREPARING: "#8A5100", READY: "#0A8F42", DELIVERED: "#0CAE53", CANCELLED: "#ba1a1a" };

// order: { code, status, total, customerName, items: [{..., product?: {images}}], vendor: { companyName, slug, whatsapp, email, companyAddress, logoUrl } }
export async function orderCancelHelpEmail(order) {
  const v = order.vendor;
  const label = STATUS_LABEL[order.status] ?? order.status;
  const color = STATUS_COLOR[order.status] ?? "#65676c";
  const waDigits = String(v.whatsapp ?? "").replace(/\D/g, "");
  const waLink = waDigits ? `https://wa.me/${waDigits}?text=${encodeURIComponent(`Hola, quiero cancelar mi pedido ${order.code}.`)}` : null;
  const storeUrl = `${String(env.frontendUrl).replace(/\/$/, "")}/tienda/${v.slug}`;
  const items = (order.items ?? []).map((i) => ({ ...i, imageUrl: resolveAssetUrl(i.product?.images?.[0]) }));

  const contactRows = [
    waDigits ? `<strong>WhatsApp:</strong> ${esc(v.whatsapp)}` : null,
    v.email ? `<strong>Correo:</strong> ${esc(v.email)}` : null,
    v.companyAddress ? `<strong>Dirección:</strong> ${esc(v.companyAddress)}` : null,
  ].filter(Boolean);

  const subject = `Cómo cancelar tu pedido ${order.code}`;
  const html = await emailShell({
    preview: `Tu pedido ${order.code} ya está ${label.toLowerCase()}: así puedes pedir su cancelación`,
    title: "Sobre la cancelación de tu pedido",
    storeName: v.companyName,
    storeLogoUrl: resolveAssetUrl(v.logoUrl),
    accentColor: color,
    badge: { label, color },
    bodyMjml: `
      ${paragraph(`Hola${order.customerName ? ` ${esc(order.customerName)}` : ""}, recibimos tu solicitud para cancelar el pedido <strong>${esc(order.code)}</strong> de <strong>${esc(v.companyName)}</strong>.`)}
      ${paragraph(
        `Un pedido solo se puede cancelar desde ${esc("la plataforma")} <strong>antes de que la tienda lo confirme</strong> y empiece a prepararlo o enviarlo. El tuyo ya está <strong>${esc(label.toLowerCase())}</strong>, así que <strong>no lo cancelamos</strong>: tienes que pedírselo directamente a la tienda, que decide cómo resolverlo.`
      )}
      ${items.length ? itemsTable(items) : ""}
      ${order.total != null ? totalRow("Total", money(order.total, orderCurrency(order))) : ""}
      ${paragraph(`<strong>Cómo cancelarlo con la tienda</strong><br/>1. Contacta a ${esc(v.companyName)} por uno de estos medios.<br/>2. Dile tu número de pedido <strong>${esc(order.code)}</strong> y que quieres cancelarlo.<br/>3. Si el pedido ya va en camino o fue entregado, la tienda te dirá si es posible y cómo.`, { padding: "14px 0 6px" })}
      ${contactRows.length ? paragraph(contactRows.join("<br/>"), { padding: "0 0 8px" }) : ""}
      ${waLink ? ctaButton("Escribir a la tienda por WhatsApp", waLink) : ctaButton(`Ver la tienda ${esc(v.companyName)}`, storeUrl)}
      ${smallNote(`También puedes ver los datos de la tienda en <a href="${storeUrl}" style="color:#337475;">${esc(storeUrl.replace(/^https?:\/\//, ""))}</a>.`)}
    `,
  });
  return { subject, html };
}
