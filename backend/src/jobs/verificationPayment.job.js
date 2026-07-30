import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendVerificationPaymentReminderEmail } from "../lib/email.js";
import { transitionVendorVerification } from "../services/vendorVerification.service.js";

// Bloque 64: segundo cron del proyecto (el primero fue vendorLifecycle.job.js
// en Bloque 62) — cobro recurrente por transferencia CUP. A diferencia de
// Stripe (que vence sus propias facturas solo, vía webhook), acá no hay
// pasarela que avise nada — el único reloj que existe es este. Cubre solo
// CUP_TRANSFER: una tienda que paga por Stripe nunca entra en ninguno de los
// pasos de abajo (su `nextPaymentDueDate` la actualiza el webhook de
// Stripe, es puramente informativa, y su cancelación diferida la resuelve
// customer.subscription.deleted — ver handleSubscriptionDeleted).
// Corre 1 vez al día, 3 pasos en orden: cancelaciones diferidas que ya
// llegaron a su fecha -> recordatorio a 7 días del vencimiento ->
// vencimiento real (PAYMENT_FAILED) si nadie confirmó un pago nuevo antes de
// la fecha.

const DAY_MS = 24 * 60 * 60 * 1000;
const REMINDER_DAYS_BEFORE = 7;

function dayRange(daysFromNow) {
  const start = new Date();
  start.setDate(start.getDate() + daysFromNow);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start.getTime() + DAY_MS);
  return { gte: start, lt: end };
}

// --- 1: cancelaciones diferidas (CUP) que ya llegaron a su fecha -----------
// Bloque 66 (pedido explícito): cancelar no revoca de inmediato — el
// vendedor sigue VERIFIED hasta esta fecha (ver updateMyVendor). Corre ANTES
// que el paso 3 (expireOverduePayments) a propósito: apenas transiciona acá,
// el vendedor deja de estar VERIFIED y ya no puede matchear esa otra query
// (que es para renovaciones que fallaron, no para cancelaciones a propósito).
async function processDeferredCancellations() {
  const vendors = await prisma.vendor.findMany({
    where: {
      verificationStatus: "VERIFIED",
      cancelAtPeriodEnd: true,
      nextPaymentDueDate: { lt: new Date() },
      verification: { paymentMethod: "CUP_TRANSFER" },
    },
  });

  let processed = 0;
  for (const vendor of vendors) {
    await transitionVendorVerification(vendor.id, "NOT_STARTED", {
      source: "CRON_EXPIRATION",
      reason: "Cancelación de suscripción efectiva — llegó la fecha de vencimiento del plan.",
      extraData: { stripeSubscriptionId: null, cancelAtPeriodEnd: false },
    });
    processed++;
  }
  return processed;
}

// --- 2: recordatorio a los 7 días antes del vencimiento --------------------
async function sendPaymentReminders() {
  const vendors = await prisma.vendor.findMany({
    where: {
      verificationStatus: "VERIFIED",
      nextPaymentDueDate: dayRange(REMINDER_DAYS_BEFORE),
      verification: { paymentMethod: "CUP_TRANSFER" },
    },
    include: { user: true },
  });

  let sent = 0;
  for (const vendor of vendors) {
    await sendVerificationPaymentReminderEmail(vendor, REMINDER_DAYS_BEFORE);
    sent++;
  }
  return sent;
}

// --- 3: vencimiento real — nadie confirmó un pago nuevo a tiempo -----------
async function expireOverduePayments() {
  const vendors = await prisma.vendor.findMany({
    where: {
      verificationStatus: "VERIFIED",
      // cancelAtPeriodEnd:true ya lo resuelve el paso 1 de arriba (cancelación
      // a propósito) — esto es solo para renovaciones que nadie confirmó.
      cancelAtPeriodEnd: false,
      nextPaymentDueDate: { lt: new Date() },
      verification: { paymentMethod: "CUP_TRANSFER" },
    },
  });

  let expired = 0;
  for (const vendor of vendors) {
    await transitionVendorVerification(vendor.id, "PAYMENT_FAILED", {
      source: "CRON_EXPIRATION",
      reason: "Venció el ciclo de pago CUP sin una confirmación nueva.",
      notify: { type: "VERIFICATION_PAYMENT_FAILED" },
    });
    expired++;
  }
  return expired;
}

// Exportado por separado (no solo el scheduler) para poder correrlo a mano
// en un smoke test sin esperar al horario del cron.
export async function runVerificationPaymentJob() {
  const cancellationsProcessed = await processDeferredCancellations();
  const reminders = await sendPaymentReminders();
  const expired = await expireOverduePayments();
  console.log(`[verificationPaymentJob] cancelaciones=${cancellationsProcessed} recordatorios=${reminders} vencidos=${expired}`);
  return { cancellationsProcessed, reminders, expired };
}

// Una vez al día, 8:30am hora Cuba (media hora después de vendorLifecycle.job.js
// para no competir por la misma conexión de DB al mismo instante) — arrancado
// desde server.js.
export function startVerificationPaymentJob() {
  cron.schedule(
    "30 8 * * *",
    () => {
      runVerificationPaymentJob().catch((err) => console.error("[verificationPaymentJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
