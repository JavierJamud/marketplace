import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getAllPlanConfigs, getDefaultPlanKey } from "../lib/planConfig.js";
import { notifyVendor, PLAN_BILLING_REF } from "../lib/notify.js";
import { requestContext } from "../lib/requestContext.js";
import { sendPlanBillingEmail } from "../lib/email.js";
import { applyPlanDowngrade } from "./planDowngrade.service.js";

// Cobro de los planes de pago que no dan la insignia (hoy, el Básico cuando el admin deja de darlo gratis). Estos planes
// no pasan por la verificación: la tienda paga desde Suscripción (renovación, ver renewalPlanFor) y su fecha de cobro es
// mensual, contada desde el día en que se registró.
//
// Ciclo, pedido explícito del dueño:
//  - Al dejar de ser gratis, cada tienda del plan recibe el aviso con su fecha de cobro.
//  - Avisos: 7 días antes, el día del cobro y 3 días después.
//  - Desde el día del cobro sin pagar, la tienda sigue visible pero no recibe pedidos nuevos (assertVendorAcceptsOrders).
//  - Pasados SiteSettings.unpaidSuspendDays sin pagar, la tienda se suspende: nadie la ve y su enlace queda cerrado, pero
//    el dueño entra a su panel con su cuenta y puede pagar. Al pagar (o si el admin la reactiva) vuelve sola.
//
// Vendor.billingNoticeStage dice qué aviso ya salió y billingNoticeDue para qué fecha de cobro; null = la tienda todavía
// no entró al cobro (así una fecha vieja de otro plan nunca la deja "atrasada" por error).

const DAY_MS = 24 * 60 * 60 * 1000;
const REMIND_BEFORE_DAYS = 7;
const REMIND_AFTER_DAYS = 3;
const STAGE_RANK = { start: 0, before: 1, due: 2, after: 3, suspended: 4 };

// Planes que se cobran sin verificación: ni gratis, ni "por WhatsApp", ni con insignia.
export async function billedPlanConfigs() {
  return (await getAllPlanConfigs()).filter((c) => !c.isFree && !c.contactOnly && !c.grantsBadge);
}

// Próxima fecha de cobro mensual contada desde el día de registro. Un registro del 31 cobra el último día de los meses
// más cortos.
export function nextBillingDate(createdAt, from = new Date()) {
  const anchor = new Date(createdAt);
  const day = anchor.getDate();
  const at = (y, m) => {
    const last = new Date(y, m + 1, 0).getDate();
    return new Date(y, m, Math.min(day, last), anchor.getHours(), anchor.getMinutes(), 0, 0);
  };
  let candidate = at(from.getFullYear(), from.getMonth());
  if (candidate <= from) candidate = at(from.getFullYear(), from.getMonth() + 1);
  return candidate;
}

async function unpaidSuspendDays() {
  const s = await prisma.siteSettings.findFirst({ select: { unpaidSuspendDays: true } });
  return s?.unpaidSuspendDays ?? 30;
}

const fmtDate = (d) => new Date(d).toLocaleDateString("es-CU", { day: "numeric", month: "long", year: "numeric" });
const fmtMoney = (config) => `${Number(config.priceCup).toLocaleString("es-CU")} CUP o ${config.priceUsd} USD`;

// ¿La tienda está en un plan que se cobra sin verificación, ya entró al cobro y pasó su fecha sin pagar?
export async function isBillingOverdue(vendor) {
  if (!vendor?.billingNoticeStage || !vendor.nextPaymentDueDate) return false;
  if (new Date(vendor.nextPaymentDueDate) > new Date()) return false;
  return (await billedPlanConfigs()).some((c) => c.planType === vendor.planType);
}

// Pedidos nuevos (web, API de socios, mesas): una tienda con el cobro atrasado sigue visible pero no los recibe.
export async function assertVendorAcceptsOrders(vendor) {
  if (await isBillingOverdue(vendor)) {
    throw new AppError("Esta tienda no está recibiendo pedidos en este momento. Prueba más tarde o escríbele directamente.", 409, { code: "VENDOR_BILLING_OVERDUE" });
  }
}

