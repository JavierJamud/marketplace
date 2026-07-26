import { env } from "../config/env.js";
import { emailShell, ctaButton, itemsTable, totalRow, metaList, paragraph, fmtCUP } from "./_shared.js";

// Bloque 14: valores de OrderChannel consolidados (COD/TABLE sin cambios,
// antes WHATSAPP/TRANSFER — ver comentario en schema.prisma).
const CHANNEL_PAY_LABEL = { CASH: "Efectivo", COD: "Pago contra entrega", ONLINE: "Pago en línea con el vendedor", TABLE: "Pedido de mesa" };

// order: { code, customerName, vendor: {companyName}, items, total, channel, shippingAddress }
export async function orderConfirmationEmail(order) {
  const subject = `Pedido ${order.code} confirmado en ${order.vendor.companyName}`;
  const html = await emailShell({
    preview: `Recibimos tu pedido ${order.code} — ${fmtCUP(order.total)} en ${order.vendor.companyName}`,
    title: `¡Gracias por tu pedido en ${order.vendor.companyName}!`,
    storeName: order.vendor.companyName,
    bodyMjml: `
      ${paragraph(`Hola ${order.customerName ?? ""}, recibimos tu pedido y ya está registrado.`)}
      ${itemsTable(order.items)}
      ${totalRow("Total", fmtCUP(order.total))}
      ${metaList([
        ["Pedido", order.code],
        ["Método de pago", CHANNEL_PAY_LABEL[order.channel] ?? order.channel],
        order.shippingAddress ? ["Entrega", order.shippingAddress] : null,
      ])}
      ${ctaButton("Ver mi pedido", `${env.frontendUrl}/cuenta/panel`)}
    `,
  });
  return { subject, html };
}
