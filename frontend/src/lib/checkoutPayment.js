// Formas de coordinar el pago al terminar una compra. Cada tienda elige cuáles ofrece (Vendor.checkoutPaymentOptions); el
// checkout, la configuración del vendedor y la ficha del producto leen esta misma lista.
export const CHECKOUT_PAY_CHOICES = [
  { id: "cod", title: "Pago contra entrega", sub: "Coordinado por WhatsApp con el vendedor" },
  { id: "online", title: "Pago en línea con el vendedor", sub: "Transferencia, Zelle, etc. Arreglan método y monto directo por WhatsApp" },
  { id: "cash", title: "Efectivo", sub: "Coordinas el lugar y momento por WhatsApp" },
];
