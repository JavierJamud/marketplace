import { env } from "../config/env.js";
import { emailShell, ctaButton, codeBlock, paragraph, smallNote } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// user: { fullName, email }, code: "123456"
export async function passwordResetEmail({ fullName, code }) {
  const { siteName } = await getBrandSettings();
  // Pedido explícito (Bloque 49): el asunto siempre lleva algo que lo
  // distinga (acá, el nombre) para que no se vea idéntico en cada envío.
  const subject = fullName ? `${fullName}, tu código para restablecer la contraseña` : "Tu código para restablecer la contraseña";
  const html = await emailShell({
    preview: "Usa este código para restablecer tu contraseña — vence en 15 minutos",
    title: "Restablecer contraseña",
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${fullName ?? ""}, usa este código para restablecer tu contraseña. Vence en <strong>15 minutos</strong>.`)}
      ${codeBlock(code)}
      ${smallNote("Si no pediste este cambio, ignora este correo — tu contraseña actual sigue funcionando sin cambios.")}
      ${ctaButton(`Ir a ${siteName}`, `${env.frontendUrl}/cuenta`)}
    `,
  });
  return { subject, html };
}
