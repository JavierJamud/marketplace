import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Feature B (pedido explícito): "pedir evidencia... con un plazo — si no se
// envía, se suspende por fraude". fullName/targetLabel/message = quién es,
// qué le reportaron y por qué; deadlineDays/ctaUrl = cuánto tiempo tiene y
// a dónde ir a responder (distinto según sea vendedor o dueño de venta
// rápida, ver fraudReportNotify.service.js).
export async function fraudReportEvidenceRequestedEmail({ fullName, targetLabel, message, deadlineDays, ctaUrl, isLastReminder = false }) {
  const { siteName } = await getBrandSettings();
  const subject = isLastReminder
    ? `Último aviso: mañana se suspende tu ${targetLabel} si no respondes`
    : `Reportaron tu ${targetLabel} — necesitamos que respondas`;
  const html = await emailShell({
    preview: isLastReminder ? "Mañana vence el plazo para responder" : `Tienes ${deadlineDays} días para responder antes de que se suspenda`,
    title: isLastReminder ? "Último aviso antes de suspender" : "Un cliente reportó tu publicación",
    badge: { label: isLastReminder ? "Vence mañana" : "Acción requerida", color: "#ba1a1a" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(
        isLastReminder
          ? `Hola ${fullName ?? ""}, este es un recordatorio: mañana vence el plazo para responder al reporte sobre tu <strong>${targetLabel}</strong>. Si no respondes, se suspende automáticamente por fraude.`
          : `Hola ${fullName ?? ""}, un cliente reportó tu <strong>${targetLabel}</strong> por posible fraude. Esto fue lo que dijo:`
      )}
      ${!isLastReminder ? paragraph(`"${message}"`, { color: "#232F3E", padding: "0 0 14px", size: "13.5px" }) : ""}
      ${smallNote(`Tienes <strong>${deadlineDays} días</strong> desde el reporte para responder con una explicación (y, si tienes, una captura que lo respalde). Si no respondes a tiempo, se suspende automáticamente por fraude.`)}
      ${paragraph("Si esto es un malentendido o ya resolviste el problema con el cliente, cuéntanoslo — no se toma ninguna acción si tu explicación es razonable.")}
      ${ctaButton("Responder al reporte", ctaUrl)}
    `,
  });
  return { subject, html };
}
