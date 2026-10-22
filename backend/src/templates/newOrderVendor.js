import { channelLabel } from "../lib/catalog.js";
import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph, itemsTable, totalRow, metaList, esc, resolveAssetUrl } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { orderCurrency, money, orderShippingText, orderGrandTotal, deliveryPlace, ID_TYPE_LABEL } from "../lib/orderSummary.js";


// Aviso a la TIENDA de que recibió un pedido nuevo (web de Baznova o API de un socio). Va al correo de la tienda, nunca al
// administrador. Lleva todo lo necesario para atenderlo sin abrir el panel: productos y total en la moneda del pedido,
// descuentos y puntos usados, quién compra, quién recibe (si es otra persona, con su documento para comprobarlo al entregar),
// dónde y cómo se paga. `partnerName` solo se pone cuando el pedido llegó por un socio.
export async function newOrderVendorEmail({ order, partnerName }) {
  const { siteName } = await getBrandSettings();
  const currency = orderCurrency(order);
  const place = await deliveryPlace(order);
  const subject = `Pedido nuevo ${order.code} · ${orderGrandTotal(order)}`;
  const items = order.items.map((i) => ({ name: i.name, size: i.size, quantity: i.quantity, price: i.price, currency, imageUrl: resolveAssetUrl(i.product?.images?.[0]) }));
  const subtotal = order.items.reduce((s, i) => s + Number(i.price) * i.quantity, 0);
  const html = await emailShell({
    preview: `${order.customerName ?? "Un cliente"} hizo el pedido ${order.code} por ${orderGrandTotal(order)}`,
    title: "Recibiste un pedido nuevo",
    badge: { label: "Pedido nuevo", color: "#0CAE53" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${esc(order.vendor.companyName)}</strong>, entró el pedido <strong>${esc(order.code)}</strong>${partnerName ? ` desde el sitio de <strong>${esc(partnerName)}</strong>` : ""}. Está pendiente de tu confirmación.`)}
      ${itemsTable(items)}
      ${Number(order.discountAmount) > 0 || Number(order.loyaltyDiscount) > 0 ? totalRow("Subtotal", money(subtotal, currency)) : ""}
      ${Number(order.discountAmount) > 0 ? totalRow("Código de descuento", `-${money(order.discountAmount, currency)}`) : ""}
      ${Number(order.loyaltyDiscount) > 0 ? totalRow(`Puntos del cliente (${order.loyaltyPointsRedeemed})`, `-${money(order.loyaltyDiscount, currency)}`) : ""}
      ${totalRow("Productos", money(order.total, currency))}
      ${totalRow("Envío", orderShippingText(order))}
      ${totalRow("Total a cobrar", orderGrandTotal(order))}
      ${order.shippingCoordinate ? smallNote("El envío a coordinar no está incluido en el total: se acuerda entre la tienda y el cliente según el lugar de entrega.") : ""}
      ${paragraph("<strong>Quién compra</strong>", { padding: "16px 0 0" })}
      ${metaList([
        ["Nombre", esc(order.customerName)],
        ["Teléfono", esc(order.customerPhone)],
        order.customerEmail ? ["Correo", esc(order.customerEmail)] : null,
      ])}
      ${paragraph("<strong>Entrega</strong>", { padding: "8px 0 0" })}
      ${metaList([
        order.recipientName ? ["Recibe", `${esc(order.recipientName)} (otra persona)`] : ["Recibe", "La misma persona que compra"],
        order.recipientName && order.recipientPhone ? ["Teléfono de quien recibe", esc(order.recipientPhone)] : null,
        order.recipientName && order.recipientIdNumber ? [ID_TYPE_LABEL[order.recipientIdType] ?? "Documento", `${esc(order.recipientIdNumber)} (compruébalo al entregar)`] : null,
        ["Dirección", esc(order.shippingAddress)],
        place ? ["Provincia", esc(place)] : null,
        ["Pago", esc(channelLabel(order.channel))],
      ])}
      ${ctaButton("Ver el pedido en mi panel", `${env.frontendUrl}/vendedor/pedidos?ver=${order.id}&tipo=orden`)}
      ${smallNote("Recibes este correo porque tienes activado el aviso de pedidos nuevos. Puedes apagarlo en Configuración de tu tienda.")}
    `,
  });
  return { subject, html };
}
