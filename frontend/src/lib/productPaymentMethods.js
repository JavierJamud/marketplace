// Bloque 199 (pedido explícito — "en la sección de métodos de pago de un
// producto debe ser la forma de recibir el pago para la empresa: sería pago
// anticipado, pago contra entrega, o arreglo de pago vía WhatsApp con el
// vendedor"): esto YA es lo que Product.paymentMethods representa (arreglo
// del ORDEN, no de qué tarjetas/billeteras acepta la tienda — eso es
// Vendor.acceptedPaymentMethods, un campo totalmente aparte, editado en
// VendorSettings.jsx y mostrado en la tienda pública) — el problema real
// era que "prepaid" estaba mal etiquetado como "Transferencia"/
// "Transferencia CUP" en 4 archivos distintos, sin ninguno compartir esta
// misma fuente, lo que confundía el significado real del campo. Única
// fuente de verdad para las 3 etiquetas — cualquier archivo nuevo que
// muestre Product.paymentMethods debe importar de acá, nunca redefinir su
// propio mapa local.
export const PRODUCT_PAYMENT_METHOD_LABEL = {
  whatsapp: "WhatsApp",
  cod: "Contra entrega",
  prepaid: "Pago anticipado",
};
