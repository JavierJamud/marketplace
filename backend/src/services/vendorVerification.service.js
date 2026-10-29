import { prisma } from "../lib/prisma.js";
import { notifyVerificationEvent } from "./verificationNotify.service.js";
import { recalcVendorProductQuota, getDefaultPlanKey, getTrialPlanKey, getPlanConfig, planDisplayName, recordPlanChange } from "../lib/planConfig.js";

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

// Motivo de un cambio de plan hecho por transitionVendorVerification cuando quien llama no dice cuál (planChangeReason).
// Sale del origen de la transición y de si la tienda gana o pierde la insignia. Son códigos de PLAN_CHANGE_REASONS
// (lib/planConfig.js): las estadísticas de planes cuentan altas y bajas con ellos.
function planChangeReasonFor(source, toStatus) {
  if (toStatus === "VERIFIED") {
    if (source === "ADMIN_ACTION") return "verification_approved";
    if (source === "STRIPE_WEBHOOK") return "card_subscription";
    if (source === "VENDOR_ACTION") return "trial_start";
    return "other";
  }
  if (source === "ADMIN_ACTION") return "admin_revoke";
  if (source === "VENDOR_ACTION") return "downgrade_cancelled";
  return "downgrade_unpaid";
}

// Único punto que de verdad cambia Vendor.verificationStatus — todo lo demás
// (aprobar/rechazar documentos, confirmar pago, webhooks de Stripe, revocar
// Business a mano, cron de vencimiento) llama esta función en vez de tocar
// el campo directo. Dispara la notificación (bell + email) que corresponda
// SOLO si se pasa `notify` — algunas transiciones son puramente internas y
// no ameritan avisar al vendedor (ej. PENDING_DOCS -> IN_REVIEW, un admin
// simplemente abrió la solicitud).
//
// Si la transición cambia Vendor.planType (por extraData.planType o porque pierde VERIFIED y vuelve al plan por defecto),
// el cambio queda anotado en VendorPlanChange DENTRO de la misma transacción. Quien llama a esta función NO debe llamar
// recordPlanChange otra vez (saldría duplicado): si quiere un motivo exacto lo pasa en `planChangeReason` (un código de
// PLAN_CHANGE_REASONS). Sin él se deduce del origen y del estado nuevo (planChangeReasonFor).
export async function transitionVendorVerification(vendorId, toStatus, { reason = null, actorId = null, source, notify, extraData = {}, planChangeReason = null } = {}) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, include: { user: true } });
  if (!vendor) throw new Error(`Vendor ${vendorId} no encontrado (transitionVendorVerification)`);

  const fromStatus = vendor.verificationStatus;
  // VERIFIED (la insignia) va siempre con un plan de pago, nunca con el plan por defecto (isDefault, hoy el Básico). Al
  // perder VERIFIED (vencimiento de la prueba, cobro fallido, decisión del admin) la tienda vuelve al plan por defecto. Se
  // fuerza acá, en el único punto que cambia el estado, para que ningún camino deje una tienda con insignia sin plan o con
  // un plan pagado sin la verificación que ese plan exige. Los planes de pago sin insignia no pasan por la verificación (se
  // pagan desde Suscripción), así que un cambio de estado de una tienda que nunca estuvo verificada no le toca el plan.
  // El plan por defecto sale de su bandera (getDefaultPlanKey), no de una clave fija.
  const defaultKey = await getDefaultPlanKey();
  const plan = extraData.planType ?? vendor.planType;
  if (toStatus === "VERIFIED" && plan === defaultKey) toStatus = "PLAN_ENDED";
  const data = { ...extraData, verificationStatus: toStatus };
  if (toStatus !== "VERIFIED" && fromStatus === "VERIFIED") data.planType = defaultKey;
  const toPlan = data.planType ?? vendor.planType;

  // Transacción interactiva (antes era un arreglo): recordPlanChange es una función async y no entra en el arreglo de
  // $transaction, y el cambio de plan tiene que quedar anotado junto con el cambio real, nunca uno sin el otro.
  const updatedVendor = await prisma.$transaction(async (tx) => {
    const updated = await tx.vendor.update({ where: { id: vendorId }, data });
    await tx.verificationStatusLog.create({ data: { vendorId, fromStatus, toStatus, reason, actorId, source } });
    if (toPlan !== vendor.planType) {
      await recordPlanChange(tx, {
        vendorId,
        fromPlan: vendor.planType,
        toPlan,
        reason: planChangeReason ?? planChangeReasonFor(source, toStatus),
        actorId,
      });
    }
    return updated;
  });

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

  // El cupo de productos depende del plan: al cambiar, se recalcula qué productos quedan visibles.
  if (updatedVendor.planType !== vendor.planType) await recalcVendorProductQuota(vendorId);

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
      registrationCountryName: vendor.registrationCountry?.name ?? vendor.registrationCountryOther ?? null,
      legalProvinceName: vendor.legalProvince?.name ?? vendor.legalProvinceOther ?? null,
      legalMunicipalityName: vendor.legalMunicipality?.name ?? vendor.legalMunicipalityOther ?? null,
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

