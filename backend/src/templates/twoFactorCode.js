import { env } from "../config/env.js";
import { emailShell, ctaButton, codeBlock, paragraph, smallNote } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 47: mismo patrón visual que passwordReset.js — código de 6 dígitos
// para el segundo paso del login (2FA opt-in), nunca el mismo hash/campo
// que el reset de contraseña (ver User.twoFactorCodeHash en schema.prisma).
export async function twoFactorCodeEmail({ fullName, code }) {
  const { siteName } = await getBrandSettings();
  // Bloque 49: se agrega el nombre — mismo criterio que passwordReset.js.
  const subject = fullName ? `${fullName}, tu código de verificación en dos pasos` : "Tu código de verificación en dos pasos";
  const html = await emailShell({
    preview: "Alguien está iniciando sesión en tu cuenta — usa este código para completar el ingreso",
    title: "Verificación en dos pasos",
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${fullName ?? ""}, alguien está iniciando sesión en tu cuenta. Usa este código para completar el ingreso — vence en <strong>10 minutos</strong>.`)}
      ${codeBlock(code)}
      ${smallNote("Si no intentaste ingresar, cambia tu contraseña — alguien más la tiene.")}
      ${ctaButton(`Ir a ${siteName}`, `${env.frontendUrl}/cuenta`)}
    `,
  });
  return { subject, html };
}
