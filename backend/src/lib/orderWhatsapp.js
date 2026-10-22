import { currencyLabel } from "./catalog.js";
// Mensaje de WhatsApp de un pedido recién creado. Es el mismo texto que arma el checkout web
// (frontend Checkout.jsx, buildOrderWhatsAppText) para que un pedido hecho por la API de un socio
// le llegue al vendedor con el mismo formato que uno hecho en Baznova.
const SEPARATOR = "──────────────────";
const PAY_TITLE = { cod: "Pago contra entrega", online: "Pago en línea con el vendedor", cash: "Efectivo" };

const price = (amount, currency = "CUP") => `${Number(amount).toLocaleString("es-CU")} ${currencyLabel(currency)}`;

export function orderWhatsAppText({ code, vendorName, items, discount, totalLabel, shippingText, customerName, customerPhone, address, channel }) {
  const lines = [
    `🛍️ *Pedido ${code}* — ${vendorName}`,
    SEPARATOR,
    "📦 *Productos*",
    ...items.map((it) => `• ${it.quantity}× ${it.name}${it.size ? ` (talla ${it.size})` : ""} — ${price(it.unitPrice, it.currency)} c/u`),
    SEPARATOR,
  ];
  if (discount) lines.push(`🏷️ Descuento (${discount.code}): -${price(discount.amount)}`);
  if (shippingText) lines.push(`🚚 Envío: ${shippingText}`);
  lines.push(`💰 *Total:* ${totalLabel}`, SEPARATOR, "👤 *Datos del cliente*", `Nombre: ${customerName}`, `Teléfono: ${customerPhone}`, `Entrega: ${address}`, SEPARATOR, `💳 Pago: ${PAY_TITLE[channel] ?? channel}`);
  return lines.join("\n");
}

export function whatsappUrl(phone, text) {
  const digits = String(phone ?? "").replace(/\D/g, "");
  return digits ? `https://wa.me/${digits}?text=${encodeURIComponent(text)}` : null;
}

// Suma por moneda sin mezclar monedas distintas en un solo número ("1,200 CUP + 25 USD").
// `fees`: envío del pedido por moneda ([{ currency, amount }]), se suma a la moneda que corresponda.
export function mixedTotalLabel(items, discountAmount = 0, fees = []) {
  const byCurrency = {};
  for (const it of items) byCurrency[it.currency ?? "CUP"] = (byCurrency[it.currency ?? "CUP"] ?? 0) + Number(it.unitPrice) * it.quantity;
  const currencies = Object.keys(byCurrency);
  if (discountAmount && currencies.length === 1) byCurrency[currencies[0]] = Math.max(0, byCurrency[currencies[0]] - Number(discountAmount));
  for (const f of fees ?? []) byCurrency[f.currency] = (byCurrency[f.currency] ?? 0) + Number(f.amount);
  return Object.entries(byCurrency).map(([c, sum]) => price(sum, c)).join(" + ");
}
