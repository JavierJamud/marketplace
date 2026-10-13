import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph, itemsTable, totalRow, metaList, esc, fmtCUP, resolveAssetUrl } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Aviso a la TIENDA de que un pedido se canceló: quién lo canceló, el motivo y qué pedido era. Va al correo de la tienda.
// by: "CUSTOMER" (el cliente lo canceló) o "STORE" (lo canceló la tienda; llega como constancia).
export async function orderCancelledVendorEmail({ order, by, reason }) {
  const { siteName } = await getBrandSettings();
  const byCustomer = by === "CUSTOMER";
  const subject = `Pedido ${order.code} cancelado${byCustomer ? " por el cliente" : ""}`;
  const items = (order.items ?? []).map((i) => ({ name: i.name, size: i.size, quantity: i.quantity, price: i.price, imageUrl: resolveAssetUrl(i.product?.images?.[0]) }));
  const html = await emailShell({
    preview: `${byCustomer ? (order.customerName ?? "El cliente") + " canceló" : "Se canceló"} el pedido ${order.code}`,
    title: "Un pedido fue cancelado",
    badge: { label: "Cancelado", color: "#ba1a1a" },
    accentColor: "#ba1a1a",
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${esc(order.vendor.companyName)}</strong>, el pedido <strong>${esc(order.code)}</strong> ${byCustomer ? "fue cancelado por el cliente" : "quedó cancelado desde tu panel"}.`)}
      ${paragraph(`<strong>Motivo:</strong> ${esc(reason || "No se indicó")}`)}
      ${items.length ? itemsTable(items) : ""}
      ${order.total != null ? totalRow("Total", fmtCUP(order.total)) : ""}
      ${metaList([
        ["Cliente", esc(order.customerName)],
        ["Teléfono", esc(order.customerPhone)],
        order.customerEmail ? ["Correo", esc(order.customerEmail)] : null,
      ])}
      ${ctaButton("Ver el pedido en mi panel", `${env.frontendUrl}/vendedor/pedidos`)}
      ${smallNote("Recibes este correo porque tienes activado el aviso de pedidos. Puedes apagarlo en Configuración de tu tienda.")}
    `,
  });
  return { subject, html };
}
