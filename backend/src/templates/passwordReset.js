import { env } from "../config/env.js";
import { emailShell, ctaButton } from "./_shared.js";

// user: { fullName, email }, code: "123456"
export function passwordResetEmail({ fullName, code }) {
  const subject = "Tu código para restablecer la contraseña";
  const html = emailShell({
    title: "Restablecer contraseña",
    storeName: "ZeuDin",
    bodyHtml: `
      <p style="color:#44474c;font-size:14px;line-height:21px;">Hola ${fullName ?? ""}, usá este código para restablecer tu contraseña. Vence en <strong>15 minutos</strong>.</p>
      <div style="margin:22px 0;text-align:center;">
        <span style="display:inline-block;padding:16px 28px;border-radius:10px;background:#f0edee;font-family:'Courier New',monospace;font-size:32px;font-weight:800;letter-spacing:8px;color:#1b1b1d;">${code}</span>
      </div>
      <p style="color:#75777c;font-size:12.5px;line-height:19px;">Si no pediste este cambio, ignorá este correo — tu contraseña actual sigue funcionando sin cambios.</p>
      ${ctaButton("Ir a ZeuDin", `${env.frontendUrl}/cuenta`)}
    `,
  });
  return { subject, html };
}
