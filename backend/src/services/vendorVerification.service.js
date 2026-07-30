import { prisma } from "../lib/prisma.js";
import { notifyVerificationEvent } from "./verificationNotify.service.js";

// Bloque 64 (fuente única de verdad — bug real reportado en vivo): antes el
// badge/IA/destacado leían `Vendor.isVerified`, un booleano guardado APARTE
// del estado real de verificación (`VerificationRequest.status`) — nada
// impedía que se desincronizaran (confirmado en la propia base de datos: 5
// de 12 tiendas sembradas tenían isVerified=true sin verificación real). Ese
// booleano se eliminó de la tabla; este módulo es el ÚNICO lugar permitido
// para leer o cambiar el estado de verificación de una tienda.

// Cualquier objeto vendor (completo, o con `select` parcial que incluya
// `verificationStatus`) recibe acá su `isVerified` calculado en el momento,
// nunca guardado — así los ~23 componentes de frontend que ya leen
// `vendor.isVerified` en las respuestas de la API siguen funcionando igual,
// pero es estructuralmente imposible que ese valor quede desincronizado (no
// existe ningún lugar donde se guarde aparte del estado real).
export function withComputedVendorFields(vendor) {
  if (!vendor) return vendor;
  return { ...vendor, isVerified: vendor.verificationStatus === "VERIFIED" };
}

export function withComputedVendorFieldsList(vendors) {
  return vendors.map(withComputedVendorFields);
}

// Único punto que de verdad cambia Vendor.verificationStatus — todo lo demás
// (aprobar/rechazar documentos, confirmar pago CUP, webhooks de Stripe,
// revocar Business a mano, cron de vencimiento) llama esta función en vez de
// tocar el campo directo. Dispara la notificación (bell + email) que
// corresponda SOLO si se pasa `notify` — algunas transiciones son puramente
// internas y no ameritan avisar al vendedor (ej. PENDING_DOCS -> IN_REVIEW,
// un admin simplemente abrió la solicitud).
export async function transitionVendorVerification(vendorId, toStatus, { reason = null, actorId = null, source, notify, extraData = {} } = {}) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, include: { user: true } });
  if (!vendor) throw new Error(`Vendor ${vendorId} no encontrado (transitionVendorVerification)`);

  const fromStatus = vendor.verificationStatus;

  const [updatedVendor] = await prisma.$transaction([
    prisma.vendor.update({ where: { id: vendorId }, data: { verificationStatus: toStatus, ...extraData } }),
    prisma.verificationStatusLog.create({
      data: { vendorId, fromStatus, toStatus, reason, actorId, source },
    }),
  ]);

  // Bloque 72 (pedido explícito): archiva una rama nueva SOLO cuando esta
  // transición a VERIFIED corresponde a una verificación recién aprobada de
  // verdad — `fromStatus === "PENDING_PAYMENT"` es la señal correcta: es el
  // único estado que viene justo después de que un admin aprobó documentos
  // recién enviados (PENDING_DOCS -> IN_REVIEW -> PENDING_PAYMENT), sin
  // importar si el pago fue CUP o Stripe. Las renovaciones que NO requieren
  // reenviar documentos (SUSPENDED -> VERIFIED al pagar de nuevo,
  // PAYMENT_FAILED -> VERIFIED al recuperarse un cobro de Stripe) parten de
  // otros estados y correctamente NO generan una rama duplicada de la misma
  // documentación ya archivada.
  if (toStatus === "VERIFIED" && fromStatus === "PENDING_PAYMENT") {
    await archiveVerificationDocuments(vendorId).catch(() => {});
  }

  if (notify) {
    await notifyVerificationEvent({ ...vendor, ...updatedVendor, user: vendor.user }, notify.type, { notes: reason, ctaHref: notify.ctaHref });
  }

  return updatedVendor;
}

async function archiveVerificationDocuments(vendorId) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: { verification: true, registrationCountry: true, legalProvince: true, legalMunicipality: true },
  });
  if (!vendor?.verification) return;

  const v = vendor.verification;
  await prisma.verificationArchive.create({
    data: {
      vendorId,
      companyName: vendor.companyName,
      ownerName: vendor.ownerName,
      ownerIdNumber: vendor.ownerIdNumber,
      companyTaxId: vendor.companyTaxId,
      companyAddress: vendor.companyAddress,
      description: vendor.description,
      idDocumentType: v.idDocumentType,
      fullName: v.fullName,
      idNumber: v.idNumber,
      registrationCountryName: vendor.registrationCountry?.name ?? null,
      legalProvinceName: vendor.legalProvince?.name ?? null,
      legalMunicipalityName: vendor.legalMunicipality?.name ?? null,
      selfieUrl: v.selfieUrl,
      idPhotoFrontUrl: v.idPhotoFrontUrl,
      idPhotoBackUrl: v.idPhotoBackUrl,
      submittedAt: v.createdAt,
      reviewedAt: v.reviewedAt,
      reviewedById: v.reviewedById,
    },
  });
}
