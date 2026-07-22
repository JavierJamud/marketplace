import { env } from "../config/env.js";
import { emailShell, ctaButton } from "./_shared.js";

// Bloque 47: mismo patrón visual que passwordReset.js — código de 6 dígitos
// para el segundo paso del login (2FA opt-in), nunca el mismo hash/campo
// que el reset de contraseña (ver User.twoFactorCodeHash en schema.prisma).
export function twoFactorCodeEmail({ fullName, code }) {
  const subject = "Tu código de verificación en dos pasos";
  const html = emailShell({
    title: "Verificación en dos pasos",
    storeName: "ZeuDin",
    bodyHtml: `
      <p style="color:#44474c;font-size:14px;line-height:21px;">Hola ${fullName ?? ""}, alguien está iniciando sesión en tu cuenta. Usá este código para completar el ingreso — vence en <strong>10 minutos</strong>.</p>
      <div style="margin:22px 0;text-align:center;">
        <span style="display:inline-block;padding:16px 28px;border-radius:10px;background:#f0edee;font-family:'Courier New',monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:#1b1b1d;">${code}</span>
      </div>
      <p style="color:#75777c;font-size:12.5px;line-height:19px;">Si no intentaste ingresar, cambiá tu contraseña — alguien más la tiene.</p>
      ${ctaButton("Ir a ZeuDin", `${env.frontendUrl}/cuenta`)}
    `,
  });
  return { subject, html };
}
