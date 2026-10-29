import { Prisma } from "@prisma/client";
import { prisma } from "../lib/prisma.js";
import { getTrialChecklist } from "./trialEligibility.service.js";
import { logActivity } from "../lib/activityLog.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { planDisplayName } from "../lib/planConfig.js";

// Regla del dueño (2026-10-29): la insignia de verificada y las funciones de un plan con insignia exigen la verificación
// completa (los requisitos de "Requisitos para la verificación", trialEligibility.service.js). Aunque el administrador
// active el plan a mano, confirme un pago o registre uno, si a la tienda le falta algo:
//  - no se verifica: sigue en el plan gratis, sin insignia ni funciones del plan;
//  - la activación queda guardada en Vendor.pendingActivation y la tienda recibe un aviso con lo que le falta;
//  - en cuanto completa lo que falta, la activación se aplica sola (applyPendingActivationIfReady, llamada en los mismos
//    puntos que la prueba gratis: guardar perfil y logo, enviar documentos, publicar un producto).
// La duración de una activación a mano se cuenta desde que se aplica, no desde que el admin la pidió: la tienda no pierde
// días mientras completa su cuenta.

const DAY_MS = 24 * 60 * 60 * 1000;
const DATE_KEYS = ["nextPaymentDueDate", "trialEndsAt", "billingNoticeDue"];

export async function missingRequirements(vendorId) {
  return (await getTrialChecklist(vendorId)).filter((i) => !i.done);
}

function serializeExtra(extra) {
  const out = {};
  for (const [k, v] of Object.entries(extra ?? {})) out[k] = v instanceof Date ? v.toISOString() : v;
  return out;
}

function reviveExtra(extra) {
  const out = { ...(extra ?? {}) };
  for (const k of DATE_KEYS) if (typeof out[k] === "string") out[k] = new Date(out[k]);
  return out;
}

// Cuánto dura el plan cuando se aplique. Una activación a mano trae meses o "sin vencimiento" (planGrant); un pago
// confirmado trae su fecha de fin: se guarda como el tiempo que queda, para que los días pagados empiecen a contar cuando
// la tienda tenga el plan y no mientras completa su cuenta.
function durationOf(options) {
  if (options.planGrant) return options.planGrant;
  const due = options.extraData?.nextPaymentDueDate;
  if (due instanceof Date) return { remainingMs: Math.max(due.getTime() - Date.now(), DAY_MS) };
  if (due === null) return { noExpiry: true };
  return { months: 1 };
}

// Llamada desde transitionVendorVerification antes de verificar una tienda por acción del admin. Devuelve null si puede
// seguir (no es una verificación nueva del admin, o la tienda está completa). Si le falta algo, guarda la activación,
// avisa a la tienda y devuelve la lista de lo que falta.
export async function holdIfIncomplete(vendor, toStatus, options) {
  if (toStatus !== "VERIFIED" || options.source !== "ADMIN_ACTION" || options.skipRequirements) return null;
  // Renovar o extender una tienda que ya está verificada no es una verificación nueva.
  if (vendor.verificationStatus === "VERIFIED") return null;
  const missing = await missingRequirements(vendor.id);
  if (!missing.length) return null;

  // Lo demás que traía la activación (cancelar la tarjeta anterior, datos del cobro) se aplica igual después.
  const { planType: _p, nextPaymentDueDate: _d, trialEndsAt: _t, ...rest } = options.extraData ?? {};
  const pending = {
    kind: options.planGrant ? "ADMIN_GRANT" : "ADMIN_VERIFY",
    planType: options.extraData?.planType ?? vendor.planType,
    reason: options.reason ?? null,
    actorId: options.actorId ?? null,
    notifyType: options.notify?.type ?? null,
    planChangeReason: options.planChangeReason ?? null,
    planGrant: { ...durationOf(options), extra: serializeExtra(rest) },
    requestedAt: new Date().toISOString(),
  };
  await prisma.vendor.update({ where: { id: vendor.id }, data: { pendingActivation: pending } });
  await noticePending(vendor, pending.planType, missing, "PLAN_PENDING_COMPLETION");
  await logActivity({
    actorId: options.actorId ?? vendor.userId,
    actorRole: options.actorId ? "ADMIN" : "VENDOR",
    vendorId: vendor.id,
    action: "plan_pending_completion",
    description: `El plan ${await planDisplayName(pending.planType)} quedó pendiente: a la tienda le faltan ${missing.length} requisitos de la verificación (${missing.map((m) => m.label).join(", ")}).`,
    meta: { missing: missing.map((m) => m.key), pending },
  });
  return missing;
}

async function noticePending(vendor, planType, missing, type) {
  const name = await planDisplayName(planType);
  const list = missing.map((m) => m.label).join(", ");
  const paused = type === "PLAN_PAUSED_INCOMPLETE";
  const title = paused ? `Completa tu cuenta para recuperar el plan ${name}` : `Tu plan ${name} te espera`;
  const body = paused
    ? `Tu tienda tenía el plan ${name} y la insignia de verificada sin haber completado la verificación. Mientras la completas, vuelve al plan gratis, sin insignia ni funciones del plan. Te falta: ${list}. Al completarlo, el plan ${name} se activa solo.`
    : `El equipo te asignó el plan ${name}. Para activarlo, con su insignia y sus funciones, completa la verificación de tu tienda. Te falta: ${list}. Al completarlo, el plan se activa solo.`;
  // Import diferido: verificationNotify.service.js importa vendorVerification.service.js, que importa este archivo.
  const { sendVerificationUpdateEmail } = await import("../lib/email.js");
  const { env } = await import("../config/env.js");
  const user = vendor.user ?? (await prisma.user.findUnique({ where: { id: vendor.userId } }));
  await Promise.all([
    prisma.vendorNotification.create({ data: { vendorId: vendor.id, type, title, body } }),
    sendVerificationUpdateEmail({ vendor: { ...vendor, user }, type, title, message: body, ctaHref: `${env.frontendUrl}/vendedor/verificacion` }).catch(() => {}),
  ]);
}

