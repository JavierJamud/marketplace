import { emailShell, paragraph, esc } from "./_shared.js";

// Mismos 3 estados de KitchenStatus (schema.prisma), no una paleta paralela.
const STATUS_LABEL = { RECEIVED: "Recibido", PREPARING: "Preparando", READY: "Listo para retirar" };
const STATUS_COLOR = { RECEIVED: "#337475", PREPARING: "#8A5100", READY: "#0A8F42" };
// Cómo se lee el estado dentro de una frase ("tu pedido ahora está en preparación"): la etiqueta de la pastilla
// ("Preparando") no concuerda detrás de "está".
const STATUS_PHRASE = { RECEIVED: "recibido", PREPARING: "en preparación", READY: "listo para retirar" };

export async function tableOrderStatusEmail({ vendorName, tableNumber, kitchenStatus }) {
  const label = STATUS_LABEL[kitchenStatus] ?? kitchenStatus;
  const phrase = STATUS_PHRASE[kitchenStatus] ?? String(label ?? "").toLowerCase();
  const color = STATUS_COLOR[kitchenStatus] ?? "#5f6368";
  // Bloque 49: se agrega el número de mesa — junto con vendorName ya
  // distingue cada envío (varias mesas de la misma tienda no comparten
  // asunto idéntico).
  const subject = `Mesa ${tableNumber} en ${vendorName}: ${label}`;
  const html = await emailShell({
    preview: `Tu pedido de la mesa ${tableNumber} en ${vendorName} ahora está ${phrase}`,
    title: `Mesa ${tableNumber} · ${vendorName}`,
    storeName: vendorName,
    accentColor: color,
    badge: { label, color },
    // El sello con el estado va arriba del título (Bloque 61): la frase lo nombra entera en vez de terminar en dos puntos
    // sin nada debajo.
    bodyMjml: `
      ${paragraph(`Tu pedido de la mesa ${esc(tableNumber)} ahora está <strong>${esc(phrase)}</strong>.`)}
    `,
  });
  return { subject, html };
}
