import { env } from "../config/env.js";
import { emailShell, ctaButton, smallNote, paragraph } from "./_shared.js";
import { getBrandSettings } from "../controllers/settings.controller.js";

// Feature B (pedido explícito): "pedir evidencia... con un plazo — si no se
// envía, se suspende por fraude". fullName/targetLabel/message = quién es,
// qué le reportaron y por qué; deadlineDays/ctaUrl = cuánto tiempo tiene y
// a dónde ir a responder (distinto según sea vendedor o dueño de venta
// rápida, ver fraudReportNotify.service.js).
export async function fraudReportEvidenceRequestedEmail({ fullName, targetLabel, message, deadlineDays, ctaUrl }) {
  const { siteName } = await getBrandSettings();
  const subject = `Reportaron tu ${targetLabel} — necesitamos que respondas`;
  const html = await emailShell({
    preview: `Tienes ${deadlineDays} días para responder antes de que se suspenda`,
    title: "Un cliente reportó tu publicación",
    badge: { label: "Acción requerida", color: "#ba1a1a" },
    storeName: siteName,
    bodyMjml: `
      ${paragraph(`Hola ${fullName ?? ""}, un cliente reportó tu <strong>${targetLabel}</strong> por posible fraude. Esto fue lo que dijo:`)}
      ${paragraph(`"${message}"`, { color: "#232F3E", padding: "0 0 14px", size: "13.5px" })}
      ${smallNote(`Tienes <strong>${deadlineDays} días</strong> para responder con una explicación (y, si tienes, una captura que lo respalde). Si no respondes a tiempo, se suspende automáticamente por fraude.`)}
      ${paragraph("Si esto es un malentendido o ya resolviste el problema con el cliente, cuéntanoslo — no se toma ninguna acción si tu explicación es razonable.")}
      ${ctaButton("Responder al reporte", ctaUrl)}
    `,
  });
  return { subject, html };
}
