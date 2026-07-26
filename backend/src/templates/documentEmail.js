import { emailShell, paragraph, smallNote } from "./_shared.js";

// Bloque 49: antes invoices.controller.js armaba HTML crudo (<p> sin
// ningún estilo) a mano en vez de pasar por un template — con el resto del
// sistema ya rediseñado, esto quedaba como el único correo sin la tarjeta
// de marca. Un solo template para los dos documentos adjuntos (factura y
// garantía) ya que comparten toda la estructura, solo cambia el texto del
// cuerpo y el asunto.
export async function invoiceEmail({ vendor, order, customerName }) {
  const subject = `Factura de tu compra en ${vendor.companyName} — pedido ${order.code}`;
  const html = await emailShell({
    preview: `Adjuntamos la factura de tu pedido ${order.code} en ${vendor.companyName}`,
    title: "Tu factura de compra",
    storeName: vendor.companyName,
    accentColor: vendor.color || undefined,
    bodyMjml: `
      ${paragraph(`Hola${customerName ? ` ${customerName}` : ""},`)}
      ${paragraph(`Adjuntamos la factura de tu compra en <strong>${vendor.companyName}</strong> (pedido ${order.code}).`)}
      ${smallNote("¡Gracias por tu compra!")}
    `,
  });
  return { subject, html };
}

export async function warrantyEmail({ vendor, order, customerName, warrantyDays }) {
  const subject = `Certificado de garantía — ${vendor.companyName} — pedido ${order.code}`;
  const html = await emailShell({
    preview: `Tu certificado de garantía de ${vendor.companyName}, válido por ${warrantyDays} día(s)`,
    title: "Tu certificado de garantía",
    storeName: vendor.companyName,
    accentColor: vendor.color || undefined,
    bodyMjml: `
      ${paragraph(`Hola${customerName ? ` ${customerName}` : ""},`)}
      ${paragraph(`Adjuntamos el certificado de garantía de tu compra en <strong>${vendor.companyName}</strong> (pedido ${order.code}), válido por <strong>${warrantyDays} día(s)</strong>.`)}
    `,
  });
  return { subject, html };
}