async function notice(vendor, config, stage) {
  const due = vendor.nextPaymentDueDate;
  const price = fmtMoney(config);
  const plan = config.displayName;
  const texts = {
    start: [`El plan ${plan} ahora es de pago`, `El plan ${plan} pasa a costar ${price} al mes. Tu fecha de cobro es el ${fmtDate(due)}: paga antes desde Suscripción para seguir recibiendo pedidos.`],
    before: [`Tu plan ${plan} se cobra en ${REMIND_BEFORE_DAYS} días`, `El ${fmtDate(due)} vence el pago de tu plan ${plan} (${price} al mes). Paga desde Suscripción para no dejar de recibir pedidos.`],
    due: [`Hoy vence el pago de tu plan ${plan}`, `Desde hoy y hasta que pagues, tu tienda sigue visible pero no recibe pedidos nuevos. Paga desde Suscripción y vuelve a recibirlos al instante.`],
    after: [`Tu tienda no está recibiendo pedidos`, `El pago de tu plan ${plan} venció el ${fmtDate(due)}. Tu tienda sigue visible pero sin pedidos nuevos. Si no pagas, se suspende y deja de verse.`],
    suspended: [`Tu tienda fue suspendida por falta de pago`, `Pasó el plazo sin pagar el plan ${plan}: tu tienda ya no se ve y su enlace está cerrado para los clientes. Entra a tu panel y paga desde Suscripción para reactivarla al momento.`],
  };
  const [title, body] = texts[stage];
  // refCode PLAN_BILLING: el gancho de VendorNotification y la campana llevan este aviso a Suscripción, donde se paga (un
  // ADMIN_NOTICE sin él lleva al inicio del panel).
  await prisma.vendorNotification.create({ data: { vendorId: vendor.id, type: "ADMIN_NOTICE", refCode: PLAN_BILLING_REF, title, body } }).catch(() => {});
  // El gancho de VendorNotification (installNotifyHooks, lib/notify.js) ya manda el push de la campana: mandarlo también
  // aquí llegaba dos veces. Solo falta cuando la acción del admin que arrancó el cobro dijo "no avisar a la tienda"
  // (X-Notify-Vendor), y este aviso de cobro es obligatorio: entonces se manda aquí.
  if (requestContext()?.notifyVendor === false) {
    void notifyVendor(vendor.id, { category: "account", title, body, url: "/vendedor/verificacion", tag: `plan-billing-${vendor.id}` }).catch(() => {});
  }
  if (vendor.user?.email) await sendPlanBillingEmail(vendor, { title, message: body, stage }).catch(() => {});
}

// Suspender por falta de pago: la tienda deja de verse (status SUSPENDED, igual que cualquier suspensión), pero
// billingSuspendedAt le deja al dueño entrar a su panel para pagar (requireVendorAccess).
async function suspendForBilling(vendor, config) {
  const reason = `Falta de pago del plan ${config.displayName}`;
  const now = new Date();
  await prisma.$transaction([
    prisma.vendor.update({ where: { id: vendor.id }, data: { status: "SUSPENDED", suspendedAt: now, suspensionReason: reason, billingSuspendedAt: now } }),
    prisma.vendorStatusLog.create({ data: { vendorId: vendor.id, fromStatus: vendor.status, toStatus: "SUSPENDED", reason, byAdminId: null } }),
  ]);
}

// Vuelve a la normalidad una tienda suspendida por falta de pago (pagó, el plan volvió a ser gratis o cambió de plan).
export async function liftBillingSuspension(vendorId, reason) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, status: true, billingSuspendedAt: true } });
  if (!vendor?.billingSuspendedAt) return false;
  const now = new Date();
  await prisma.$transaction([
    prisma.vendor.update({ where: { id: vendorId }, data: { status: "ACTIVE", billingSuspendedAt: null, reactivatedAt: now, reactivationReason: reason } }),
    prisma.vendorStatusLog.create({ data: { vendorId, fromStatus: vendor.status, toStatus: "ACTIVE", reason, byAdminId: null } }),
  ]);
  return true;
}

// Datos extra al reactivar a mano (admin): si la suspensión era por falta de pago y el cobro sigue atrasado, se le da una
// semana para pagar antes de volver a quedar sin pedidos, con sus avisos de nuevo.
export function adminReactivationBillingData(vendor) {
  if (!vendor.billingSuspendedAt) return {};
  const overdue = vendor.nextPaymentDueDate && new Date(vendor.nextPaymentDueDate) <= new Date();
  return {
    billingSuspendedAt: null,
    ...(overdue ? { nextPaymentDueDate: new Date(Date.now() + REMIND_BEFORE_DAYS * DAY_MS), billingNoticeStage: "start", billingNoticeDue: null } : {}),
  };
}

// Primer aviso a las tiendas de un plan que acaba de dejar de ser gratis (lo llama updatePlanConfig).
export async function startBillingForFreePlan(planType) {
  return runPlanBilling({ onlyPlanType: planType });
}

