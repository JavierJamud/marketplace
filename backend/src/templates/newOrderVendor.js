import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph, itemsTable, totalRow, metaList, esc, resolveAssetUrl } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

const PAY_LABEL = { COD: "Pago contra entrega", ONLINE: "Pago en línea con el vendedor", CASH: "Efectivo", TABLE: "Pedido de mesa" };

// Aviso a la TIENDA de que recibió un pedido nuevo (web de Baznova o API de un socio). Va al correo de la
// tienda, nunca al administrador. Muestra lo que el vendedor necesita para atenderlo: productos, datos del
// cliente, dirección y forma de pago. `partnerName` solo se pone cuando el pedido llegó por un socio.
export async function newOrderVendorEmail({ order, partnerName }) {
  const { siteName } = await getBrandSettings();
  const subject = `Pedido nuevo ${order.code} en ${order.vendor.companyName}`;
  const items = order.items.map((i) => ({ name: i.name, size: i.size, quantity: i.quantity, price: i.price, imageUrl: resolveAssetUrl(i.product?.images?.[0]) }));
  const html = await emailShell({
    preview: `${order.customerName ?? "Un cliente"} hizo el pedido ${order.code}`,
    title: "Recibiste un pedido nuevo",
    badge: { label: "Pedido nuevo", color: "#0CAE53" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${esc(order.vendor.companyName)}</strong>, entró el pedido <strong>${esc(order.code)}</strong>${partnerName ? ` desde el sitio de <strong>${esc(partnerName)}</strong>` : ""}. Está pendiente de tu confirmación.`)}
      ${itemsTable(items)}
      ${totalRow("Total", `${Number(order.total).toLocaleString("es-CU")} CUP`)}
      ${metaList([
        ["Cliente", esc(order.customerName)],
        ["Teléfono", esc(order.customerPhone)],
        order.customerEmail ? ["Correo", esc(order.customerEmail)] : null,
        ["Entrega", esc(order.shippingAddress)],
        ["Pago", esc(PAY_LABEL[order.channel] ?? order.channel)],
      ])}
      ${ctaButton("Ver el pedido en mi panel", `${env.frontendUrl}/vendedor/pedidos`)}
      ${smallNote("Recibes este correo porque tienes activado el aviso de pedidos nuevos. Puedes apagarlo en Configuración de tu tienda.")}
    `,
  });
  return { subject, html };
}
