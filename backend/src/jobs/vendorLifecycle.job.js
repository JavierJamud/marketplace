import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendVendorInactivityReminderEmail, sendVendorWinbackEmail } from "../lib/email.js";
import { notifyVendorSuspended } from "../services/vendorSuspensionNotify.service.js";

// Bloque 62 (pedido explícito): primer cron real de este proyecto — todo lo
// que antes era "tiempo real" (ver comentarios de offers.controller.js/
// storeOffers.controller.js sobre expiración perezosa) sigue así; esto es
// genuinamente nuevo porque no hay ningún evento del cliente que dispare
// "ya pasaron 7/90 días sin loguearte" — solo el paso del tiempo puede.
// Corre una vez al día (ver startVendorLifecycleJob) en 3 pasos, en este
// orden: recordatorio de 7 días -> suspensión a los 90 -> re-enganche de
// clientes. Idempotente por diseño: cada paso deja su propia marca
// (lastInactivityEmailAt, status/suspendedAt, WinbackEmailLog) para que un
// reinicio del servidor a mitad de corrida nunca duplique un envío.

const DAY_MS = 24 * 60 * 60 * 1000;
const INACTIVITY_REMINDER_DAYS = 7;
const SUSPENSION_DAYS = 90;
const WINBACK_MIN_ORDER_AGE_DAYS = 30;
const WINBACK_OFFER_LOOKBACK_HOURS = 24;

// "Último acceso real" de un vendedor — el login de SU cuenta (User), no
// nada de la tienda en sí. Sin login todavía (nunca entró desde que se
// registró), se cuenta desde que se creó la tienda — nunca se asume
// inactividad de una tienda más vieja que este bloque.
function lastAccessAt(vendor) {
  return vendor.user.lastLoginAt ?? vendor.createdAt;
}

function daysSince(date) {
  return Math.floor((Date.now() - date.getTime()) / DAY_MS);
}

// --- 3.1: recordatorio de 7 días sin acceder --------------------------------
async function sendInactivityReminders() {
  const sevenDaysAgo = new Date(Date.now() - INACTIVITY_REMINDER_DAYS * DAY_MS);

  const candidates = await prisma.vendor.findMany({
    where: {
      status: "ACTIVE",
      isBlocked: false,
      deletedAt: null,
      OR: [{ user: { lastLoginAt: { lte: sevenDaysAgo } } }, { user: { lastLoginAt: null }, createdAt: { lte: sevenDaysAgo } }],
    },
    include: { user: true },
  });

  let sent = 0;
  for (const vendor of candidates) {
    // Ya se le mandó uno hace menos de 7 días — se re-envía cada 7 días de
    // inactividad continua (día 7, 14, 21...), nunca todos los días.
    if (vendor.lastInactivityEmailAt && Date.now() - vendor.lastInactivityEmailAt.getTime() < INACTIVITY_REMINDER_DAYS * DAY_MS) {
      continue;
    }
    const daysInactive = daysSince(lastAccessAt(vendor));
    await sendVendorInactivityReminderEmail(vendor, daysInactive);
    await prisma.vendor.update({ where: { id: vendor.id }, data: { lastInactivityEmailAt: new Date() } });
    sent++;
  }
  return sent;
}

// --- 3.2: suspensión automática a los 90 días -------------------------------
async function suspendInactiveVendors() {
  const ninetyDaysAgo = new Date(Date.now() - SUSPENSION_DAYS * DAY_MS);

  const candidates = await prisma.vendor.findMany({
    where: {
      status: "ACTIVE",
      isBlocked: false,
      deletedAt: null,
      OR: [{ user: { lastLoginAt: { lte: ninetyDaysAgo } } }, { user: { lastLoginAt: null }, createdAt: { lte: ninetyDaysAgo } }],
    },
    include: { user: true },
  });

  const reason = `${SUSPENSION_DAYS} días sin acceder al panel de vendedor`;
  let suspended = 0;
  for (const vendor of candidates) {
    await prisma.$transaction([
      prisma.vendor.update({
        where: { id: vendor.id },
        data: { status: "SUSPENDED", suspendedAt: new Date(), suspensionReason: reason },
      }),
      prisma.vendorStatusLog.create({
        data: { vendorId: vendor.id, fromStatus: "ACTIVE", toStatus: "SUSPENDED", reason, byAdminId: null },
      }),
    ]);
    await notifyVendorSuspended(vendor, reason);
    suspended++;
  }
  return suspended;
}

