import { emailShell, ctaButton, paragraph, smallNote, esc } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Aviso al cliente de que su comentario tiene una respuesta, de la tienda o del equipo de la plataforma. Lleva su comentario y la
// respuesta completos, y un botón que abre esa reseña.
export async function reviewReplyEmail({ customerName, responder, targetLabel, comment, reply, ctaUrl }) {
  const { siteName } = await getBrandSettings();
  const subject = `${responder} respondió a tu comentario`;
  const html = await emailShell({
    preview: `${responder} respondió a tu comentario sobre ${targetLabel}`,
    title: "Respondieron a tu comentario",
    badge: { label: "Respuesta nueva", color: "#337475" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola <strong>${esc(customerName)}</strong>, <strong>${esc(responder)}</strong> respondió a tu comentario sobre <strong>${esc(targetLabel)}</strong>.`)}
      ${paragraph(`<span style="color:#74777c;font-size:12px;">Tu comentario</span><br/><em>“${esc(comment)}”</em>`)}
      ${paragraph(`<span style="color:#74777c;font-size:12px;">Su respuesta</span><br/><strong>${esc(reply)}</strong>`)}
      ${ctaButton("Ver la respuesta", ctaUrl)}
      ${smallNote("Recibes este correo porque dejaste un comentario en " + esc(siteName) + ".")}
    `,
  });
  return { subject, html };
}
