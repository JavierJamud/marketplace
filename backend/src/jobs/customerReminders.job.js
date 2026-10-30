import { currencyLabel } from "../lib/catalog.js";
import { isStoreOwnerPerson } from "../lib/accountRealm.js";
import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { sendCartReminderEmail, sendStoreReminderEmail } from "../lib/email.js";
import { unsubscribeUrl, canSendMarketingEmail as canEmail, markMarketingEmailSent as markEmailed } from "../lib/marketingEmail.js";
import { activeProgramFor, pointsWorth } from "../services/loyalty.service.js";
import { filterVisibleStoreOffers, publicStoreOfferWhere } from "../lib/storeOfferVisibility.js";

// Recordatorios automáticos a clientes con cuenta, dos veces al día en horario de Cuba (10:00 y 17:00):
//  1. Carrito sin terminar: el carrito guardado lleva entre 1 y 7 días sin cambios y no hubo pedido a esa tienda desde entonces.
//     Uno por contenido del carrito (si lo cambia, vuelve a valer).
//  2. "Volviste a mirar esta tienda": la última visita fue hace 3 a 14 días, no compró después y la tienda tiene algo para él
//     (puntos que ya puede usar o una oferta activa). Como mucho uno cada 14 días por tienda.
// Para no saturar: nunca más de un correo de estos por persona cada 3 días, sea de la tienda que sea, y solo a quien no los
// apagó (User.marketingEmails). Cada correo sale a nombre de la tienda.
const DAY = 24 * 60 * 60 * 1000;
const NUDGE_EVERY = 14 * DAY;
const BATCH = 200;

const eligibleUser = { role: "CUSTOMER", marketingEmails: true, isSuspended: false, deletedAt: null };

async function pointsInfo(vendor, userId) {
  const program = await activeProgramFor(vendor);
  if (!program) return null;
  const account = await prisma.loyaltyAccount.findUnique({ where: { vendorId_userId: { vendorId: vendor.id, userId } }, select: { balance: true } });
  if (!account?.balance) return null;
  return {
    balance: account.balance,
    value: pointsWorth(program, account.balance),
    currency: vendor.currency ?? "CUP",
    usable: account.balance >= program.minRedeemPoints,
  };
}

// Mismas reglas que la tienda pública (lib/storeOfferVisibility.js): un correo no anuncia una oferta que la tienda ya no
// puede mostrar por su plan, ni una que el admin suspendió. La más reciente siempre entra en el tope si el plan permite alguna.
async function activeOffer(vendorId, now) {
  const [found, vendor] = await Promise.all([
    prisma.storeOffer.findFirst({
      where: { vendorId, ...publicStoreOfferWhere(now) },
      include: { discountCode: { select: { code: true, type: true, value: true, currency: true } } },
      orderBy: { createdAt: "desc" },
    }),
    prisma.vendor.findUnique({ where: { id: vendorId }, select: { planType: true, verificationStatus: true } }),
  ]);
  const [offer] = await filterVisibleStoreOffers(vendor, found ? [found] : []);
  if (!offer) return null;
  const dc = offer.discountCode;
  return {
    title: offer.title,
    code: dc.code,
    discountLabel: dc.type === "PERCENTAGE" ? `${Number(dc.value)} % de descuento` : `${Number(dc.value).toLocaleString("es-CU")} ${currencyLabel(dc.currency)} de descuento`,
    expiresAt: offer.isLimitedTime ? offer.expiresAt : null,
  };
}

const vendorUsable = (v) => v && v.status === "ACTIVE" && !v.isBlocked && !v.deletedAt;
const VENDOR_FIELDS = { id: true, companyName: true, slug: true, logoUrl: true, color: true, currency: true, planType: true, status: true, isBlocked: true, deletedAt: true, userId: true };

