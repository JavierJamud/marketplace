import { env } from "../config/env.js";
import { emailShell, ctaButton, codeBlock, paragraph, smallNote } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 71 (pedido explícito): va SIEMPRE al correo VIEJO (el que ya está en
// la cuenta), nunca al nuevo — es la prueba de que quien pide el cambio de
// verdad tiene acceso a esa cuenta. Se nombra el correo nuevo en el cuerpo
// para que el dueño real de la cuenta pueda reconocer/rechazar un intento
// que no hizo él.
export async function emailChangeCodeEmail({ fullName, code, newEmail }) {
  const { siteName } = await getBrandSettings();
  const subject = fullName ? `${fullName}, confirma el cambio de correo` : "Confirma el cambio de correo";
  const html = await emailShell({
    preview: "Usa este código para confirmar que quieres cambiar el correo de tu cuenta",
    title: "Confirmar cambio de correo",
    badge: { label: "Seguridad de la cuenta", color: "#0CAE53" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${fullName ?? ""}, alguien pidió cambiar el correo de tu cuenta a <strong>${newEmail}</strong>. Usa este código para confirmarlo — vence en <strong>15 minutos</strong>.`)}
      ${codeBlock(code)}
      ${smallNote("Si no pediste este cambio, ignora este correo — tu correo actual sigue siendo el mismo y nadie puede cambiarlo sin este código.")}
      ${ctaButton(`Ir a ${siteName}`, `${env.frontendUrl}/cuenta`)}
    `,
  });
  return { subject, html };
}
