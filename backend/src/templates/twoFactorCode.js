import { env } from "../config/env.js";
import { emailShell, ctaButton, codeBlock, paragraph, smallNote } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 47/60: código de 6 dígitos obligatorio en cada login salvo que el
// navegador ya sea "de confianza" (ver auth.controller.js) — nunca el mismo
// hash/campo que el reset de contraseña (User.twoFactorCodeHash en
// schema.prisma). Bloque 61: badge + título actualizados al rediseño del
// shell (mismo patrón que passwordReset.js/registrationCode.js).
export async function twoFactorCodeEmail({ fullName, code }) {
  const { siteName } = await getBrandSettings();
  // Bloque 49: se agrega el nombre — mismo criterio que passwordReset.js.
  const subject = fullName ? `${fullName}, confirma que eres tú` : "Confirma que eres tú";
  const html = await emailShell({
    preview: "Alguien está iniciando sesión en tu cuenta — usa este código para completar el ingreso",
    title: "Confirma que eres tú",
    badge: { label: "Verificación en dos pasos", color: "#0CAE53" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${fullName ?? ""}, alguien está iniciando sesión en tu cuenta. Usa este código para completar el ingreso — vence en <strong>5 minutos</strong>.`)}
      ${codeBlock(code)}
      ${smallNote("Si no intentaste ingresar, cambia tu contraseña — alguien más la tiene.")}
      ${ctaButton(`Ir a ${siteName}`, `${env.frontendUrl}/cuenta`)}
    `,
  });
  return { subject, html };
}
