import { emailShell, ctaButton, statusBadge, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Un solo template genérico para todo el ciclo de verificación/cobro — mismo
// patrón que statusUpdate.js ya usa un label/color map en vez de un template
// por estado.
const META = {
  VERIFICATION_DOCS_APPROVED: { label: "Documentos aprobados", color: "#0A8F42" },
  VERIFICATION_DOCS_REJECTED: { label: "Documentos rechazados", color: "#ba1a1a" },
  VERIFICATION_PAYMENT_LINK_SENT: { label: "Link de pago enviado", color: "#8A5100" },
  VERIFICATION_VERIFIED: { label: "Tienda verificada", color: "#0CAE53" },
  VERIFICATION_BUSINESS_REVOKED: { label: "Plan Business revocado", color: "#ba1a1a" },
};

export async function verificationUpdateEmail({ type, vendorName, title, message, ctaHref }) {
  const { siteName } = await getBrandSettings();
  const meta = META[type] ?? { label: "Actualización", color: "#337475" };
  const subject = `${meta.label} — ${vendorName}`;
  const html = await emailShell({
    preview: `${vendorName}: ${meta.label.toLowerCase()}`,
    title,
    // storeName acá es "quién firma el correo" (footer) — este es un email
    // de la plataforma al vendedor, no un mensaje de una tienda a su
    // cliente, así que firma la plataforma, no el propio vendedor.
    storeName: siteName,
    accentColor: meta.color,
    bodyMjml: `
      ${paragraph(`Hola equipo de <strong>${vendorName}</strong>,`)}
      ${statusBadge(meta.label, meta.color)}
      ${paragraph(message)}
      ${ctaHref ? ctaButton("Ver en mi panel", ctaHref) : ""}
    `,
  });
  return { subject, html };
}
