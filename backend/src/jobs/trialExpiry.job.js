import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendTrialExpiringSoonEmail } from "../lib/email.js";
import { transitionVendorVerification } from "../services/vendorVerification.service.js";
import { recalcVendorProductQuota } from "../lib/planConfig.js";
import { applyScheduledDowngrades } from "../services/planDowngrade.service.js";

// Bloque 235 (pedido explícito — trial gratuito de 30 días del Plan
// Premium): mismo molde EXACTO que verificationPayment.job.js (incluyendo
// el helper dayRange) — 2 pasos en orden: recordatorios a 7/3/1 días antes
// -> vencimiento real si nadie convirtió el trial en una suscripción paga
// antes de la fecha.

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS_BEFORE = [7, 3, 1];

function dayRange(daysFromNow) {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + DAY_MS);
  return { gte: start, lt: end };
}

// --- 1: recordatorios a 7/3/1 días antes del vencimiento -------------------
async function sendTrialExpiringSoonReminders() {
  let sent = 0;
  for (const daysLeft of REMINDER_DAYS_BEFORE) {
    const vendors = await prisma.vendor.findMany({
      // Las pruebas con tarjeta las cobra Stripe sola al terminar: no reciben el aviso de "tu prueba se acaba, elige cómo pagar".
      // Si el admin ya programó el paso a Regular, el aviso de "elige cómo pagar" no aplica.
      where: { verificationStatus: "VERIFIED", trialEndsAt: dayRange(daysLeft), stripeSubscriptionId: null, planDowngradeAt: null },
      include: { user: true },
    });
    for (const vendor of vendors) {
      await sendTrialExpiringSoonEmail(vendor, daysLeft);
      sent++;
    }
  }
  return sent;
}

// --- 2: vencimiento real — nadie convirtió el trial a tiempo ---------------
// Bloque 235 (pedido explícito — "no debe suspenderse ni perder el sello"):
// a propósito NO pasa por SUSPENDED (eso es revokeBusinessPlan, una acción
// punitiva de admin) — toStatus sigue siendo "VERIFIED" (ya lo era), solo
// cambia planType en extraData. El sello de verificado queda intacto, solo
// se pierden las funciones Premium (isPremiumActive exige AMBAS cosas).
async function expireTrials() {
  const vendors = await prisma.vendor.findMany({
    // Con tarjeta, el final de la prueba lo resuelve Stripe (cobra el primer mes o avisa del fallo): este reloj no la toca.
    where: { trialEndsAt: { lt: new Date() }, planType: "BUSINESS", stripeSubscriptionId: null },
  });

  let expired = 0;
  for (const vendor of vendors) {
    await transitionVendorVerification(vendor.id, "VERIFIED", {
      source: "CRON_EXPIRATION",
      reason: "Venció el trial gratuito de 30 días del Plan Premium.",
      extraData: { planType: "REGULAR", trialEndsAt: null },
      notify: { type: "TRIAL_EXPIRED" },
    });
    await recalcVendorProductQuota(vendor.id);
    expired++;
  }
  return expired;
}

// Exportado por separado (no solo el scheduler) para poder correrlo a mano
// en un smoke test sin esperar al horario del cron.
export async function runTrialExpiryJob() {
  // Primero los cambios a Regular que programó el admin: así una prueba que vence el mismo día queda resuelta una sola vez.
  const downgraded = await applyScheduledDowngrades();
  const reminders = await sendTrialExpiringSoonReminders();
  const expired = await expireTrials();
  console.log(`[trialExpiryJob] cambios-a-regular=${downgraded} recordatorios=${reminders} vencidos=${expired}`);
  return { downgraded, reminders, expired };
}

// Una vez al día, 10:30am hora Cuba — después de reviewAnomalyJob (10:00,
// el último cron diario fijo que había antes de este) para no competir por
// la misma conexión de DB al mismo instante.
export function startTrialExpiryJob() {
  cron.schedule(
    "30 10 * * *",
    () => {
      runTrialExpiryJob().catch((err) => console.error("[trialExpiryJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
