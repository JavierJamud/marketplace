import { emailShell, ctaButton, statusBadge } from "./_shared.js";

// Un solo template genérico para todo el ciclo de verificación/cobro — mismo
// patrón que statusUpdate.js ya usa un label/color map en vez de un template
// por estado.
const META = {
  VERIFICATION_DOCS_APPROVED: { label: "Documentos aprobados", color: "#0A8F42" },
  VERIFICATION_DOCS_REJECTED: { label: "Documentos rechazados", color: "#ba1a1a" },
  VERIFICATION_PAYMENT_LINK_SENT: { label: "Link de pago enviado", color: "#8A5100" },
  VERIFICATION_VERIFIED: { label: "Tienda verificada", color: "#0CAE53" },
};

export function verificationUpdateEmail({ type, vendorName, title, message, ctaHref }) {
  const meta = META[type] ?? { label: "Actualización", color: "#337475" };
  const subject = `${meta.label} — ${vendorName}`;
  const html = emailShell({
    title,
    // storeName acá es "quién firma el correo" (footer) — este es un email
    // de la plataforma al vendedor, no un mensaje de una tienda a su
    // cliente, así que firma ZeuDin, no el propio vendedor.
    storeName: "ZeuDin",
    bodyHtml: `
      <p style="color:#44474c;font-size:14px;line-height:21px;">Hola equipo de <strong>${vendorName}</strong>,</p>
      <div style="margin:14px 0;">${statusBadge(meta.label, meta.color)}</div>
      <p style="color:#44474c;font-size:14px;line-height:21px;">${message}</p>
      ${ctaHref ? ctaButton("Ver en mi panel", ctaHref) : ""}
    `,
  });
  return { subject, html };
}
