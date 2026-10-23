import { prisma } from "../lib/prisma.js";
import { transitionVendorVerification } from "./vendorVerification.service.js";
import { recalcVendorProductQuota } from "../lib/planConfig.js";
import { logActivity } from "../lib/activityLog.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { getTrialDays } from "../controllers/settings.controller.js";

// Bloque 235 (pedido explícito — trial gratuito de 30 días del Plan
// Premium, gancho de lanzamiento): único lugar que calcula si una tienda
// completó todo lo necesario para que su trial se active solo, y el único
// que dispara esa activación. Mismo criterio que vendorVerification.service.js
// ("un solo lugar permitido para cambiar el estado") — acá es "un solo
// lugar permitido para decidir si el trial ya está listo".
//
// A propósito, el checklist mira los datos CRUDOS del vendedor (campos del
// perfil + VerificationRequest + si tiene un producto publicado) y NUNCA
// `verificationStatus` — hoy, enviar los documentos KYC solo deja la
// solicitud en PENDING_DOCS, a la espera de que un admin la revise a mano
// (ver submitVerification, verification.controller.js). El trial tiene que
// poder activarse SIN esa revisión humana (decisión confirmada
// explícitamente por el dueño), así que lo único que importa acá es si los
// DATOS ya están completos, no si alguien ya los aprobó.
const MIN_DESCRIPTION_LENGTH = 30; // mismo mínimo que submitSchema en verification.controller.js

async function loadVendorForChecklist(vendorId) {
  return prisma.vendor.findUnique({
    where: { id: vendorId },
    include: {
      verification: true,
      locations: true,
      _count: { select: { products: { where: { isActive: true, hiddenFromStore: false, overQuota: false } } } },
    },
  });
}

// `vendorOrId`: acepta un id (hace su propio fetch, con todo lo que hace
// falta) o un vendor ya cargado con la MISMA forma que loadVendorForChecklist
// (verification + locations + _count.products con ese filtro) — así
// maybeAutoActivateTrial no pide los datos dos veces.
export async function getTrialChecklist(vendorOrId) {
  const vendor = typeof vendorOrId === "string" ? await loadVendorForChecklist(vendorOrId) : vendorOrId;
  if (!vendor) return [];
  const v = vendor.verification;
  return [
    { key: "companyName", label: "Nombre de la empresa", done: !!vendor.companyName },
    { key: "ownerName", label: "Nombre del responsable", done: !!vendor.ownerName },
    { key: "whatsapp", label: "WhatsApp de contacto", done: !!vendor.whatsapp },
    { key: "email", label: "Correo de contacto", done: !!vendor.email },
    { key: "businessCategoryId", label: "Tipo de negocio", done: !!vendor.businessCategoryId },
    {
      key: "description",
      label: "Descripción de la tienda",
      done: !!vendor.description && vendor.description.trim().length >= MIN_DESCRIPTION_LENGTH,
    },
    { key: "locations", label: "Provincia y municipio donde opera", done: (vendor.locations?.length ?? 0) > 0 },
    { key: "companyAddress", label: "Dirección legal del negocio", done: !!vendor.companyAddress },
    { key: "registrationCountryId", label: "País de registro legal", done: !!(vendor.registrationCountryId || vendor.registrationCountryOther) },
    { key: "legalProvinceId", label: "Provincia y municipio de registro legal", done: !!(vendor.legalProvinceId || vendor.legalProvinceOther) },
    { key: "idDocument", label: "Documento de identidad (foto)", done: !!v?.idPhotoFrontUrl },
    { key: "selfie", label: "Selfie de verificación", done: !!v?.selfieUrl },
    // Bloque 235: requisito NUEVO, exclusivo de este checklist — logoUrl no
    // es obligatorio en ningún otro lugar de la app (registro, edición de
    // perfil, envío de KYC). Un vendedor que nunca toma el trial puede
    // seguir sin logo para siempre, igual que hoy.
    { key: "logoUrl", label: "Logo de la tienda", done: !!vendor.logoUrl },
    { key: "hasPublishedProduct", label: "Al menos un producto publicado", done: (vendor._count?.products ?? 0) > 0 },
  ];
}

// Requisitos que se completan dentro del propio envío de la verificación (datos legales, documento y selfie). Todo lo demás
// tiene que estar hecho ANTES de enviarla: la insignia de verificada exige la tienda completa, se pida o no la prueba gratis.
export const KYC_FORM_KEYS = new Set(["companyAddress", "registrationCountryId", "legalProvinceId", "idDocument", "selfie"]);

export async function missingBeforeVerification(vendorOrId) {
  const checklist = await getTrialChecklist(vendorOrId);
  return checklist.filter((item) => !item.done && !KYC_FORM_KEYS.has(item.key));
}

// La prueba gratis es para tiendas que nunca tuvieron Premium. Una que ya pagó (o ya usó su prueba) no la puede pedir ni
// recibir: antes se le ofrecía a cualquiera sin trialStartedAt, aunque estuviera pagando, y al vencer una prueba
// (trialEndsAt vuelve a null) el siguiente guardado de perfil la volvía a activar gratis.
const PREMIUM_HISTORY_STATUSES = new Set(["VERIFIED", "PLAN_ENDED"]);

