import { prisma } from "../lib/prisma.js";
import { transitionVendorVerification } from "./vendorVerification.service.js";
import { recalcVendorProductQuota, getDefaultPlanKey, getPlanConfig, planDisplayName, recordPlanChange } from "../lib/planConfig.js";
import { recalcVendorStoreOffers } from "../lib/storeOfferVisibility.js";
import { cancelStripeSubscription, setCardSubscriptionCancelAtPeriodEnd } from "../lib/stripe.js";
import { adminNoticeToVendor } from "../lib/notify.js";
import { liftBillingSuspension } from "./planBilling.service.js";

// Pasar una tienda al plan por defecto (isDefault, hoy el Básico) por decisión del admin, de dos formas:
//  - Ahora: pierde su plan de pago en el momento. Se cancela la suscripción con tarjeta (si tiene) para que no se le cobre
//    más y se borra la prueba gratis en curso.
//  - Al terminar lo que ya tiene: conserva su plan hasta el final de la prueba gratis o del periodo pagado y no se renueva.
//    Ese día la tarea diaria (trialExpiry.job.js) o el aviso de Stripe aplican el cambio con applyPlanDowngrade.
// En los dos casos pierde la insignia (pedido explícito: el plan por defecto no la lleva) y queda en PLAN_ENDED, con sus
// documentos aprobados para volver a un plan de pago pagando. No es un castigo: para eso está "Quitar Premium" /
// revokeBusinessPlan, que suspende.
// Los nombres de los planes en los avisos salen de la base (displayName): antes decían "Premium" y "Regular" fijos, y una
// tienda de Estándar leía que perdía Premium.

const fmt = (d) => new Date(d).toLocaleDateString("es-CU", { day: "numeric", month: "long", year: "numeric" });

// Hasta cuándo tiene su plan de pago hoy: el final de la prueba gratis o el del periodo pagado.
export function currentPeriodEnd(vendor) {
  const end = vendor.trialEndsAt ?? vendor.nextPaymentDueDate ?? null;
  return end && new Date(end).getTime() > Date.now() ? new Date(end) : null;
}

// Cómo vuelve una tienda a un plan que dejó, para el aviso de la baja. Con insignia (y de pago) lo paga desde Suscripción.
// Sin insignia, gratis o "por WhatsApp", la tienda no puede pasarse sola (renewalPlanFor responde "Solo puedes renovar
// mientras tu tienda está verificada"), y como no está verificada tampoco tiene Mensajes (el chat con el equipo exige la
// insignia): se le da el WhatsApp de soporte o la página de contacto. Un plan archivado ya no se ofrece: no se menciona.
async function backToPlanText(config) {
  if (!config || config.archivedAt) return "";
  const name = config.displayName;
  if (config.grantsBadge && !config.isFree && !config.contactOnly) return ` Puedes volver al plan ${name} cuando quieras desde Suscripción.`;
  const s = await prisma.siteSettings.findFirst({ select: { supportWhatsapp: true } }).catch(() => null);
  const where = s?.supportWhatsapp ? `por WhatsApp al ${s.supportWhatsapp}` : "desde la página de contacto";
  return ` Para volver al plan ${name}, escríbenos ${where}.`;
}

