import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 194 (pedido explícito — "notificación por correo al admin [de la
// tienda] para notificar sobre bajo stock en productos antes que se
// agoten"): mismo criterio visual que vendorInactivityReminderEmail.js —
// tono útil, nunca alarmista. `products` = [{ name, stock }] ya filtrados
// y ordenados (menos stock primero) por lowStock.job.js — este archivo solo
// arma el HTML, no decide el umbral.
export async function lowStockAlertEmail({ vendor, products }) {
  const { siteName } = await getBrandSettings();
  const subject =
    products.length === 1
      ? `"${products[0].name}" está por agotarse en tu tienda`
      : `${products.length} productos están por agotarse en tu tienda`;

  const rows = products
    .map(
      (p) =>
        `<tr><td style="padding:8px 0;border-bottom:1px solid #f0edee;color:#1b1b1d;font-size:13.5px;">${p.name}</td><td style="padding:8px 0;border-bottom:1px solid #f0edee;text-align:right;color:#8A5100;font-size:13.5px;font-weight:700;">${p.stock} ${p.stock === 1 ? "unidad" : "unidades"}</td></tr>`
    )
    .join("");

  const html = await emailShell({
    preview: `${products.length === 1 ? "1 producto está" : `${products.length} productos están`} por agotarse en ${vendor.companyName}`,
    title: "Productos por agotarse",
    badge: { label: "Inventario", color: "#8A5100" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${vendor.companyName}</strong>, ${products.length === 1 ? "este producto está" : "estos productos están"} quedándose sin stock:`)}
      ${paragraph(`<table role="presentation" width="100%" style="width:100%;border-collapse:collapse;">${rows}</table>`, { padding: "4px 0 8px" })}
      ${smallNote("Repón el stock (o marca el producto como \"disponible siempre\" si no le llevas seguimiento) antes de que se agote y deje de venderse. Te avisamos una sola vez por esta baja — si vuelve a subir y a bajar del umbral, te lo recordamos de nuevo.")}
      ${ctaButton("Ver mis productos", `${env.frontendUrl}/vendedor/productos`)}
    `,
  });
  return { subject, html };
}
