import { prisma } from "../lib/prisma.js";
import { transitionVendorVerification } from "./vendorVerification.service.js";
import { recalcVendorProductQuota } from "../lib/planConfig.js";
import { logActivity } from "../lib/activityLog.js";

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
const TRIAL_DAYS = 30;

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
    { key: "locations", label: "Provincia donde opera", done: (vendor.locations?.length ?? 0) > 0 },
    { key: "companyAddress", label: "Dirección legal del negocio", done: !!vendor.companyAddress },
    { key: "registrationCountryId", label: "País de registro legal", done: !!vendor.registrationCountryId },
    { key: "legalProvinceId", label: "Provincia de registro legal", done: !!vendor.legalProvinceId },
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
  const complete = await isTrialChecklistComplete(vendor);
  if (!complete) return false;
  await activateVendorTrial(vendor);
  return true;
}

// `vendorOrId`: igual que getTrialChecklist, acepta un vendor ya cargado
// (necesita vendor.userId, por eso el `include` de loadVendorForChecklist
// alcanza con el select por default) para no repetir el fetch.
async function activateVendorTrial(vendorOrId) {
  const vendor = typeof vendorOrId === "string" ? await loadVendorForChecklist(vendorOrId) : vendorOrId;
  const trialEndsAt = new Date(Date.now() + TRIAL_DAYS * 24 * 60 * 60 * 1000);
  // Mismo molde que grantBusinessPlan (admin.controller.js) — la única
  // diferencia real es `source` (acá VENDOR_ACTION, nunca ADMIN_ACTION,
  // porque no hubo ningún admin de por medio) y que trialEndsAt sí se
  // guarda (grantBusinessPlan nunca inicia un trial, es Premium real).
  const updated = await transitionVendorVerification(vendor.id, "VERIFIED", {
    reason: "Activación automática del trial gratuito de 30 días del Plan Premium.",
    source: "VENDOR_ACTION",
    extraData: { planType: "BUSINESS", trialEndsAt },
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
    description: "Se activó solo el trial gratuito de 30 días del Plan Premium al completar todos los requisitos.",
  });
  return updated;
}
