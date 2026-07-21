import { env } from "../config/env.js";
import { emailShell, ctaButton, fmtCUP } from "./_shared.js";

// Bloque 14: valores de OrderChannel consolidados (COD/TABLE sin cambios,
// antes WHATSAPP/TRANSFER — ver comentario en schema.prisma).
const CHANNEL_PAY_LABEL = { CASH: "Efectivo", COD: "Pago contra entrega", ONLINE: "Pago en línea con el vendedor", TABLE: "Pedido de mesa" };

function itemsTable(items) {
  const rows = items
    .map(
      (i) =>
        `<tr><td style="padding:7px 0;border-bottom:1px solid #f0edee;color:#1b1b1d;font-size:13.5px;">${i.quantity}× ${i.name}</td><td style="padding:7px 0;border-bottom:1px solid #f0edee;text-align:right;color:#1b1b1d;font-size:13.5px;">${fmtCUP(Number(i.price) * i.quantity)}</td></tr>`
    )
    .join("");
  return `<table role="presentation" style="width:100%;border-collapse:collapse;margin:14px 0;">${rows}</table>`;
}

// order: { code, customerName, vendor: {companyName}, items, total, channel, shippingAddress }
export function orderConfirmationEmail(order) {
  const subject = `Pedido ${order.code} confirmado en ${order.vendor.companyName}`;
  const html = emailShell({
    title: `¡Gracias por tu pedido en ${order.vendor.companyName}!`,
    storeName: order.vendor.companyName,
    bodyHtml: `
      <p style="color:#44474c;font-size:14px;line-height:21px;">Hola ${order.customerName ?? ""}, recibimos tu pedido y ya está registrado.</p>
      ${itemsTable(order.items)}
      <table role="presentation" style="width:100%;padding-top:6px;"><tr><td style="font-weight:800;color:#1b1b1d;font-size:15px;">Total</td><td style="text-align:right;font-weight:800;color:#1b1b1d;font-size:15px;">${fmtCUP(order.total)}</td></tr></table>
      <div style="margin-top:18px;padding-top:14px;border-top:1px solid #eae7e9;font-size:12.5px;color:#75777c;line-height:19px;">
        <div><strong style="color:#44474c;">Pedido:</strong> ${order.code}</div>
        <div><strong style="color:#44474c;">Método de pago:</strong> ${CHANNEL_PAY_LABEL[order.channel] ?? order.channel}</div>
        ${order.shippingAddress ? `<div><strong style="color:#44474c;">Entrega:</strong> ${order.shippingAddress}</div>` : ""}
      </div>
      ${ctaButton("Ver mi pedido", `${env.frontendUrl}/cuenta/panel`)}
    `,
  });
  return { subject, html };
}
