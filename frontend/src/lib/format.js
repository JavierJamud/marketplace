// Bloque 52: antes cada página tenía su propia copia idéntica de fmtCUP
// (20 definiciones locales) — con moneda por producto (CUP/USD/EUR) ahora
// hay que parametrizar el símbolo, así que se centraliza acá. Los usos que
// son sumas agregadas en varias monedas a la vez (ingresos del dashboard,
// totales de pedidos ya cerrados, etc.) siguen usando su propio fmtCUP local
// a propósito — no hay tipo de cambio en el sistema, mezclar montos de
// distinta moneda en una sola suma sería un número falso, no una conversión
// real. Este helper es para cuando el monto SÍ tiene una moneda propia clara
// (el precio de UN producto, un ítem de carrito/pedido).
const CURRENCY_LABEL = { CUP: "CUP", USD: "USD", EUR: "EUR" };

export function formatPrice(amount, currency = "CUP") {
  const symbol = CURRENCY_LABEL[currency] ?? currency;
  return `${Number(amount).toLocaleString("es-CU")} ${symbol}`;
}

// Agrupa una lista de { price, quantity, currency } por moneda y devuelve
// algo como "1,200 CUP + 25 USD" — usado en Cart.jsx/Checkout.jsx para no
// fabricar un total único cuando el carrito mezcla productos en más de una
// moneda (no hay forma honesta de sumarlos sin un tipo de cambio real).
export function formatMixedTotal(items) {
  const byCurrency = {};
  for (const item of items) {
    const currency = item.currency ?? "CUP";
    byCurrency[currency] = (byCurrency[currency] ?? 0) + Number(item.price) * item.quantity;
  }
  return Object.entries(byCurrency)
    .map(([currency, sum]) => formatPrice(sum, currency))
    .join(" + ");
}
