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
// (aprobar/rechazar documentos, confirmar pago, webhooks de Stripe, revocar
// Business a mano, cron de vencimiento) llama esta función en vez de tocar
// el campo directo. Dispara la notificación (bell + email) que corresponda
// SOLO si se pasa `notify` — algunas transiciones son puramente internas y
// no ameritan avisar al vendedor (ej. PENDING_DOCS -> IN_REVIEW, un admin
// simplemente abrió la solicitud).
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

  // Bloque 150 (pedido explícito — "debe quedar archivado todo el historial
  // desde que el cliente envía la solicitud, y siempre se pueda consultar"):
  // la rama de archivo YA EXISTE desde que se enviaron los documentos (ver
  // archiveVerificationSubmission, llamada desde submitVerification) — acá
  // solo se cierra con el desenlace final, en vez de crearse recién ahora
  // (criterio anterior, Bloque 72). Best-effort: si por lo que sea no hay
  // ninguna rama vinculada (vendedor viejo, de antes de este bloque), no
  // rompe la transición real.
  if (toStatus === "VERIFIED") await syncVerificationArchive(vendorId, { verifiedAt: new Date() }).catch(() => {});
  if (toStatus === "REJECTED") await syncVerificationArchive(vendorId, { rejectedAt: new Date(), notes: reason ?? undefined }).catch(() => {});

  if (notify) {
    await notifyVerificationEvent({ ...vendor, ...updatedVendor, user: vendor.user }, notify.type, { notes: reason, ctaHref: notify.ctaHref });
  }

  return updatedVendor;
}

// Bloque 150: arma la rama de archivo con el snapshot de identidad/negocio
// de siempre + lo que se le pase en `extraFields` (payment/revisión/cierre)
// — compartido por archiveVerificationSubmission (rama nueva, en blanco) y
// ensureVerificationArchive (Bloque 151, backfill de una ya en curso).
async function createArchiveBranch(vendorId, extraFields = {}) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: { verification: true, registrationCountry: true, legalProvince: true, legalMunicipality: true },
  });
  if (!vendor?.verification) return null;

  const v = vendor.verification;
  const archive = await prisma.verificationArchive.create({
    data: {
      vendorId,
      companyName: vendor.companyName,
      // Bloque 152 (pedido explícito, bug real reportado en vivo — "el
      // responsable debe ser la misma persona a la que está registrada la
      // cuenta"): `Vendor.ownerName` ("persona física responsable del
      // negocio", cargado en Configuración) y `VerificationRequest.fullName`
      // ("nombre completo del responsable", capturado en la verificación
      // KYC) son la MISMA persona por definición — el propio comentario del
      // schema de `ownerName` lo dice. Si el vendedor nunca cargó
      // `ownerName` en su perfil (caso real: Casa Verde), el archivo
      // quedaba con "Responsable: —" pese a que el nombre real YA estaba
      // disponible desde el KYC — se usa como respaldo en vez de dejarlo
      // vacío.
      ownerName: vendor.ownerName || v.fullName || null,
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
      selfieVideoUrl: v.selfieVideoUrl,
      submittedAt: v.createdAt,
      ...extraFields,
    },
  });
  await prisma.verificationRequest.update({ where: { vendorId }, data: { archiveId: archive.id } });
  return archive;
}

// Bloque 150: crea la rama de archivo del ciclo que arranca con ESTE envío
// (reemplaza a la vieja "se crea recién al llegar a VERIFIED") y la vincula
// desde VerificationRequest.archiveId — a partir de acá, cualquier paso
// posterior de este mismo ciclo (revisión, método de pago, comprobante,
// confirmación, desenlace final) se refleja en ESTA rama vía
// syncVerificationArchive. Un reenvío (tras un rechazo) crea una rama NUEVA
// — la vieja queda intacta, consultable para siempre, tal como se pidió.
export async function archiveVerificationSubmission(vendorId) {
  return createArchiveBranch(vendorId);
}

// Bloque 151 (bug real reportado en vivo, con captura — "si ya esa tienda
// envió datos, deberían salirme ya datos archivados... para ver si el
// administrador desea revisarlo antes de aprobar"): una solicitud que ya
// estaba EN CURSO (enviada antes de que existiera el archivo-desde-el-envío
// del Bloque 150) nunca recibió ninguna rama — `archiveVerificationSubmission`
// solo corre dentro de `submitVerification`, así que solicitudes viejas se
// quedaron con `archiveId: null` para siempre. Backfill perezoso: se llama
// desde `listVerificationArchive` (justo cuando un admin abre el archivo de
// una tienda) — si la solicitud vigente no tiene rama, arma una AHORA MISMO
// con el snapshot completo de cómo está hoy (documentos + lo que ya se haya
// avanzado del ciclo de pago), en vez de dejarlo vacío para siempre. No es
// retroactivo a ciclos que YA se reemplazaron por un reenvío posterior —
// esos datos viejos ya se perdieron con el upsert de VerificationRequest de
// antes de este bloque, no hay forma de reconstruirlos.
export async function ensureVerificationArchive(vendorId) {
  const verification = await prisma.verificationRequest.findUnique({ where: { vendorId } });
  if (!verification || verification.archiveId) return;

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { verificationStatus: true } });
  await createArchiveBranch(vendorId, {
    reviewedAt: verification.reviewedAt,
    reviewedById: verification.reviewedById,
    notes: verification.notes,
    paymentMethod: verification.paymentMethod,
    paymentMonths: verification.paymentMonths,
    paymentAmount: verification.paymentAmount,
    paymentCurrency: verification.paymentCurrency,
    payerName: verification.payerName,
    payerAccountNumber: verification.payerAccountNumber,
    payerPhone: verification.payerPhone,
    payerAddress: verification.payerAddress,
    payerCountry: verification.payerCountry,
    payerCardLast4: verification.payerCardLast4,
    paymentProofUrl: verification.paymentProofUrl,
    paymentProofUnavailable: verification.paymentProofUnavailable,
    paymentClaimedAt: verification.paymentClaimedAt,
    stripePaidAt: verification.stripePaidAt,
    paymentConfirmedAt: verification.paymentConfirmedAt,
    paymentConfirmedById: verification.paymentConfirmedById,
    verifiedAt: vendor?.verificationStatus === "VERIFIED" ? new Date() : null,
    rejectedAt: vendor?.verificationStatus === "REJECTED" ? new Date() : null,
  });
}

// Bloque 150: único punto que actualiza la rama de archivo VIGENTE de una
// tienda (la que apunta VerificationRequest.archiveId) — usado en cada paso
// del ciclo (revisión de documentos, método de pago elegido, comprobante
// subido, pago confirmado, desenlace final) para que el archivo quede
// completo y consultable en cualquier momento, no solo al final. No hace
// nada (silencioso) si la tienda no tiene ninguna rama vigente todavía.
export async function syncVerificationArchive(vendorId, patch) {
  const verification = await prisma.verificationRequest.findUnique({ where: { vendorId }, select: { archiveId: true } });
  if (!verification?.archiveId) return;
  await prisma.verificationArchive.update({ where: { id: verification.archiveId }, data: patch });
}
