// Campos de la fila Vendor que nunca deben salir en un endpoint público ni hacia otro cliente:
// datos legales/KYC del dueño, ids de facturación, estado interno de moderación y ciclo de vida.
// Se usa una lista de exclusión porque estos endpoints devuelven `include` de Prisma (fila completa)
// y el frontend público necesita casi todo lo demás; un campo nuevo sensible se agrega aquí.
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
  "nextPaymentDueDate",
  "cancelAtPeriodEnd",
  "blockReason",
  "blockedAt",
  "deletedAt",
  "deletionRequestedAt",
  "adminDeletionRequestedAt",
  "adminDeletionRequestedById",
  "adminDeletionReminderSentAt",
  "suspendedAt",
  "suspensionReason",
  "reactivatedAt",
  "reactivationReason",
  "lastInactivityEmailAt",
  "aiDocument",
  "aiDocumentName",
  "salesCount",
  "cashCloseFrequency",
  "cashCloseDayOfWeek",
  "cashCloseDayOfMonth",
  "cashCloseReminderSentAt",
  "trialOfferDismissedAt",
  "trialStartedAt",
  "trialEndsAt",
  "trialWelcomeSeenAt",
];

export function toPublicVendor(vendor) {
  if (!vendor || typeof vendor !== "object") return vendor;
  const safe = { ...vendor };
  for (const field of PRIVATE_VENDOR_FIELDS) delete safe[field];
  return safe;
}
