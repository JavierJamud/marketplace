import { emailShell, ctaButton, smallNote, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { env } from "../config/env.js";

// El admin revisó la evidencia y decidió que no hay fraude — nada se
// suspende, nada cambia. Mismo criterio que vendorReactivated.js: avisar
// aunque la noticia sea buena, para que quede claro que el caso se cerró.
export async function fraudReportDismissedEmail({ fullName, targetLabel, ctaUrl }) {
  const { siteName } = await getBrandSettings();
  const subject = `Revisamos el reporte sobre tu ${targetLabel} — todo en orden`;
  const html = await emailShell({
    preview: "Revisamos tu respuesta y no vamos a tomar ninguna acción",
    title: "Reporte cerrado sin acción",
    badge: { label: "Resuelto", color: "#0CAE53" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${fullName ?? ""}, revisamos el reporte sobre tu <strong>${targetLabel}</strong> junto con tu respuesta y no vamos a tomar ninguna acción — sigue funcionando con normalidad.`)}
      ${smallNote("Gracias por responder a tiempo. Esto no queda como un antecedente contra tu cuenta.")}
      ${ctaButton(`Ir a ${siteName}`, ctaUrl ?? env.frontendUrl)}
    `,
  });
  return { subject, html };
}
