import { emailShell, ctaButton, smallNote, paragraph, esc } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Avisos de moderación (resultado de un reporte, suspensión con plazo para apelar, cuenta o tienda bloqueada por avisos,
// eliminación y lista negra). Un solo molde: título, sello de color, párrafos ya escritos y un botón opcional. Los
// párrafos traen texto propio de la plataforma; lo que escribió una persona (motivo del admin, nombre del producto) se
// escapa con esc() antes de llegar aquí.
export async function moderationNoticeEmail({ fullName, subject, title, badge, paragraphs = [], note, cta }) {
  const { siteName } = await getBrandSettings();
  const html = await emailShell({
    preview: subject,
    title,
    badge,
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${esc(fullName ?? "")},`)}
      ${paragraphs.map((p) => paragraph(p)).join("")}
      ${note ? smallNote(note) : ""}
      ${cta ? ctaButton(cta.label, cta.href) : ""}
    `,
  });
  return { subject, html };
}