// `planChangeReason`: el motivo que queda en VendorPlanChange (estadísticas de bajas). Por defecto "admin_change"; la tarea
// diaria pasa "downgrade_cancelled" cuando aplica una cancelación que pidió la propia tienda.
// La baja también saca a la tienda del cobro de planes sin insignia (billingNoticeStage/Due a null) y levanta la suspensión
// por falta de pago: antes quedaba la etapa puesta con la fecha en null, y si el plan por defecto se cobra, planBilling no la
// volvía a tomar nunca (el paso 2 exige etapa null y el paso 3 exige fecha) y seguía SUSPENDED para siempre. Así el plan por
// defecto de pago arranca su ciclo en la siguiente pasada.
// `keepBillingCycle`: solo para archivePlan (adminPlans.controller.js), que deja a la tienda dentro del ciclo de cobro con su
// tiempo ya pagado (keepPaidTimeWhere) y le devuelve la fecha después de la baja; ahí no se toca ni la etapa ni la suspensión.
export async function applyPlanDowngrade(vendorId, { actorId = null, source, reason, planChangeReason = "admin_change", keepBillingCycle = false }) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return null;
  if (vendor.stripeSubscriptionId) await cancelStripeSubscription(vendor.stripeSubscriptionId).catch(() => {});
  const extraData = {
    trialEndsAt: null,
    nextPaymentDueDate: null,
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
    planDowngradeAt: null,
    planDowngradeReason: null,
    ...(keepBillingCycle ? {} : { billingNoticeStage: null, billingNoticeDue: null }),
  };
  const defaultKey = await getDefaultPlanKey();
  const [defaultName, fromConfig] = await Promise.all([planDisplayName(defaultKey), getPlanConfig(vendor.planType)]);
  const finalReason = reason || vendor.planDowngradeReason || `El equipo pasó la tienda al plan ${defaultName}.`;
  let updated;
  if (vendor.verificationStatus === "VERIFIED") {
    // transitionVendorVerification pone el plan por defecto al perder VERIFIED y anota el cambio en su transacción.
    updated = await transitionVendorVerification(vendorId, "PLAN_ENDED", { actorId, source, reason: `Pasa al plan ${defaultName}: ${finalReason}`, extraData, planChangeReason });
  } else {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.vendor.update({ where: { id: vendorId }, data: { ...extraData, planType: defaultKey } });
      await recordPlanChange(tx, { vendorId, fromPlan: vendor.planType, toPlan: defaultKey, reason: planChangeReason, actorId });
      return row;
    });
    await recalcVendorProductQuota(vendorId);
  }
  // En los dos caminos: apaga las ofertas de tienda que el plan por defecto ya no permite (antes seguían públicas y la
  // tienda las podía reactivar).
  await recalcVendorStoreOffers(vendorId);
  // Después del cambio de plan: si no, la pasada horaria de planBilling podría volver a suspenderla con el plan viejo.
  // Lo que devuelve la función lleva el estado nuevo: el admin ve la tienda activa sin recargar.
  if (!keepBillingCycle && vendor.billingSuspendedAt) {
    const lifted = await liftBillingSuspension(vendorId, `Pasó al plan ${defaultName}`).catch((err) => {
      console.error(`[planDowngrade] no se pudo levantar la suspensión por falta de pago de ${vendorId}:`, err?.message);
      return false;
    });
    if (lifted && updated) {
      const status = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { status: true, billingSuspendedAt: true, reactivatedAt: true, reactivationReason: true } });
      updated = { ...updated, ...status };
    }
  }
  const backTo = vendor.planType !== defaultKey ? await backToPlanText(fromConfig) : "";
  const noticeTitle = `Tu tienda pasó al plan ${defaultName}`;
  const noticeBody = `Desde hoy tu tienda usa el plan ${defaultName}. Motivo: ${finalReason.replace(/\.+$/, "")}.${backTo}`;
  // Una tarea automática (fin de lo pagado tras cancelar, cambio programado que llega a su fecha) no tiene un admin que marque
  // "Avisar a la tienda", y adminNoticeToVendor solo avisa si lo marcó: la tienda cambiaba de plan sin enterarse. En ese caso
  // el aviso va siempre a su campana (el gancho de VendorNotification manda el push).
  if (source === "CRON_EXPIRATION") {
    await prisma.vendorNotification.create({ data: { vendorId, type: "ADMIN_NOTICE", title: noticeTitle, body: noticeBody.slice(0, 500) } }).catch(() => {});
  } else {
    await adminNoticeToVendor(vendorId, noticeTitle, noticeBody).catch(() => {});
  }
  return updated;
}

export async function scheduleOrCancelDowngrade(vendor, { when, reason }) {
  if (when === "cancel") {
    if (!vendor.planDowngradeAt) return vendor;
    if (vendor.stripeSubscriptionId) await setCardSubscriptionCancelAtPeriodEnd(vendor.stripeSubscriptionId, false).catch(() => {});
    const updated = await prisma.vendor.update({ where: { id: vendor.id }, data: { planDowngradeAt: null, planDowngradeReason: null, cancelAtPeriodEnd: false } });
    const [ownName, defaultName] = await Promise.all([planDisplayName(vendor.planType), planDisplayName(await getDefaultPlanKey())]);
    await adminNoticeToVendor(vendor.id, `Tu plan ${ownName} sigue`, `El equipo anuló el cambio programado al plan ${defaultName}: tu plan sigue igual.`).catch(() => {});
    return updated;
  }
  const end = currentPeriodEnd(vendor);
  if (!end) return null;
  const [ownName, defaultName] = await Promise.all([planDisplayName(vendor.planType), planDisplayName(await getDefaultPlanKey())]);
  // Con tarjeta: Stripe no vuelve a cobrar y termina la suscripción en esa fecha (su aviso aplica el cambio).
  if (vendor.stripeSubscriptionId) await setCardSubscriptionCancelAtPeriodEnd(vendor.stripeSubscriptionId, true).catch(() => {});
  const updated = await prisma.vendor.update({ where: { id: vendor.id }, data: { planDowngradeAt: end, planDowngradeReason: reason, cancelAtPeriodEnd: true } });
  await adminNoticeToVendor(
    vendor.id,
    `Tu tienda pasará al plan ${defaultName}`,
    `El equipo programó el cambio de tu tienda al plan ${defaultName} para el ${fmt(end)}. Hasta ese día sigues con todas las funciones del plan ${ownName} y no se te cobra la renovación. Motivo: ${String(reason).replace(/\.+$/, "")}.`
  ).catch(() => {});
  return updated;
}

// Tarea diaria: aplica los cambios programados cuya fecha ya llegó.
export async function applyScheduledDowngrades() {
  const due = await prisma.vendor.findMany({ where: { planDowngradeAt: { lte: new Date() }, deletedAt: null }, select: { id: true } });
  for (const v of due) await applyPlanDowngrade(v.id, { source: "CRON_EXPIRATION" });
  return due.length;
}
