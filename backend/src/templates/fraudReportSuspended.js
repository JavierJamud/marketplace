import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// autoResolved:true (venció el plazo sin respuesta) o el admin decidió
// suspender tras revisar — un solo template para ambos casos, `reason`
// distingue el motivo real en el cuerpo.
export async function fraudReportSuspendedEmail({ fullName, targetLabel, reason }) {
  const { siteName } = await getBrandSettings();
  const subject = `Tu ${targetLabel} fue suspendido por fraude`;
  const html = await emailShell({
    preview: `Se suspendió: ${reason}`,
    title: "Suspendido por reporte de fraude",
    badge: { label: "Suspendido", color: "#ba1a1a" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${fullName ?? ""}, tu <strong>${targetLabel}</strong> fue suspendido: <strong>${reason}</strong>.`)}
      ${smallNote("Si crees que esto es un error, contáctanos — un admin puede revisar el caso de nuevo.")}
      ${paragraph("Nada se borra — tus datos siguen intactos, solo dejó de estar visible públicamente.")}
      ${ctaButton("Contactar soporte", `${env.frontendUrl}/contacto`)}
    `,
  });
  return { subject, html };
}
