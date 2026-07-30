import { env } from "../config/env.js";
import { emailShell, ctaButton, codeBlock, paragraph, smallNote } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Bloque 59: mismo patrón visual que twoFactorCode.js/passwordReset.js —
// código de 6 dígitos para verificar el correo ANTES de crear la cuenta
// (cliente o vendedor). Campos propios (User.registerCodeHash no existe
// porque acá todavía no hay User — ver PendingRegistration en schema.prisma).
export async function registrationCodeEmail({ fullName, code }) {
  const { siteName } = await getBrandSettings();
  const subject = fullName ? `${fullName}, confirma tu correo en ${siteName}` : `Confirma tu correo en ${siteName}`;
  const html = await emailShell({
    preview: "Usa este código para confirmar tu correo y terminar de crear tu cuenta",
    title: "Confirma tu correo",
    badge: { label: "Nueva cuenta", color: "#0CAE53" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${fullName ?? ""}, usa este código para confirmar tu correo y terminar de crear tu cuenta — vence en <strong>10 minutos</strong>.`)}
      ${codeBlock(code)}
      ${smallNote("Si no intentaste crear una cuenta, ignora este correo — no se creó nada todavía.")}
      ${ctaButton(`Ir a ${siteName}`, `${env.frontendUrl}/cuenta`)}
    `,
  });
  return { subject, html };
}