// La tienda completó lo que faltaba: se aplica la activación guardada. Devuelve true si se aplicó.
export async function applyPendingActivationIfReady(vendorId) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, userId: true, companyName: true, pendingActivation: true, verificationStatus: true, deletedAt: true } });
  const p = vendor?.pendingActivation;
  if (!p || vendor.deletedAt) return false;
  if ((await missingRequirements(vendorId)).length) return false;

  // La duración empieza hoy: meses de una activación a mano, o los días que quedaban de un pago o de un plan pausado.
  const g = p.planGrant ?? {};
  const now = Date.now();
  const end = g.noExpiry ? null : new Date(now + (g.remainingMs ?? (g.months ?? 1) * 30 * DAY_MS));
  const extraData = { ...reviveExtra(g.extra), planType: p.planType, nextPaymentDueDate: end, trialEndsAt: null, planDowngradeAt: null, planDowngradeReason: null };
  const { transitionVendorVerification } = await import("./vendorVerification.service.js");
  await transitionVendorVerification(vendorId, "VERIFIED", {
    reason: p.reason ? `${p.reason} (activado al completar la verificación)` : "Activado al completar la verificación.",
    actorId: p.actorId,
    source: "ADMIN_ACTION",
    extraData: { ...extraData, pendingActivation: Prisma.DbNull },
    notify: p.notifyType ? { type: p.notifyType } : { type: "VERIFICATION_VERIFIED" },
    planChangeReason: p.planChangeReason ?? (p.kind === "ADMIN_GRANT" ? "admin_grant" : null),
    skipRequirements: true,
  });
  const name = await planDisplayName(p.planType);
  await logActivity({
    actorId: vendor.userId,
    actorRole: "VENDOR",
    vendorId,
    action: "plan_pending_applied",
    description: `La tienda completó la verificación y se activó el plan ${name} que estaba pendiente.`,
    meta: { pending: p },
  });
  await notifyAdminActionNeeded(`${vendor.companyName} completó su verificación`, `Se activó el plan ${name} que estaba pendiente hasta que la tienda completara su cuenta.`, vendorId, { url: `/admin/tiendas/${vendorId}` }).catch(() => {});
  return true;
}

// Tiendas que hoy tienen la insignia sin haber subido el documento de identidad o la selfie: pasa por ejemplo si el admin
// activó un plan con insignia a mano antes de esta regla. Vuelven al plan gratis y su plan queda pendiente, con los días que
// les quedaban, hasta que completen la verificación. Solo se miran esos dos documentos: ninguna tienda revisada de verdad
// los tiene vacíos, mientras que los datos legales se agregaron después y una tienda verificada antes puede no tenerlos, y
// una que se queda sin productos o sin logo no pierde la insignia por eso.
const DOCUMENT_KEYS = new Set(["idDocument", "selfie"]);
export async function pauseVerifiedWithoutDocuments() {
  const verified = await prisma.vendor.findMany({ where: { verificationStatus: "VERIFIED", deletedAt: null }, select: { id: true } });
  let paused = 0;
  for (const { id } of verified) {
    const missing = (await getTrialChecklist(id)).filter((i) => !i.done);
    if (!missing.some((m) => DOCUMENT_KEYS.has(m.key))) continue;
    const vendor = await prisma.vendor.findUnique({ where: { id }, include: { user: true } });
    const now = Date.now();
    const due = vendor.nextPaymentDueDate ?? vendor.trialEndsAt;
    const pending = {
      kind: "PAUSED",
      planType: vendor.planType,
      reason: "Plan pausado hasta completar la verificación.",
      actorId: null,
      notifyType: "VERIFICATION_VERIFIED",
      planChangeReason: null,
      planGrant: due ? { remainingMs: Math.max(due.getTime() - now, DAY_MS) } : { noExpiry: true },
      extraData: null,
      requestedAt: new Date().toISOString(),
    };
    const { transitionVendorVerification } = await import("./vendorVerification.service.js");
    // Sale de VERIFIED: transitionVendorVerification la pasa al plan por defecto y lo anota en el historial. Vuelve a "sin
    // empezar" (no a PLAN_ENDED, que le diría que sus documentos están aprobados): su página de verificación le pide subirlos.
    await transitionVendorVerification(id, "NOT_STARTED", {
      reason: `Insignia pausada: faltan documentos de la verificación (${missing.map((m) => m.label).join(", ")}).`,
      source: "CRON_EXPIRATION",
      extraData: { pendingActivation: pending, nextPaymentDueDate: null, trialEndsAt: null },
      planChangeReason: "admin_revoke",
    });
    await noticePending(vendor, pending.planType, missing, "PLAN_PAUSED_INCOMPLETE");
    await logActivity({
      actorId: vendor.userId,
      actorRole: "VENDOR",
      vendorId: id,
      action: "plan_paused_incomplete",
      description: `Insignia y plan ${await planDisplayName(pending.planType)} pausados: la tienda no ha completado la verificación (${missing.map((m) => m.label).join(", ")}).`,
      meta: { missing: missing.map((m) => m.key), pending },
    });
    paused++;
  }
  return paused;
}
