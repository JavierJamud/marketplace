import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph, itemsTable, totalRow, metaList, esc, resolveAssetUrl } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { orderCurrency, money, orderShippingText, orderGrandTotal } from "../lib/orderSummary.js";
import { currencyLabel } from "../lib/catalog.js";

// Aviso a la TIENDA de que un pedido se canceló: quién lo canceló, el motivo y qué pedido era. Va al correo de la tienda.
// by: "CUSTOMER" (el cliente lo canceló) o "STORE" (lo canceló la tienda; llega como constancia).
export async function orderCancelledVendorEmail({ order, by, reason }) {
  const { siteName } = await getBrandSettings();
  const byCustomer = by === "CUSTOMER";
  const subject = `Pedido ${order.code} cancelado${byCustomer ? " por el cliente" : ""}`;
  // Montos en la moneda real del pedido, como en el aviso de pedido nuevo (newOrderVendor.js): antes las filas iban sin
  // moneda y el total con fmtCUP, así que un pedido en USD llegaba en CUP. La moneda va con el nombre corto del admin
  // (currencyLabel), el mismo que usan los totales, y no con el código guardado.
  const currency = orderCurrency(order);
  const items = (order.items ?? []).map((i) => ({
    name: i.name,
    size: i.size,
    quantity: i.quantity,
    price: i.price,
    currency: currencyLabel(i.currency ?? currency),
    imageUrl: resolveAssetUrl(i.product?.images?.[0]),
  }));
  // Con envío (cobrado o a coordinar) el total no es solo productos: van Productos, Envío y Total, como en
  // newOrderVendor.js, para que la diferencia entre las dos cifras se entienda. Sin envío basta con el Total.
  const hasShipping = (Array.isArray(order.shippingFees) && order.shippingFees.length > 0) || Boolean(order.shippingCoordinate);
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
      ${order.total != null && hasShipping ? totalRow("Productos", money(order.total, currency)) : ""}
      ${order.total != null && hasShipping ? totalRow("Envío", orderShippingText(order)) : ""}
      ${order.total != null ? totalRow("Total", orderGrandTotal(order)) : ""}
      ${order.total != null && order.shippingCoordinate ? smallNote("El envío a coordinar no está incluido en el total.") : ""}
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
