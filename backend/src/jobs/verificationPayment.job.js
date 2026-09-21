import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendVerificationPaymentReminderEmail } from "../lib/email.js";
import { transitionVendorVerification } from "../services/vendorVerification.service.js";

// Bloque 64: segundo cron del proyecto (el primero fue vendorLifecycle.job.js
// en Bloque 62) — cobro recurrente. A diferencia de una suscripción real de
// Stripe (que vence sus propias facturas solo, vía webhook), acá no hay
// pasarela que avise nada — el único reloj que existe es este.
// Bloque 150: antes cubría solo CUP_TRANSFER (el pago con tarjeta era una
// Subscription real de Stripe, que vencía sola). Ahora CARD también es un
// pago ÚNICO por un bloque de N meses (1..24, elegidos por el vendedor) —
// sin ninguna suscripción real detrás, así que también necesita este mismo
// reloj para el recordatorio/vencimiento. El filtro real para separar los 2
// mundos es `stripeSubscriptionId: null` — una tienda con una Subscription
// de Stripe REAL (creada antes de este bloque, `mode:"subscription"`)
// sigue gobernada 100% por los webhooks (invoice.payment_succeeded/failed,
// customer.subscription.deleted), nunca por este cron; cualquier otra
// (CUP_TRANSFER de siempre, o CARD nuevo estilo "pago único de N meses")
// entra acá. Corre 1 vez al día, 3 pasos en orden: cancelaciones diferidas
// que ya llegaron a su fecha -> recordatorio a 7 días del vencimiento ->
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
      stripeSubscriptionId: null,
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
      stripeSubscriptionId: null,
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
      stripeSubscriptionId: null,
    },
  });

  let expired = 0;
  for (const vendor of vendors) {
    await transitionVendorVerification(vendor.id, "PAYMENT_FAILED", {
      source: "CRON_EXPIRATION",
      reason: "Venció el ciclo de pago sin una confirmación nueva.",
      notify: { type: "VERIFICATION_PAYMENT_FAILED" },
    });
    expired++;
  }
  return expired;
}

// --- 4: vencimiento de la APROBACIÓN inicial (24h) --------------------------
// Bloque 145 (pedido explícito — "las solicitudes demorarán 24 horas luego de
// ser aprobada... si no se selecciona la forma de pago adecuada y no se
// realiza el pago y se confirma, automáticamente se deberán enviar nuevos
// datos al sistema"): distinto de expireOverduePayments de arriba (esa es la
// RENOVACIÓN mensual de una tienda YA verificada) — esto es la primera vez,
// entre que un admin aprueba los documentos (PENDING_PAYMENT) y el vendedor
// de verdad completa el pago (VERIFIED). Sin este paso, un vendedor podía
// quedarse en PENDING_PAYMENT indefinidamente sin ninguna presión de tiempo
// real, contra lo pedido explícitamente. "Cuándo se aprobó" se lee del
// historial real (VerificationStatusLog, ya existía desde Bloque 64) — la
// entrada MÁS RECIENTE con toStatus:"PENDING_PAYMENT" de cada tienda, nunca
// un campo aparte que se podría desincronizar.
const PENDING_PAYMENT_DEADLINE_MS = 24 * 60 * 60 * 1000;

export async function expireStalePendingPaymentApprovals() {
  const vendors = await prisma.vendor.findMany({
    where: { verificationStatus: "PENDING_PAYMENT" },
    include: {
      verificationStatusLogs: { where: { toStatus: "PENDING_PAYMENT" }, orderBy: { at: "desc" }, take: 1 },
    },
  });

  let expired = 0;
  for (const vendor of vendors) {
    const enteredAt = vendor.verificationStatusLogs[0]?.at;
    // Sin registro de cuándo entró (no debería pasar nunca) — no se toca,
    // mejor no expirar por las dudas a que se expire de más por un dato
    // faltante.
    if (!enteredAt || Date.now() - enteredAt.getTime() < PENDING_PAYMENT_DEADLINE_MS) continue;

    await transitionVendorVerification(vendor.id, "REJECTED", {
      source: "CRON_EXPIRATION",
      reason: "No se eligió un método de pago ni se confirmó el pago dentro de las 24 horas luego de la aprobación de documentos.",
      notify: { type: "VERIFICATION_APPROVAL_EXPIRED" },
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

// Bloque 145: cada hora, aparte del cron diario de arriba a propósito — un
// plazo de "24 horas" chequeado una vez al día (como el resto de este
// archivo) podría hacerse cumplir hasta casi 48h tarde en el peor caso
// (aprobado justo después de correr el cron de ese día). Cada hora mantiene
// el vencimiento real dentro de máximo ~1h del plazo prometido.
export function startVerificationApprovalExpiryJob() {
  cron.schedule("0 * * * *", () => {
    expireStalePendingPaymentApprovals().then((expired) => {
      if (expired > 0) console.log(`[verificationApprovalExpiryJob] aprobaciones vencidas=${expired}`);
    }).catch((err) => console.error("[verificationApprovalExpiryJob] error:", err));
  });
}
