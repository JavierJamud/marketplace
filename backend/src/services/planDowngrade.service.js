import { prisma } from "../lib/prisma.js";
import { transitionVendorVerification } from "./vendorVerification.service.js";
import { recalcVendorProductQuota } from "../lib/planConfig.js";
import { cancelStripeSubscription, setCardSubscriptionCancelAtPeriodEnd } from "../lib/stripe.js";
import { adminNoticeToVendor } from "../lib/notify.js";

// Pasar una tienda al plan Regular por decisión del admin, de dos formas:
//  - Ahora: pierde Premium en el momento. Se cancela la suscripción con tarjeta (si tiene) para que no se le cobre más y se
//    borra la prueba gratis en curso.
//  - Al terminar lo que ya tiene: conserva Premium hasta el final de la prueba gratis o del periodo pagado y no se renueva.
//    Ese día la tarea diaria (trialExpiry.job.js) o el aviso de Stripe aplican el cambio con applyPlanDowngrade.
// En los dos casos conserva la insignia de verificada si ya la tenía: el cambio es de plan, no un castigo (para eso está
// "Quitar Premium" / revokeBusinessPlan, que suspende).

const fmt = (d) => new Date(d).toLocaleDateString("es-CU", { day: "numeric", month: "long", year: "numeric" });

// Hasta cuándo tiene Premium hoy: el final de la prueba gratis o el del periodo pagado.
export function currentPeriodEnd(vendor) {
  const end = vendor.trialEndsAt ?? vendor.nextPaymentDueDate ?? null;
  return end && new Date(end).getTime() > Date.now() ? new Date(end) : null;
}

export async function applyPlanDowngrade(vendorId, { actorId = null, source, reason }) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) return null;
  if (vendor.stripeSubscriptionId) await cancelStripeSubscription(vendor.stripeSubscriptionId).catch(() => {});
  const extraData = {
    planType: "REGULAR",
    trialEndsAt: null,
    nextPaymentDueDate: null,
    stripeSubscriptionId: null,
    cancelAtPeriodEnd: false,
    planDowngradeAt: null,
    planDowngradeReason: null,
  };
  const finalReason = reason || vendor.planDowngradeReason || "El equipo pasó la tienda al plan Regular.";
  let updated;
  if (vendor.verificationStatus === "VERIFIED") {
    updated = await transitionVendorVerification(vendorId, "VERIFIED", { actorId, source, reason: `Pasa al plan Regular: ${finalReason}`, extraData });
  } else {
    updated = await prisma.vendor.update({ where: { id: vendorId }, data: extraData });
  }
  await recalcVendorProductQuota(vendorId);
  await adminNoticeToVendor(vendorId, "Tu tienda pasó al plan Regular", `Desde hoy tu tienda usa el plan Regular. Motivo: ${finalReason}. Puedes volver a Premium cuando quieras desde Suscripción.`).catch(() => {});
  return updated;
}

export async function scheduleOrCancelDowngrade(vendor, { when, reason }) {
  if (when === "cancel") {
    if (!vendor.planDowngradeAt) return vendor;
    if (vendor.stripeSubscriptionId) await setCardSubscriptionCancelAtPeriodEnd(vendor.stripeSubscriptionId, false).catch(() => {});
    const updated = await prisma.vendor.update({ where: { id: vendor.id }, data: { planDowngradeAt: null, planDowngradeReason: null, cancelAtPeriodEnd: false } });
    await adminNoticeToVendor(vendor.id, "Tu plan Premium sigue", "El equipo anuló el cambio programado al plan Regular: tu plan sigue igual.").catch(() => {});
    return updated;
  }
  const end = currentPeriodEnd(vendor);
  if (!end) return null;
  // Con tarjeta: Stripe no vuelve a cobrar y termina la suscripción en esa fecha (su aviso aplica el cambio).
  if (vendor.stripeSubscriptionId) await setCardSubscriptionCancelAtPeriodEnd(vendor.stripeSubscriptionId, true).catch(() => {});
  const updated = await prisma.vendor.update({ where: { id: vendor.id }, data: { planDowngradeAt: end, planDowngradeReason: reason, cancelAtPeriodEnd: true } });
  await adminNoticeToVendor(
    vendor.id,
    "Tu tienda pasará al plan Regular",
    `El equipo programó el cambio de tu tienda al plan Regular para el ${fmt(end)}. Hasta ese día sigues con todas las funciones Premium y no se te cobra la renovación. Motivo: ${reason}.`
  ).catch(() => {});
  return updated;
}

// Tarea diaria: aplica los cambios programados cuya fecha ya llegó.
export async function applyScheduledDowngrades() {
  const due = await prisma.vendor.findMany({ where: { planDowngradeAt: { lte: new Date() }, deletedAt: null }, select: { id: true } });
  for (const v of due) await applyPlanDowngrade(v.id, { source: "CRON_EXPIRATION" });
  return due.length;
}