// --- 3.3: re-enganche de clientes con 1 sola compra -------------------------
// Regla confirmada con el usuario: cliente con EXACTAMENTE 1 pedido no
// cancelado en la tienda, con 30+ días de antigüedad (nunca volvió a
// comprar ahí desde entonces), y la tienda publicó una oferta ACTIVE nueva
// desde esa compra. Acotado a `Offer` (no StoreOffer) — ver nota en
// schema.prisma sobre por qué. Recorre solo ofertas creadas en las últimas
// 24h (el job corre a diario, no reprocesa el historial entero cada vez).
async function sendWinbackEmails() {
  const oneDayAgo = new Date(Date.now() - WINBACK_OFFER_LOOKBACK_HOURS * 60 * 60 * 1000);
  const thirtyDaysAgo = new Date(Date.now() - WINBACK_MIN_ORDER_AGE_DAYS * DAY_MS);

  const recentOffers = await prisma.offer.findMany({
    where: { status: "ACTIVE", vendorId: { not: null }, createdAt: { gte: oneDayAgo } },
  });

  let sent = 0;
  for (const offer of recentOffers) {
    const vendor = await prisma.vendor.findUnique({ where: { id: offer.vendorId } });
    if (!vendor || vendor.status !== "ACTIVE" || vendor.isBlocked || vendor.deletedAt) continue;

    // Un solo pedido no cancelado por cliente en esta tienda — _count===1
    // ya garantiza que _max.createdAt es la fecha de ESE único pedido.
    const perCustomer = await prisma.order.groupBy({
      by: ["customerId"],
      where: { vendorId: offer.vendorId, customerId: { not: null }, status: { not: "CANCELLED" } },
      _count: { id: true },
      _max: { createdAt: true },
    });

    for (const row of perCustomer) {
      if (row._count.id !== 1) continue;
      if (!row._max.createdAt || row._max.createdAt > thirtyDaysAgo) continue;

      const already = await prisma.winbackEmailLog.findUnique({
        where: { customerId_vendorId_offerId: { customerId: row.customerId, vendorId: offer.vendorId, offerId: offer.id } },
      });
      if (already) continue;

      const customer = await prisma.user.findUnique({ where: { id: row.customerId } });
      if (!customer || customer.isSuspended || customer.deletedAt) continue;

      await sendVendorWinbackEmail({ customer, vendor, offers: [offer] });
      await prisma.winbackEmailLog.create({ data: { customerId: row.customerId, vendorId: offer.vendorId, offerId: offer.id } });
      sent++;
    }
  }
  return sent;
}

// Exportado por separado (no solo el scheduler) para poder correrlo a mano
// en un smoke test sin esperar al horario del cron ni pelear con su timing.
export async function runVendorLifecycleJob() {
  const reminders = await sendInactivityReminders();
  const suspended = await suspendInactiveVendors();
  const winbacks = await sendWinbackEmails();
  console.log(`[vendorLifecycleJob] recordatorios=${reminders} suspendidas=${suspended} winback=${winbacks}`);
  return { reminders, suspended, winbacks };
}

// Una vez al día, 8:00am hora Cuba — arrancado desde server.js.
export function startVendorLifecycleJob() {
  cron.schedule(
    "0 8 * * *",
    () => {
      runVendorLifecycleJob().catch((err) => console.error("[vendorLifecycleJob] error:", err));
    },
    { timezone: "America/Havana" }
  );
}