async function sendCartReminders(now) {
  const carts = await prisma.cartSnapshot.findMany({
    where: { updatedAt: { lte: new Date(now - DAY), gte: new Date(now - 7 * DAY) }, user: eligibleUser },
    include: { user: { select: { id: true, email: true, fullName: true, lastMarketingEmailAt: true } } },
    take: BATCH,
  });
  let sent = 0;
  for (const cart of carts) {
    if (cart.remindedAt && cart.remindedAt >= cart.updatedAt) continue;
    const items = Array.isArray(cart.items) ? cart.items.filter((i) => i?.name && Number(i.quantity) > 0) : [];
    const vendorId = cart.vendorMeta?.id;
    if (!items.length || typeof vendorId !== "string" || !canEmail(cart.user, now)) continue;
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: VENDOR_FIELDS });
    // Ni al dueño de la tienda con su cuenta de cliente (cuentas separadas: mismo correo o teléfono, lib/accountRealm.js).
    if (!vendorUsable(vendor) || (await isStoreOwnerPerson(cart.userId, vendor.userId))) continue;
    const ordered = await prisma.order.findFirst({ where: { customerId: cart.userId, vendorId, createdAt: { gte: cart.updatedAt } }, select: { id: true } });
    if (ordered) continue;

    const result = await sendCartReminderEmail({
      customer: cart.user,
      vendor,
      items,
      points: await pointsInfo(vendor, cart.userId),
      unsubscribeUrl: unsubscribeUrl(cart.userId),
    });
    const at = new Date();
    // remindedAt va aunque el envío falle: si no, cada pasada lo volvería a intentar con el mismo carrito.
    await prisma.cartSnapshot.update({ where: { id: cart.id }, data: { remindedAt: at, updatedAt: cart.updatedAt } });
    if (result.ok) {
      await markEmailed(cart.userId, at);
      cart.user.lastMarketingEmailAt = at;
      sent++;
    }
  }
  return sent;
}

async function sendStoreReminders(now) {
  const visits = await prisma.storeVisit.findMany({
    where: {
      lastAt: { lte: new Date(now - 3 * DAY), gte: new Date(now - 14 * DAY) },
      OR: [{ lastNudgeAt: null }, { lastNudgeAt: { lte: new Date(now - NUDGE_EVERY) } }],
      user: eligibleUser,
    },
    include: { user: { select: { id: true, email: true, fullName: true, lastMarketingEmailAt: true } }, vendor: { select: VENDOR_FIELDS } },
    orderBy: { lastAt: "desc" },
    take: BATCH,
  });
  const emailedNow = new Set();
  let sent = 0;
  for (const visit of visits) {
    if (emailedNow.has(visit.userId) || !canEmail(visit.user, now) || !vendorUsable(visit.vendor)) continue;
    if (await isStoreOwnerPerson(visit.userId, visit.vendor.userId)) continue;
    const ordered = await prisma.order.findFirst({ where: { customerId: visit.userId, vendorId: visit.vendorId, createdAt: { gte: visit.lastAt } }, select: { id: true } });
    if (ordered) continue;
    const [points, offer] = await Promise.all([pointsInfo(visit.vendor, visit.userId), activeOffer(visit.vendorId, new Date(now))]);
    if (!points?.usable && !offer) continue;

    const result = await sendStoreReminderEmail({
      customer: visit.user,
      vendor: visit.vendor,
      points: points?.usable ? points : null,
      offer,
      unsubscribeUrl: unsubscribeUrl(visit.userId),
    });
    const at = new Date();
    await prisma.storeVisit.update({ where: { userId_vendorId: { userId: visit.userId, vendorId: visit.vendorId } }, data: { lastNudgeAt: at } });
    if (result.ok) {
      await markEmailed(visit.userId, at);
      emailedNow.add(visit.userId);
      sent++;
    }
  }
  return sent;
}

export async function runCustomerRemindersJob() {
  const settings = await prisma.siteSettings.findFirst({ select: { customerRemindersEnabled: true } });
  if (settings && settings.customerRemindersEnabled === false) return { carts: 0, stores: 0, skipped: true };
  const now = Date.now();
  const carts = await sendCartReminders(now);
  const stores = await sendStoreReminders(now);
  console.log(`[customerRemindersJob] carritos=${carts} tiendas=${stores}`);
  return { carts, stores };
}

export function startCustomerRemindersJob() {
  cron.schedule(
    "0 10,17 * * *",
    () => {
      runCustomerRemindersJob().catch((err) => console.error("[customerRemindersJob]", err));
    },
    { timezone: "America/Havana" }
  );
}
