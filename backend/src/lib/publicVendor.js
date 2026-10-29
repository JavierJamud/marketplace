import { Prisma } from "@prisma/client";
import { publicSocialLinks } from "./socialLinks.js";
// Campos de la fila Vendor que nunca deben salir en un endpoint público ni hacia otro cliente:
// datos legales/KYC del dueño, ids de facturación, estado interno de moderación y ciclo de vida.
// Estos endpoints devuelven `include` de Prisma (fila completa) y el frontend público necesita casi todo lo demás.
export const PRIVATE_VENDOR_FIELDS = [
  "userId",
  "partnerId",
  "ownerName",
  "ownerIdNumber",
  "companyAddress",
  "companyTaxId",
  "email",
  "registrationCountryId",
  "legalProvinceId",
  "legalMunicipalityId",
  "registrationCountryOther",
  "legalProvinceOther",
  "legalMunicipalityOther",
  "stripeCustomerId",
  "stripeSubscriptionId",
  "stripeIntervalMonths",
  "nextPaymentDueDate",
  "cancelAtPeriodEnd",
  "blockReason",
  "blockedAt",
  // Proceso de fraude, cobro atrasado y bajada de plan: un visitante no tiene por qué saber que la tienda debe el plan o
  // tiene un caso abierto (se agregaron después de esta lista y salían en GET /vendors).
  "fraudSuspendedAt",
  "fraudContactDueAt",
  "fraudDeleteAt",
  "fraudStrikesResetAt",
  "billingSuspendedAt",
  "billingNoticeStage",
  "billingNoticeDue",
  "planDowngradeAt",
  "planDowngradeReason",
  "deletedAt",
  "deletionRequestedAt",
  "adminDeletionRequestedAt",
  "adminDeletionRequestedById",
  "adminDeletionReminderSentAt",
  "preDeletionBlockReason",
  "preDeletionBlockedAt",
  "suspendedAt",
  "suspensionReason",
  "reactivatedAt",
  "reactivationReason",
  "lastInactivityEmailAt",
  "aiDocument",
  "aiDocumentName",
  "salesCount",
  "notifyNewOrderEmail",
  "cashCloseFrequency",
  "cashCloseDayOfWeek",
  "cashCloseDayOfMonth",
  "cashCloseReminderSentAt",
  "trialOfferDismissedAt",
  "trialStartedAt",
  "trialEndsAt",
  "trialBilling",
  "trialWelcomeSeenAt",
  // Enlaces viejos de la tienda: el servidor los resuelve solo (redirige al actual), el visitante no los necesita.
  "previousSlugs",
];

// Columnas de Vendor revisadas que sí ve el público (la ficha de la tienda, el listado, el carrito y el checkout). Una
// columna nueva que no esté ni aquí ni en PRIVATE_VENDOR_FIELDS NO sale (ver toPublicVendor): antes la lista de exclusión
// sola dejaba pasar por defecto todo campo nuevo, y así se filtraron los de fraude y cobro.
export const PUBLIC_VENDOR_FIELDS = [
  "id",
  "companyName",
  "slug",
  "description",
  "whatsapp",
  "logoUrl",
  "color",
  "categoryId",
  "businessCategoryId",
  "isRestaurant",
  "tableCount",
  "menuPublic",
  "planType",
  "orderDestination",
  "checkoutPaymentOptions",
  "acceptedPaymentMethods",
  "verificationStatus",
  "isBlocked",
  "isPrivate",
  "status",
  "rating",
  "reviewCount",
  "socialLinks",
  "timezone",
  "currency",
  "storeShippingMode",
  "storeShippingLocal",
  "storeShippingOther",
  "storeShippingCurrency",
  // El carrito calcula "dentro / fuera de la provincia" con esta provincia (frontend/src/lib/shipping.js).
  "shippingOriginProvinceId",
  "warrantyTerms",
  "warrantyDefaultDays",
  "createdAt",
];

// Columnas reales del modelo Vendor según el cliente de Prisma generado. Las claves que no son columnas (relaciones
// incluidas como locations o category, _count, campos calculados) no se tocan aquí.
const VENDOR_COLUMNS = new Set(
  (Prisma.dmmf?.datamodel?.models?.find((m) => m.name === "Vendor")?.fields ?? []).filter((f) => f.kind !== "object").map((f) => f.name)
);
const PUBLIC_SET = new Set(PUBLIC_VENDOR_FIELDS);
const PRIVATE_SET = new Set(PRIVATE_VENDOR_FIELDS);

// Columnas de Vendor sin clasificar en ninguna de las dos listas: para el script de prueba y para avisar en el log.
export function unclassifiedVendorFields() {
  return [...VENDOR_COLUMNS].filter((f) => !PUBLIC_SET.has(f) && !PRIVATE_SET.has(f));
}

const unclassified = unclassifiedVendorFields();
if (unclassified.length) {
  console.warn(`[publicVendor] Columnas de Vendor sin clasificar (no se envían al público hasta sumarlas a una lista): ${unclassified.join(", ")}`);
}

export function toPublicVendor(vendor) {
  if (!vendor || typeof vendor !== "object") return vendor;
  const safe = { ...vendor };
  for (const field of PRIVATE_VENDOR_FIELDS) delete safe[field];
  // Una columna nueva sin revisar queda fuera hasta que alguien decida si es pública.
  for (const field of unclassified) delete safe[field];
  // Redes: al público solo le llegan las encendidas (ver lib/socialLinks.js).
  if ("socialLinks" in safe) safe.socialLinks = publicSocialLinks(safe.socialLinks);
  return safe;
}
