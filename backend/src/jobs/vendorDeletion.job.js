import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { finalizeUserDeletion } from "../lib/accountDeletion.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";

// Bloque 272 (pedido explícito): una tienda que el admin eliminó queda en "eliminación
// pendiente"; si en `vendorDeletionDays` días (30 por defecto, configurable en Seguridad) el
// admin no la restaura ni la elimina, se elimina sola. Una vez al día en 2 pasos: aviso al
// admin 3 días antes y borrado final al cumplirse el plazo. Idempotente (el aviso se marca).

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS_BEFORE = 3;

async function deletionDays() {
  const s = await prisma.siteSettings.findFirst({ select: { vendorDeletionDays: true } });
  return s?.vendorDeletionDays ?? 30;
}

async function sendReminders(days) {
  const reminderThreshold = new Date(Date.now() - Math.max(days - REMINDER_DAYS_BEFORE, 0) * DAY_MS);
  const dueThreshold = new Date(Date.now() - days * DAY_MS);
  const vendors = await prisma.vendor.findMany({
    where: { deletedAt: null, adminDeletionRequestedAt: { lte: reminderThreshold, gt: dueThreshold }, adminDeletionReminderSentAt: null },
    select: { id: true, companyName: true, adminDeletionRequestedAt: true },
  });
  for (const v of vendors) {
    const when = new Date(v.adminDeletionRequestedAt.getTime() + days * DAY_MS).toLocaleDateString("es-CU");
    await notifyAdminActionNeeded(
      `La tienda "${v.companyName}" se eliminará definitivamente el ${when}`,
      `La tienda "${v.companyName}" está en eliminación pendiente y se eliminará sola el ${when}.\n\nSi quieres conservarla, entra a Admin → Tiendas → filtro "Eliminación pendiente" y restáurala.`,
      v.id
    );
    await prisma.vendor.update({ where: { id: v.id }, data: { adminDeletionReminderSentAt: new Date() } });
  }
  return vendors.length;
}

async function finalizeDue(days) {
  const dueThreshold = new Date(Date.now() - days * DAY_MS);
  const vendors = await prisma.vendor.findMany({
    where: { deletedAt: null, adminDeletionRequestedAt: { lte: dueThreshold } },
    select: { id: true, userId: true, companyName: true },
  });
  for (const v of vendors) {
    await finalizeUserDeletion(v.userId);
    await notifyAdminActionNeeded(`Tienda eliminada definitivamente: ${v.companyName}`, `Pasaron ${days} días sin que se restaurara y la tienda "${v.companyName}" se eliminó definitivamente.`);
  }
  return vendors.length;
}

export async function runVendorDeletionJob() {
  const days = await deletionDays();
  const reminders = await sendReminders(days);
  const finalized = await finalizeDue(days);
  console.log(`[vendorDeletionJob] plazo=${days}d recordatorios=${reminders} eliminadas=${finalized}`);
  return { reminders, finalized };
}

// Una vez al día, 9:45am hora Cuba (9:30 ya es accountDeletion).
export function startVendorDeletionJob() {
  cron.schedule(
    "45 9 * * *",
    () => {
      runVendorDeletionJob().catch((err) => console.error("[vendorDeletionJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
