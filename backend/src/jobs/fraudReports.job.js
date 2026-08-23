import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { notifyEvidenceRequested, notifySuspended } from "../services/fraudReportNotify.service.js";
import { applyFraudConsequence } from "../controllers/adminReports.controller.js";

// Feature B (pedido explícito): "si no se envía evidencia dentro del plazo,
// la tienda se suspende por fraude" — mismo criterio de reloj único que
// verificationPayment.job.js (nadie más avisa esto solo, hay que correrlo
// una vez al día). 2 pasos en orden, igual que aquel: recordatorio 1 día
// antes de vencer -> vencimiento real (suspende) si nadie respondió.
//
// RIESGO ALTO (a diferencia de customerListingExpiry.job.js, que solo borra
// anuncios de 30 días de clientes sin tienda): este paso puede suspender una
// tienda real de producción. Por eso solo actúa cuando evidenceSentAt sigue
// null — si el reportado SÍ respondió a tiempo pero el admin todavía no
// decidió, el reporte queda tal cual (EVIDENCE_REQUESTED, visible en la cola
// de AdminFraudReports.jsx) — el cron nunca lo toca, la decisión sigue
// siendo de un admin.

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS_BEFORE = 1;

function dayRange(daysFromNow) {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + DAY_MS);
  return { gte: start, lt: end };
}

async function getDeadlineDays() {
  const settings = await prisma.siteSettings.findFirst({ select: { fraudReportEvidenceDeadlineDays: true } });
  return settings?.fraudReportEvidenceDeadlineDays ?? 5;
}

// --- 1: recordatorio 1 día antes de vencer, solo si nunca respondió --------
async function sendEvidenceReminders() {
  const reports = await prisma.report.findMany({
    where: { status: "EVIDENCE_REQUESTED", evidenceSentAt: null, evidenceDueAt: dayRange(REMINDER_DAYS_BEFORE) },
  });
  const deadlineDays = await getDeadlineDays();

  let sent = 0;
  for (const report of reports) {
    await notifyEvidenceRequested(report, deadlineDays, { isLastReminder: true });
    sent++;
  }
  return sent;
}

// --- 2: venció el plazo y nadie respondió — suspende solo -----------------
async function autoResolveExpiredReports() {
  const reports = await prisma.report.findMany({
    where: { status: "EVIDENCE_REQUESTED", evidenceSentAt: null, evidenceDueAt: { lt: new Date() } },
  });

  let resolved = 0;
  for (const report of reports) {
    const reason = "No respondió al pedido de evidencia dentro del plazo — suspendido automáticamente por fraude.";
    await applyFraudConsequence(report, reason);
    const updated = await prisma.report.update({
      where: { id: report.id },
      data: { status: "RESOLVED_SUSPENDED", autoResolved: true, resolvedById: null, resolvedAt: new Date(), resolutionNote: reason },
    });
    await notifySuspended(updated, reason);
    resolved++;
  }
  return resolved;
}

// Exportado por separado (no solo el scheduler) para poder correrlo a mano
// en un smoke test contra datos backdateados por psql — única forma real de
// probar "1 día antes"/"venció el plazo" sin esperar el tiempo real.
export async function runFraudReportsJob() {
  const reminders = await sendEvidenceReminders();
  const resolved = await autoResolveExpiredReports();
  console.log(`[fraudReportsJob] recordatorios=${reminders} auto-suspendidos=${resolved}`);
  return { reminders, resolved };
}

// 9:00am hora Cuba — después de los otros 3 crons diarios (7:00/8:00/8:30),
// para no competir por conexión de DB con ellos.
export function startFraudReportsJob() {
  cron.schedule(
    "0 9 * * *",
    () => {
      runFraudReportsJob().catch((err) => console.error("[fraudReportsJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
