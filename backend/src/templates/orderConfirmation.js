import { channelLabel } from "../lib/catalog.js";
import { env } from "../config/env.js";
import { emailShell, ctaButton, itemsTable, totalRow, metaList, paragraph, smallNote, resolveAssetUrl, esc, orderProgress } from "./_shared.js";
import { orderCurrency, money, orderShippingText, orderGrandTotal, deliveryPlace, ID_TYPE_LABEL } from "../lib/orderSummary.js";

// Comprobante del pedido para el cliente. Lleva todo lo que necesita para seguirlo sin abrir la web: productos con su precio en
// la moneda del pedido, descuentos y puntos usados, quién recibe (si es otra persona, con su documento), dónde y cómo se paga,
// y cómo contactar a la tienda. Los importes van en la moneda real de los productos (antes decía siempre CUP).
// order: { code, createdAt, customerName/Phone/Email, recipient*, vendor: {companyName, whatsapp, logoUrl}, items, total, ... }
export async function orderConfirmationEmail(order) {
  const currency = orderCurrency(order);
  const place = await deliveryPlace(order);
  const subject = `Pedido ${order.code} recibido en ${order.vendor.companyName}`;
  const itemsWithImages = order.items.map((i) => ({ ...i, imageUrl: resolveAssetUrl(i.product?.images?.[0]) }));
  const subtotal = order.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
  const whatsapp = order.vendor.whatsapp ? String(order.vendor.whatsapp).replace(/\D/g, "") : null;
  const html = await emailShell({
    preview: `Recibimos tu pedido ${order.code}: ${orderGrandTotal(order)} en ${order.vendor.companyName}`,
    title: `¡Gracias por tu pedido en ${order.vendor.companyName}!`,
    storeName: order.vendor.companyName,
    storeLogoUrl: resolveAssetUrl(order.vendor.logoUrl),
    badge: { label: "Pedido recibido", color: "#0CAE53" },
    bodyMjml: `
      ${paragraph(`Hola ${esc(order.customerName)}, tu pedido <strong>${esc(order.code)}</strong> quedó registrado. La tienda lo revisa y te avisamos cuando lo confirme.`)}
      ${orderProgress("NEW")}
      ${itemsTable(itemsWithImages.map((i) => ({ ...i, currency })))}
      ${Number(order.discountAmount) > 0 || Number(order.loyaltyDiscount) > 0 ? totalRow("Subtotal", money(subtotal, currency)) : ""}
      ${Number(order.discountAmount) > 0 ? totalRow("Código de descuento", `-${money(order.discountAmount, currency)}`) : ""}
      ${Number(order.loyaltyDiscount) > 0 ? totalRow(`Puntos usados (${order.loyaltyPointsRedeemed})`, `-${money(order.loyaltyDiscount, currency)}`) : ""}
      ${totalRow("Productos", money(order.total, currency))}
      ${totalRow("Envío", orderShippingText(order))}
      ${totalRow("Total", orderGrandTotal(order))}
      ${order.shippingCoordinate ? smallNote("El envío a coordinar no está incluido en el total: se acuerda entre la tienda y el cliente según el lugar de entrega.") : ""}
      ${paragraph("<strong>Entrega</strong>", { padding: "16px 0 0" })}
      ${metaList([
        order.recipientName ? ["Recibe", esc(order.recipientName)] : ["Recibe", `${esc(order.customerName)} (tú)`],
        order.recipientName && order.recipientPhone ? ["Teléfono de quien recibe", esc(order.recipientPhone)] : null,
        order.recipientName && order.recipientIdNumber ? [ID_TYPE_LABEL[order.recipientIdType] ?? "Documento", esc(order.recipientIdNumber)] : null,
        order.shippingAddress ? ["Dirección", esc(order.shippingAddress)] : null,
        place ? ["Provincia", esc(place)] : null,
      ])}
      ${paragraph("<strong>Tu pedido</strong>", { padding: "8px 0 0" })}
      ${metaList([
        ["Número", esc(order.code)],
        order.createdAt ? ["Fecha", new Date(order.createdAt).toLocaleString("es-CU", { dateStyle: "long", timeStyle: "short", timeZone: "America/Havana" })] : null,
        ["Pago", channelLabel(order.channel)],
        ["Tus datos", [esc(order.customerName), esc(order.customerPhone), esc(order.customerEmail)].filter(Boolean).join(" · ")],
      ])}
      ${ctaButton("Rastrear mi pedido", `${env.frontendUrl}/rastrear-pedido?pedido=${encodeURIComponent(order.code)}`)}
      ${whatsapp ? smallNote(`¿Dudas sobre la entrega? Escribe a la tienda por WhatsApp: <a href="https://wa.me/${whatsapp}" style="color:#337475;">+${whatsapp}</a>`) : ""}
    `,
  });
  return { subject, html };
}
