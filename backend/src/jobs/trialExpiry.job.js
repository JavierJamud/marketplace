import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendTrialExpiringSoonEmail } from "../lib/email.js";
import { transitionVendorVerification, reconcilePlanVerification } from "../services/vendorVerification.service.js";
import { applyScheduledDowngrades } from "../services/planDowngrade.service.js";
import { pauseVerifiedWithoutDocuments } from "../services/pendingActivation.service.js";
import { getDefaultPlanKey, getAllPlanConfigs } from "../lib/planConfig.js";

// Bloque 235 (pedido explícito — trial gratuito de 30 días del plan de
// prueba, hoy Premium): mismo molde EXACTO que verificationPayment.job.js (incluyendo
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
    const range = dayRange(daysLeft);
    const vendors = await prisma.vendor.findMany({
      // Las pruebas con tarjeta las cobra Stripe sola al terminar: no reciben el aviso de "tu prueba se acaba, elige cómo pagar".
      // Si el admin ya programó el paso al plan por defecto, el aviso de "elige cómo pagar" no aplica.
      // Tampoco a la que ya pagó una renovación durante la prueba (el aviso la invita a hacerlo): su tiempo pagado sigue
      // después del final de la prueba.
      where: {
        verificationStatus: "VERIFIED",
        trialEndsAt: range,
        stripeSubscriptionId: null,
        planDowngradeAt: null,
        OR: [{ nextPaymentDueDate: null }, { nextPaymentDueDate: { lt: range.gte } }],
      },
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
// No pasa por SUSPENDED (eso es revokeBusinessPlan, una acción punitiva de admin): vuelve al plan por defecto (PLAN_ENDED).
// Pedido explícito: el plan por defecto no lleva insignia, así que al terminar la prueba la pierde junto con las funciones
// de pago. Conserva los documentos aprobados para volver a un plan de pago pagando.
// Antes miraba solo planType "BUSINESS". Ahora entra toda prueba vencida que no esté ya en el plan por defecto: si el admin
// cambia cuál es el plan de prueba, las pruebas que empezaron con el anterior también vencen (con la clave fija se
// quedaban para siempre con las funciones de pago).
async function expireTrials() {
  const now = new Date();
  const defaultKey = await getDefaultPlanKey();
  const names = new Map((await getAllPlanConfigs({ includeArchived: true })).map((c) => [c.planType, c.displayName]));
  // Una tienda en prueba puede pagar una renovación antes de que termine (el aviso de la prueba se lo pide). Cuando el admin
  // la confirma queda con nextPaymentDueDate en el futuro, pero trialEndsAt sigue puesto: sin este paso, el vencimiento de
  // abajo la pasaba al plan por defecto con meses pagados. Aquí solo deja de estar en prueba y sigue con su plan; el cobro
  // de ese plan lo vigila desde ahora verificationPayment.job.js por nextPaymentDueDate.
  await prisma.vendor.updateMany({
    where: { trialEndsAt: { lt: now }, nextPaymentDueDate: { gt: now }, stripeSubscriptionId: null },
    data: { trialEndsAt: null },
  });
  const vendors = await prisma.vendor.findMany({
    // Con tarjeta, el final de la prueba lo resuelve Stripe (cobra el primer mes o avisa del fallo): este reloj no la toca.
    where: {
      trialEndsAt: { lt: now },
      planType: { not: defaultKey },
      stripeSubscriptionId: null,
      OR: [{ nextPaymentDueDate: null }, { nextPaymentDueDate: { lte: now } }],
    },
  });

  let expired = 0;
  for (const vendor of vendors) {
    await transitionVendorVerification(vendor.id, "PLAN_ENDED", {
      source: "CRON_EXPIRATION",
      reason: `Venció la prueba gratis del plan ${names.get(vendor.planType) ?? vendor.planType}.`,
      extraData: { trialEndsAt: null },
      notify: { type: "TRIAL_EXPIRED" },
      planChangeReason: "trial_end",
    });
    expired++;
  }
  return expired;
}

// Exportado por separado (no solo el scheduler) para poder correrlo a mano
// en un smoke test sin esperar al horario del cron.
export async function runTrialExpiryJob() {
  // Primero los cambios al plan por defecto que programó el admin: así una prueba que vence el mismo día queda resuelta una
  // sola vez.
  const downgraded = await applyScheduledDowngrades();
  const reminders = await sendTrialExpiringSoonReminders();
  const expired = await expireTrials();
  await reconcilePlanVerification();
  // Insignia sin documento de identidad o selfie: se pausa hasta completar la verificación (pendingActivation.service.js).
  const paused = await pauseVerifiedWithoutDocuments();
  if (paused) console.log(`[trialExpiryJob] insignias pausadas por falta de documentos=${paused}`);
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
