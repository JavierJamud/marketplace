import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { resolveReportTarget } from "../controllers/reports.controller.js";
import {
  sendFraudReportEvidenceRequestedEmail,
  sendFraudReportDismissedEmail,
  sendFraudReportSuspendedEmail,
} from "../lib/email.js";

// Feature B — mismo patrón dual (VendorNotification + email) que
// vendorSuspensionNotify.service.js, pero acá el objetivo puede NO ser una
// tienda (un dueño de venta rápida sin cuenta de vendedor no tiene
// campanita propia — ver CustomerListing) así que la fila de
// VendorNotification solo se crea cuando kind==="VENDOR".
function ctaUrlFor(target) {
  return target.kind === "VENDOR" ? `${env.frontendUrl}/vendedor/reportes` : `${env.frontendUrl}/cuenta/panel?tab=quick-sale`;
}

export async function notifyEvidenceRequested(report, deadlineDays, { isLastReminder = false } = {}) {
  const target = await resolveReportTarget(report);
  const ctaUrl = ctaUrlFor(target);
  const tasks = [
    sendFraudReportEvidenceRequestedEmail(target.user, target.vendorId, {
      targetLabel: target.label,
      message: report.message,
      deadlineDays,
      ctaUrl,
      isLastReminder,
    }),
  ];
  // El recordatorio (isLastReminder) no duplica la fila de VendorNotification
  // — ya quedó la del pedido original, y la campanita no distingue "nuevo
  // aviso" de "recordatorio del mismo aviso" (el correo sí lo aclara).
  if (target.kind === "VENDOR" && !isLastReminder) {
    tasks.push(
      prisma.vendorNotification.create({
        data: {
          vendorId: target.vendorId,
          type: "FRAUD_REPORT_EVIDENCE_REQUESTED",
          title: "Reportaron tu tienda/producto",
          body: `Tienes ${deadlineDays} días para responder con evidencia o se suspende por fraude.`,
        },
      })
    );
  }
  await Promise.all(tasks);
}

export async function notifyDismissed(report) {
  const target = await resolveReportTarget(report);
  const ctaUrl = ctaUrlFor(target);
  const tasks = [sendFraudReportDismissedEmail(target.user, target.vendorId, { targetLabel: target.label, ctaUrl })];
  if (target.kind === "VENDOR") {
    tasks.push(
      prisma.vendorNotification.create({
        data: {
          vendorId: target.vendorId,
          type: "FRAUD_REPORT_DISMISSED",
          title: "Reporte cerrado sin acción",
          body: `Revisamos el reporte sobre tu ${target.label} y no se toma ninguna acción.`,
        },
      })
    );
  }
  await Promise.all(tasks);
}

export async function notifySuspended(report, reason) {
  const target = await resolveReportTarget(report);
  const tasks = [sendFraudReportSuspendedEmail(target.user, target.vendorId, { targetLabel: target.label, reason })];
  if (target.kind === "VENDOR") {
    tasks.push(
      prisma.vendorNotification.create({
        data: { vendorId: target.vendorId, type: "FRAUD_REPORT_SUSPENDED", title: "Suspendido por fraude", body: reason },
      })
    );
  }
  await Promise.all(tasks);
}
