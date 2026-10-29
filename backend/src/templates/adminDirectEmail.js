import { emailShell, paragraph, ctaButton, esc } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 47: correo puntual admin -> cliente/tienda (distinto del envío
// masivo segmentado de AdminCampaigns.jsx) — mismo shell base que
// vendorMessage.js, sin el contexto de un pedido (acá no hay ninguno).
// `cta` (opcional): botón { label, url } que lleva directo a lo que hay que revisar (avisos al admin).
export async function adminDirectEmail({ subject, message, recipientName, cta }) {
  const { siteName } = await getBrandSettings();
  // Bloque 49: el admin escribe el asunto libre — se le agrega el nombre
  // del destinatario si no lo puso ya (mismo criterio que vendorMessage.js
  // con el código de pedido), para que cada envío quede identificable.
  const finalSubject = recipientName && !subject.includes(recipientName) ? `${subject} · ${recipientName}` : subject;
  const html = await emailShell({
    preview: message.slice(0, 120),
    // El asunto puede traer el nombre de una tienda o de una persona: emailShell lo escapa. `message` en cambio admite HTML,
    // así que quien llama escapa lo que venga de terceros (adminNotify.js, adminActionCode.js).
    title: subject,
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Mensaje del equipo de <strong style="color:#1b1b1d;">${esc(siteName)}</strong>${recipientName ? ` para ${esc(recipientName)}` : ""}`, { color: "#5f6368", size: "12.5px", padding: "0 0 14px" })}
      ${paragraph(message.replace(/\n/g, "<br/>"), { color: "#44474c", size: "14px", lineHeight: "22px" })}
      ${cta ? ctaButton(cta.label, cta.url) : ""}
    `,
  });
  return { subject: finalSubject, html };
}
