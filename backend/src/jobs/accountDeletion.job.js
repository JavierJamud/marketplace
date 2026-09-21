import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendAccountDeletionReminderEmail, sendAccountDeletionCompletedEmail } from "../lib/email.js";
import { finalizeUserDeletion } from "../lib/accountDeletion.js";

// Bloque 211 (pedido explícito — auto-eliminación de cuenta, cliente/
// vendedor/personal, con 30 días de gracia): corre una vez al día en 2
// pasos, en este orden — recordatorio de 7 días -> borrado final a los 30.
// Idempotente por diseño, mismo criterio que vendorLifecycle.job.js:
// deletionReminderSentAt evita mandar el recordatorio 2 veces si el cron se
// cae un día y corre tarde; deletedAt (puesto por finalizeUserDeletion) saca
// a la cuenta de la lista de "pendientes" apenas se finaliza.

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS_BEFORE = 7;
const GRACE_PERIOD_DAYS = 30;

// --- 1: recordatorio a los 23 días (7 antes del borrado final) --------------
async function sendDeletionReminders() {
  const reminderThreshold = new Date(Date.now() - (GRACE_PERIOD_DAYS - REMINDER_DAYS_BEFORE) * DAY_MS);
  // `gt: dueThreshold` evita el caso feo de un cron que se atrasó varios
  // días: sin este piso, alguien que ya pasó los 30 días recibiría el
  // recordatorio de "te quedan 7 días" y el de "ya se eliminó" en la misma
  // corrida — acá directamente se saltea el recordatorio y pasa derecho a
  // finalizeDueDeletions() de abajo.
  const dueThreshold = new Date(Date.now() - GRACE_PERIOD_DAYS * DAY_MS);

  const candidates = await prisma.user.findMany({
    where: { deletionRequestedAt: { lte: reminderThreshold, gt: dueThreshold }, deletionReminderSentAt: null, deletedAt: null },
  });

  let sent = 0;
  for (const user of candidates) {
    const scheduledFor = new Date(user.deletionRequestedAt.getTime() + GRACE_PERIOD_DAYS * DAY_MS);
    await sendAccountDeletionReminderEmail(user, scheduledFor);
    await prisma.user.update({ where: { id: user.id }, data: { deletionReminderSentAt: new Date() } });
    sent++;
  }
  return sent;
}

// --- 2: borrado final a los 30 días -----------------------------------------
async function finalizeDueDeletions() {
  const dueThreshold = new Date(Date.now() - GRACE_PERIOD_DAYS * DAY_MS);

  const candidates = await prisma.user.findMany({
    where: { deletionRequestedAt: { lte: dueThreshold }, deletedAt: null },
  });

  let finalized = 0;
  for (const user of candidates) {
    // El correo final va a la dirección REAL — finalizeUserDeletion() la
    // reescribe por la anonimizada, así que el orden acá importa.
    await sendAccountDeletionCompletedEmail(user);
    await finalizeUserDeletion(user.id);
    finalized++;
  }
  return finalized;
}

// Exportado por separado (no solo el scheduler) para poder correrlo a mano
// en un smoke test sin esperar al horario del cron.
export async function runAccountDeletionJob() {
  const reminders = await sendDeletionReminders();
  const finalized = await finalizeDueDeletions();
  console.log(`[accountDeletionJob] recordatorios=${reminders} finalizadas=${finalized}`);
  return { reminders, finalized };
}

// Una vez al día, 9:30am hora Cuba — horario libre, ningún otro cron corre
// ahí (7:00/7:30/8:00/8:30/9:00 ya están tomados, ver server.js).
export function startAccountDeletionJob() {
  cron.schedule(
    "30 9 * * *",
    () => {
      runAccountDeletionJob().catch((err) => console.error("[accountDeletionJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