// Una pasada completa (la corre el job cada hora): mete en el cobro a las tiendas nuevas del plan, manda el aviso que toca
// a cada una, suspende las que pasaron el plazo, y saca del cobro a las que ya no están en un plan cobrado.
export async function runPlanBilling({ onlyPlanType } = {}) {
  const billed = await billedPlanConfigs();
  const configBy = new Map(billed.map((c) => [c.planType, c]));
  const billedTypes = billed.map((c) => c.planType).filter((t) => !onlyPlanType || t === onlyPlanType);
  const stats = { started: 0, notices: 0, suspended: 0, lifted: 0, cleared: 0, downgraded: 0 };

  // 1. Fuera del cobro: tiendas que cambiaron de plan o cuyo plan volvió a ser gratis.
  if (!onlyPlanType) {
    const leaving = await prisma.vendor.findMany({ where: { billingNoticeStage: { not: null }, planType: { notIn: billed.map((c) => c.planType) } }, select: { id: true, billingSuspendedAt: true } });
    for (const v of leaving) {
      if (v.billingSuspendedAt && (await liftBillingSuspension(v.id, "Ya no tiene un cobro pendiente del plan"))) stats.lifted++;
      await prisma.vendor.update({ where: { id: v.id }, data: { billingNoticeStage: null, billingNoticeDue: null } });
      stats.cleared++;
    }
  }
  if (!billedTypes.length) return stats;

  // 2. Entran al cobro: fecha mensual desde el día de registro y primer aviso.
  const fresh = await prisma.vendor.findMany({ where: { deletedAt: null, isBlocked: false, planType: { in: billedTypes }, billingNoticeStage: null }, include: { user: { select: { email: true } } } });
  for (const v of fresh) {
    const due = nextBillingDate(v.createdAt);
    const updated = await prisma.vendor.update({ where: { id: v.id }, data: { nextPaymentDueDate: due, billingNoticeStage: "start", billingNoticeDue: due } });
    await notice({ ...updated, user: v.user }, configBy.get(v.planType), "start");
    stats.started++;
  }

  // 3. Avisos y suspensión según la fecha de cobro.
  const graceDays = await unpaidSuspendDays();
  const defaultKey = await getDefaultPlanKey();
  const now = Date.now();
  const active = await prisma.vendor.findMany({ where: { deletedAt: null, planType: { in: billedTypes }, billingNoticeStage: { not: null }, nextPaymentDueDate: { not: null } }, include: { user: { select: { email: true } } } });
  for (const v of active) {
    const config = configBy.get(v.planType);
    const due = new Date(v.nextPaymentDueDate).getTime();
    // Canceló su plan (cancelAtPeriodEnd): no se le pide pagar algo que decidió dejar. Al llegar la fecha baja al plan por
    // defecto aquí mismo, igual que processDeferredCancellationsWithoutBadge (verificationPayment.job.js). Ese job corre una
    // vez al día y este cada hora: sin esto, en la ventana entre los dos recibía el aviso "Hoy vence el pago" y su tienda
    // dejaba de recibir pedidos (isBillingOverdue). Con tarjeta la baja la hace el webhook de Stripe al final del periodo, y
    // durante una prueba en curso, trialExpiry.job.js.
    // El plan por defecto queda fuera (igual que en processDeferredCancellationsWithoutBadge): bajarlo es dejarlo en el mismo
    // plan sin fecha de cobro, y la tienda lo usaba gratis para siempre. cancelMySubscription ya no deja cancelarlo; esto
    // cubre una marca vieja: esa tienda sigue el cobro normal.
    if (v.cancelAtPeriodEnd && v.planType !== defaultKey) {
      const inTrial = v.trialEndsAt && new Date(v.trialEndsAt).getTime() > now;
      if (due <= now && !v.stripeSubscriptionId && !v.planDowngradeAt && !inTrial) {
        await applyPlanDowngrade(v.id, {
          source: "CRON_EXPIRATION",
          reason: "Cancelaste tu plan y llegó el final de lo que pagaste.",
          planChangeReason: "downgrade_cancelled",
        });
        stats.downgraded++;
      }
      continue;
    }
    // Pagó (la fecha de cobro avanzó): si estaba suspendida por falta de pago, vuelve.
    if (due > now && v.billingSuspendedAt && (await liftBillingSuspension(v.id, "Pagó su plan"))) stats.lifted++;
    const sameCycle = v.billingNoticeDue && new Date(v.billingNoticeDue).getTime() === due;
    const sent = sameCycle ? STAGE_RANK[v.billingNoticeStage] ?? 0 : 0;
    let stage = null;
    if (now >= due + graceDays * DAY_MS && !v.isBlocked) stage = "suspended";
    else if (now >= due + REMIND_AFTER_DAYS * DAY_MS) stage = "after";
    else if (now >= due) stage = "due";
    else if (now >= due - REMIND_BEFORE_DAYS * DAY_MS) stage = "before";
    if (!stage || STAGE_RANK[stage] <= sent) {
      if (!sameCycle) await prisma.vendor.update({ where: { id: v.id }, data: { billingNoticeStage: "start", billingNoticeDue: v.nextPaymentDueDate } });
      continue;
    }
    if (stage === "suspended" && v.status !== "SUSPENDED") {
      await suspendForBilling(v, config);
      stats.suspended++;
    }
    await prisma.vendor.update({ where: { id: v.id }, data: { billingNoticeStage: stage, billingNoticeDue: v.nextPaymentDueDate } });
    await notice(v, config, stage);
    stats.notices++;
  }
  return stats;
}
