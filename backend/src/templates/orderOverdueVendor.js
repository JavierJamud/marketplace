import { channelLabel } from "../lib/catalog.js";
import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph, itemsTable, totalRow, metaList, esc, resolveAssetUrl } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { orderCurrency, money, orderShippingText, orderGrandTotal } from "../lib/orderSummary.js";

// Aviso a la TIENDA de un pedido que lleva un rato sin confirmar (jobs/orderOverdue.job.js). Mismo destinatario e
// interruptor que el de pedido nuevo. Lleva lo justo para reconocer el pedido y contactar al cliente, y el botón que abre
// ese pedido en el panel, que es donde se confirma o se cancela.
export async function orderOverdueVendorEmail({ order, waited }) {
  const { siteName } = await getBrandSettings();
  const currency = orderCurrency(order);
  const subject = `Pedido ${order.code} sin confirmar · espera hace ${waited}`;
  const items = order.items.map((i) => ({ name: i.name, size: i.size, quantity: i.quantity, price: i.price, currency, imageUrl: resolveAssetUrl(i.product?.images?.[0]) }));
  const html = await emailShell({
    preview: `${order.customerName ?? "Un cliente"} espera hace ${waited} que confirmes el pedido ${order.code}`,
    title: "Tienes un pedido sin confirmar",
    badge: { label: "Sin confirmar", color: "#8A5100" },
    accentColor: "#8A5100",
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${esc(order.vendor.companyName)}</strong>, el pedido <strong>${esc(order.code)}</strong> lleva <strong>${esc(waited)}</strong> esperando.`)}
      ${paragraph("Confírmalo en tu panel para que el cliente sepa que lo vas a atender. Si no puedes atenderlo, cancélalo con el motivo y el cliente recibe el aviso.")}
      ${itemsTable(items)}
      ${totalRow("Productos", money(order.total, currency))}
      ${totalRow("Envío", orderShippingText(order))}
      ${totalRow("Total a cobrar", orderGrandTotal(order))}
      ${metaList([
        ["Cliente", esc(order.customerName)],
        ["Teléfono", esc(order.customerPhone)],
        order.customerEmail ? ["Correo", esc(order.customerEmail)] : null,
        ["Pago", esc(channelLabel(order.channel))],
      ])}
      ${ctaButton("Abrir el pedido en mi panel", `${env.frontendUrl}/vendedor/pedidos?ver=${order.id}&tipo=orden`)}
      ${smallNote("Recibes este correo porque tienes activado el aviso de pedidos. Puedes apagarlo en Configuración de tu tienda.")}
    `,
  });
  return { subject, html };
}