// Corrige las tiendas que quedaron fuera de la regla "Pro activo <=> VERIFIED" (datos de antes de la regla, o un cambio hecho
// a mano en la base). Se corre al arrancar el servidor y en la tarea diaria; si todo está bien, no toca nada.
//  - Insignia con el plan por defecto: si tiene una prueba gratis o un periodo pagado en curso, recupera el plan de pago
//    que le corresponde (restorePlanFor); si no, pierde la insignia (PLAN_ENDED).
//  - Plan con insignia sin estar VERIFIED: no tiene ninguna de sus funciones, vuelve al plan por defecto.
// Nada de claves fijas: el plan por defecto y el de prueba salen de sus banderas.
export async function reconcilePlanVerification() {
  const now = new Date();
  const defaultKey = await getDefaultPlanKey();
  const defaultName = await planDisplayName(defaultKey);
  const badgeWithoutPlan = await prisma.vendor.findMany({
    where: { verificationStatus: "VERIFIED", planType: defaultKey },
    select: { id: true, trialEndsAt: true, nextPaymentDueDate: true, verification: { select: { paymentPlanType: true } } },
  });
  let restored = 0;
  let ended = 0;
  for (const v of badgeWithoutPlan) {
    const inTrial = !!v.trialEndsAt && v.trialEndsAt > now;
    const inPeriod = inTrial || (v.nextPaymentDueDate && v.nextPaymentDueDate > now);
    if (inPeriod) {
      const toPlan = await restorePlanFor(v, { inTrial });
      const toName = await planDisplayName(toPlan);
      await prisma.$transaction(async (tx) => {
        await tx.vendor.update({ where: { id: v.id }, data: { planType: toPlan } });
        await tx.verificationStatusLog.create({
          data: { vendorId: v.id, fromStatus: "VERIFIED", toStatus: "VERIFIED", source: "CRON_EXPIRATION", reason: `Tenía la insignia en el plan ${defaultName} con la prueba o el periodo pagado en curso: recupera el plan ${toName}.` },
        });
        await recordPlanChange(tx, { vendorId: v.id, fromPlan: defaultKey, toPlan, reason: "other" });
      });
      await recalcVendorProductQuota(v.id);
      restored++;
    } else {
      await transitionVendorVerification(v.id, "PLAN_ENDED", {
        source: "CRON_EXPIRATION",
        reason: `Tenía la insignia en el plan ${defaultName}: ese plan no lleva la insignia.`,
      });
      ended++;
    }
  }
  // Un plan que exige la verificación (da la insignia) sin estar verificada no tiene ninguna de sus funciones: vuelve al
  // plan por defecto. Los planes de pago sin insignia no exigen verificación y no se tocan. Los archivados entran también:
  // una tienda que quedó en uno no tiene que conservar sus funciones sin la insignia.
  const badgePlans = (await prisma.planConfig.findMany({ where: { grantsBadge: true, planType: { not: defaultKey } }, select: { planType: true } })).map((p) => p.planType);
  const planWithoutBadge = await prisma.vendor.findMany({ where: { verificationStatus: { not: "VERIFIED" }, planType: { in: badgePlans }, trialEndsAt: null }, select: { id: true, planType: true } });
  for (const v of planWithoutBadge) {
    await prisma.$transaction(async (tx) => {
      await tx.vendor.update({ where: { id: v.id }, data: { planType: defaultKey } });
      await recordPlanChange(tx, { vendorId: v.id, fromPlan: v.planType, toPlan: defaultKey, reason: "other" });
    });
    await recalcVendorProductQuota(v.id);
  }
  const fixed = restored + ended + planWithoutBadge.length;
  if (fixed) console.log(`[planes] corregidas: ${restored} recuperan su plan de pago, ${ended} pierden la insignia, ${planWithoutBadge.length} pasan al plan ${defaultKey}`);
  return { restored, ended, toRegular: planWithoutBadge.length };
}

// Plan de pago que recupera una tienda con insignia que quedó en el plan por defecto teniendo tiempo en curso. En prueba
// gratis, el plan de prueba. Con un periodo pagado, el del último pago confirmado (renovación o verificación) si sigue
// vigente y se cobra; si no hay ninguno usable, el plan de prueba (antes de los planes configurables todo pago era de
// Premium, que es el de prueba). Nunca devuelve el plan por defecto, uno archivado ni uno sin insignia (la tienda sigue
// VERIFIED, y un plan sin insignia con VERIFIED queda en un estado que esta misma revisión no corrige).
async function restorePlanFor(vendor, { inTrial }) {
  const trialKey = await getTrialPlanKey();
  if (inTrial) return trialKey;
  const last = await prisma.subscriptionPayment.findFirst({
    where: { vendorId: vendor.id, confirmedAt: { not: null }, planType: { not: null } },
    orderBy: { confirmedAt: "desc" },
    select: { planType: true },
  });
  const defaultKey = await getDefaultPlanKey();
  for (const key of [last?.planType, vendor.verification?.paymentPlanType]) {
    if (!key || key === defaultKey) continue;
    const config = await getPlanConfig(key);
    // Gratis no sirve (no es un plan de pago); "por WhatsApp" sí: esos pagos los registra el equipo a mano.
    if (config && !config.archivedAt && !config.isFree && config.grantsBadge) return key;
  }
  return trialKey;
}
