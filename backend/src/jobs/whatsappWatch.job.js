import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { notifyAdmins } from "../lib/notify.js";
import { SESSION_ID, getSession, workerAlive } from "../whatsapp/outbox.js";

// Vigila el WhatsApp de la plataforma y le avisa al admin (campana, push) cuando necesita que haga algo.

const MIN = 60 * 1000;
const DAY = 24 * 60 * MIN;
// Una caída corta se arregla sola (el proceso reconecta): solo se avisa si dura.
const DOWN_AFTER_MS = 10 * MIN;
const DOWN_REPEAT_MS = 6 * 60 * MIN;
// WhatsApp cierra los dispositivos vinculados si el teléfono principal pasa unos 14 días sin abrir la app.
const PHONE_REMINDER_MS = 10 * DAY;
const KEEP_MESSAGES_MS = 30 * DAY;
const KEEP_VERIFICATIONS_MS = 2 * DAY;
const PANEL_URL = "/admin/whatsapp";

let downSince = 0;

function setSession(data) {
  return prisma.whatsappSession.update({ where: { id: SESSION_ID }, data });
}

function alertDue(session, everyMs) {
  return !session.downAlertAt || Date.now() - new Date(session.downAlertAt).getTime() > everyMs;
}

export async function runWhatsappWatchJob() {
  const session = await getSession();
  const now = new Date();

  if (session.status === "LOGGED_OUT") {
    // La sesión se cerró desde fuera: no vuelve sola, hay que escanear el QR otra vez.
    downSince = 0;
    if (alertDue(session, DAY)) {
      await setSession({ downAlertAt: now });
      await notifyAdmins({
        category: "errors",
        title: session.lastError === "BLOCKED" ? "WhatsApp rechazó el número de la plataforma" : "El WhatsApp de la plataforma se desvinculó",
        body: session.lastError === "BLOCKED"
          ? "No se están enviando avisos ni códigos. Revisa el número en el teléfono antes de vincularlo otra vez."
          : "No se están enviando avisos ni códigos. Escanea el QR de nuevo para volver a conectarlo.",
        url: PANEL_URL, tag: "whatsapp-down",
        // Por WhatsApp no: el aviso es justamente que WhatsApp no envía, y llegaría tarde, cuando ya volvió.
        whatsapp: false,
      });
    }
  } else if (session.desired === "ON" && session.status !== "QR") {
    const healthy = session.status === "CONNECTED" && workerAlive(session);
    if (healthy) downSince = 0;
    else {
      if (!downSince) downSince = Date.now();
      if (Date.now() - downSince >= DOWN_AFTER_MS && alertDue(session, DOWN_REPEAT_MS)) {
        await setSession({ downAlertAt: now });
        await notifyAdmins({
          category: "errors",
          title: "El WhatsApp de la plataforma lleva rato sin conexión",
          body: workerAlive(session)
            ? "El proceso sigue intentando conectar. Los avisos quedan en cola y salen cuando vuelva."
            : "El proceso de WhatsApp no está corriendo en el servidor. Los avisos quedan en cola hasta que arranque.",
          url: PANEL_URL, tag: "whatsapp-down",
        // Por WhatsApp no: el aviso es justamente que WhatsApp no envía, y llegaría tarde, cuando ya volvió.
        whatsapp: false,
        });
      }
    }
  } else {
    downSince = 0;
  }

  // Recordatorio de abrir WhatsApp en el teléfono de la empresa, para que la sesión vinculada no caduque.
  if (session.desired === "ON" && session.status === "CONNECTED") {
    if (!session.phoneReminderAt) await setSession({ phoneReminderAt: now });
    else if (Date.now() - new Date(session.phoneReminderAt).getTime() > PHONE_REMINDER_MS) {
      await setSession({ phoneReminderAt: now });
      await notifyAdmins({
        category: "errors",
        title: "Abre WhatsApp en el teléfono de la plataforma",
        body: "Si ese teléfono pasa unos 14 días sin abrir WhatsApp con conexión, la sesión vinculada se cierra y hay que escanear el QR otra vez.",
        url: PANEL_URL, tag: "whatsapp-phone",
      });
    }
  } else if (session.desired !== "ON" && session.phoneReminderAt) {
    await setSession({ phoneReminderAt: null });
  }

  await prisma.whatsappMessage.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MESSAGES_MS) } } });
  await prisma.whatsappVerification.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_VERIFICATIONS_MS) } } });
}

export function startWhatsappWatchJob() {
  cron.schedule("*/2 * * * *", () => runWhatsappWatchJob().catch((err) => console.error("[whatsappWatch] error:", err)), { timezone: "America/Havana" });
}
