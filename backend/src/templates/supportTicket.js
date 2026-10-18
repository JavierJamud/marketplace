import { emailShell, paragraph, smallNote, metaList, ctaButton, esc } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { env } from "../config/env.js";

// Correos de los tickets de errores visuales. Todo lo que escribió la persona o el admin va escapado.

const siteUrl = () => String(env.frontendUrl ?? "").replace(/\/$/, "");

export async function supportTicketAdminEmail({ ticket, code, vendorName, hasScreenshot }) {
  const { siteName } = await getBrandSettings();
  const subject = `Ticket ${code}: problema en ${ticket.section ?? ticket.pagePath}${vendorName ? ` (${vendorName})` : ""}`;
  const html = await emailShell({
    preview: ticket.description.slice(0, 120),
    title: `Nuevo ticket ${code}`,
    storeName: siteName,
    bodyMjml: `
      ${paragraph(esc(ticket.description).replace(/\n/g, "<br/>"), { color: "#1b1b1d", size: "14px", lineHeight: "22px" })}
      ${metaList([
        ["Tienda", esc(vendorName ?? "Sin tienda")],
        ["Quién lo reportó", esc(`${ticket.reporterName ?? "Sin nombre"} · ${ticket.reporterEmail}`)],
        ["Sección", esc(ticket.section ?? "Sin identificar")],
        ["Pantalla", esc(ticket.pagePath)],
        ["Fecha", esc(new Date(ticket.createdAt).toLocaleString("es-CU", { timeZone: "America/Havana" }))],
      ])}
      ${paragraph(hasScreenshot ? "La captura de lo que veía la persona va adjunta a este correo." : "Este reporte llegó sin captura.", { color: "#75777c", size: "12.5px" })}
      ${ctaButton("Abrir el ticket", `${siteUrl()}/admin/errores?tab=tickets&ticket=${ticket.id}`)}
    `,
  });
  return { subject, html };
}

export async function supportTicketReceiptEmail({ ticket, code, vendorName }) {
  const { siteName } = await getBrandSettings();
  const subject = `Recibimos tu reporte ${code}`;
  const html = await emailShell({
    preview: `Tu número de ticket es ${code}.`,
    title: `Recibimos tu reporte ${code}`,
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Gracias por avisarnos. Tu número de ticket es <strong style="color:#1b1b1d;">${esc(code)}</strong>${vendorName ? ` (tienda ${esc(vendorName)})` : ""}. Te escribiremos a este correo cuando tengamos una respuesta.`)}
      ${paragraph(`<strong>Lo que nos contaste:</strong><br/>${esc(ticket.description).replace(/\n/g, "<br/>")}`, { color: "#44474c", size: "13.5px" })}
      ${smallNote("Si el problema vuelve a pasar, repórtalo desde la misma pantalla donde lo ves: así la captura muestra el problema real.")}
    `,
  });
  return { subject, html };
}

export async function supportTicketUpdateEmail({ ticket, code, body, statusLabel, resolution, closed }) {
  const { siteName } = await getBrandSettings();
  const subject = closed ? `Tu reporte ${code}: ${statusLabel.toLowerCase()}` : `Respuesta a tu reporte ${code}`;
  const html = await emailShell({
    preview: (body || statusLabel).slice(0, 120),
    title: subject,
    storeName: siteName,
    bodyMjml: `
      ${body ? paragraph(esc(body).replace(/\n/g, "<br/>"), { color: "#1b1b1d", size: "14px", lineHeight: "22px" }) : ""}
      ${metaList([
        ["Ticket", esc(code)],
        ["Estado", esc(statusLabel)],
        ...(resolution ? [["Cómo se solucionó", esc(resolution)]] : []),
      ])}
      ${paragraph(`<strong>Tu reporte:</strong><br/>${esc(ticket.description.slice(0, 600)).replace(/\n/g, "<br/>")}`, { color: "#75777c", size: "12.5px" })}
      ${smallNote(closed ? "Si el problema sigue, envía un reporte nuevo desde la pantalla donde lo ves." : "Puedes responder a este correo si necesitas agregar algo.")}
    `,
  });
  return { subject, html };
}
