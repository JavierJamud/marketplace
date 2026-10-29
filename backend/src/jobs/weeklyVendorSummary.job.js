import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendVendorWeeklySummaryEmail } from "../lib/email.js";
import { buildVendorWeeklySummary, vendorPanelPath } from "../controllers/usage.controller.js";
import { logActivity } from "../lib/activityLog.js";

// Resumen semanal de cada tienda (pedido del dueño, 2026-10-29): todos los viernes a las 00:00, hora de Cuba, cada tienda
// registrada recibe en su correo el resumen de su semana hecho con IA (controllers/usage.controller.js). Uno por tienda,
// nunca una campaña. Se manda de a una, con una pausa entre cada una para no saturar a los proveedores de IA ni al correo.
//
// El último resumen enviado se guarda en UsageInsight con la clave "weekly:<tienda>": así un reinicio del servidor el mismo
// viernes no lo vuelve a mandar, y el admin puede ver qué se le envió.

const DAY_MS = 24 * 60 * 60 * 1000;
const PAUSE_MS = 4000;
const scopeOf = (vendorId) => `weekly:${vendorId}`;

// Envía el resumen a una tienda. `force` (el botón del admin) lo manda aunque ya haya recibido uno esta semana.
export async function sendWeeklySummaryToVendor(vendorId, { force = false, byAdminId = null } = {}) {
  if (!force) {
    const last = await prisma.usageInsight.findUnique({ where: { scope: scopeOf(vendorId) }, select: { updatedAt: true } });
    if (last && Date.now() - last.updatedAt.getTime() < 6 * DAY_MS) return { skipped: "ya_enviado" };
  }
  const summary = await buildVendorWeeklySummary(vendorId);
  if (!summary.to) return { skipped: "sin_correo" };
  const result = await sendVendorWeeklySummaryEmail({ ...summary, panelPath: vendorPanelPath });
  if (!result?.ok) return { error: result?.error ?? "No se pudo enviar el correo." };
  const data = { ...summary.insight, stats: summary.stats, pending: summary.pending, to: summary.to, sentAt: new Date().toISOString(), byAdminId };
  await prisma.usageInsight.upsert({ where: { scope: scopeOf(vendorId) }, create: { scope: scopeOf(vendorId), data }, update: { data } });
  if (byAdminId) {
    await logActivity({ actorId: byAdminId, actorRole: "ADMIN", vendorId, action: "weekly_summary_sent", description: `Envió a la tienda su resumen semanal a ${summary.to}.` });
  }
  return { sent: true, to: summary.to, summary };
}

export async function runWeeklyVendorSummaryJob() {
  const vendors = await prisma.vendor.findMany({ where: { deletedAt: null, isBlocked: false }, select: { id: true, companyName: true }, orderBy: { createdAt: "asc" } });
  let sent = 0;
  let skipped = 0;
  let failed = 0;
  for (const v of vendors) {
    try {
      const r = await sendWeeklySummaryToVendor(v.id);
      if (r.sent) sent++;
      else if (r.skipped) skipped++;
      else failed++;
      if (r.error) console.error(`[weeklyVendorSummary] ${v.companyName}: ${r.error}`);
    } catch (err) {
      // La IA puede fallar con una tienda (sin proveedores, respuesta inválida): se sigue con las demás.
      failed++;
      console.error(`[weeklyVendorSummary] ${v.companyName}:`, err?.message ?? err);
    }
    await new Promise((r) => setTimeout(r, PAUSE_MS));
  }
  console.log(`[weeklyVendorSummary] enviados=${sent} omitidos=${skipped} con error=${failed}`);
  return { sent, skipped, failed };
}

// Viernes a las 00:00, hora de Cuba.
export function startWeeklyVendorSummaryJob() {
  cron.schedule(
    "0 0 * * 5",
    () => {
      runWeeklyVendorSummaryJob().catch((err) => console.error("[weeklyVendorSummary] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