export async function hasHadPremium(vendorId) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: { verificationStatus: true, planType: true, nextPaymentDueDate: true, stripeSubscriptionId: true, verification: { select: { paymentConfirmedAt: true } } },
  });
  if (!vendor) return false;
  if (PREMIUM_HISTORY_STATUSES.has(vendor.verificationStatus) || vendor.planType === "BUSINESS") return true;
  if (vendor.nextPaymentDueDate || vendor.stripeSubscriptionId || vendor.verification?.paymentConfirmedAt) return true;
  const everVerified = await prisma.verificationStatusLog.findFirst({ where: { vendorId, toStatus: "VERIFIED" }, select: { id: true } });
  return !!everVerified;
}

export async function isTrialChecklistComplete(vendorOrId) {
  const checklist = await getTrialChecklist(vendorOrId);
  return checklist.length > 0 && checklist.every((item) => item.done);
}

// Punto de disparo único — se llama (best-effort, nunca bloquea la
// respuesta del endpoint que lo dispara) al final de cada escritura que
// podría completar el checklist: guardar perfil/logo, enviar KYC, publicar
// un producto. Nunca por un barrido de cron — mismo criterio que ya usa
// recalcVendorProductQuota en este mismo código, llamado en línea después
// de cada escritura relevante, nunca por cron.
export async function maybeAutoActivateTrial(vendorId) {
  const vendor = await loadVendorForChecklist(vendorId);
  if (!vendor) return false;
  // trialStartedAt null = nunca aceptó la oferta, nada que activar.
  // trialEndsAt ya puesto = ya está en un trial activo (o ya venció y lo
  // volvería a tocar el cron, no esto). VERIFIED = ya está verificada por
  // otra vía (a mano, pago real) — no hay nada que hacer.
  if (!vendor.trialStartedAt || vendor.trialEndsAt || vendor.verificationStatus === "VERIFIED") return false;
  // Prueba con tarjeta: no se activa sola al completar los pasos. Falta registrar la tarjeta en Stripe (0 USD hoy) y la
  // activa el aviso de Stripe (ver activateFromCardSubscription en verification.controller.js).
  if (vendor.trialBilling === "CARD") return false;
  if (await hasHadPremium(vendor.id)) return false;
  const complete = await isTrialChecklistComplete(vendor);
  if (!complete) return false;
  await activateVendorTrial(vendor);
  return true;
}

// `vendorOrId`: igual que getTrialChecklist, acepta un vendor ya cargado
// (necesita vendor.userId, por eso el `include` de loadVendorForChecklist
// alcanza con el select por default) para no repetir el fetch.
// `options.trialEndsAt`: con la prueba con tarjeta, la fecha la pone Stripe (fin de la prueba de la suscripción).
// `options.extraData`: datos de la suscripción de Stripe que se guardan en la misma transición.
export async function activateVendorTrial(vendorOrId, { trialEndsAt: fixedEnd = null, extraData: extra = {}, reason = null } = {}) {
  const vendor = typeof vendorOrId === "string" ? await loadVendorForChecklist(vendorOrId) : vendorOrId;
  // La duración la define el admin en Suscripciones; con tarjeta la fija Stripe (fixedEnd) con ese mismo valor.
  const trialDays = await getTrialDays();
  const trialEndsAt = fixedEnd ?? new Date(Date.now() + trialDays * 24 * 60 * 60 * 1000);
  // Mismo molde que grantBusinessPlan (admin.controller.js) — la única
  // diferencia real es `source` (acá VENDOR_ACTION, nunca ADMIN_ACTION,
  // porque no hubo ningún admin de por medio) y que trialEndsAt sí se
  // guarda (grantBusinessPlan nunca inicia un trial, es Premium real).
  const updated = await transitionVendorVerification(vendor.id, "VERIFIED", {
    reason: reason ?? `Activación automática de la prueba gratis de ${trialDays} días del Plan Premium.`,
    source: "VENDOR_ACTION",
    extraData: { planType: "BUSINESS", trialEndsAt, ...extra },
    notify: { type: "TRIAL_ACTIVATED" },
  });
  await recalcVendorProductQuota(vendor.id);
  // actorId = el propio usuario dueño de la tienda (ActivityLog.actorId es
  // obligatorio, no hay ningún admin humano detrás de esto) — fire-and-
  // forget, igual que el resto de los call sites de logActivity.
  logActivity({
    actorId: vendor.userId,
    actorRole: "VENDOR",
    vendorId: vendor.id,
    action: "trial_activated",
    description: `Se activó sola la prueba gratis de ${trialDays} días del Plan Premium al completar todos los requisitos.`,
  });
  void notifyAdminActionNeeded(
    `Prueba gratis activada: ${vendor.companyName}`,
    `${vendor.companyName} completó todos los requisitos y ya tiene activa la prueba gratis del Plan Premium (hasta el ${trialEndsAt.toLocaleDateString("es-CU", { timeZone: "America/Havana" })}).`,
    vendor.id,
    { url: `/admin/tiendas/${vendor.id}` }
  ).catch(() => {});
  return updated;
}
