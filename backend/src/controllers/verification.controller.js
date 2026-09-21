import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyVerificationEvent } from "../services/verificationNotify.service.js";
import { transitionVendorVerification, archiveVerificationSubmission, syncVerificationArchive } from "../services/vendorVerification.service.js";
import { createVerificationCheckoutSession, createRenewalCheckoutSession } from "../lib/stripe.js";
import { getBrandSettings, getSubscriptionPricing } from "./settings.controller.js";
// Bloque 69: extraído a un lib compartido — reviews.controller.js es el
// segundo consumidor real de este mismo "avisar al admin ya" (ver lib/adminNotify.js).
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { logActivity, actorRoleForVendorAction } from "../lib/activityLog.js";

// Bloque 150 (pedido explícito): cuántos meses puede elegir pagar de
// adelanto el vendedor — el monto real (precio mensual × meses) se calcula
// en cada punto que lo necesita, ver getSubscriptionPricing().
const MIN_PAYMENT_MONTHS = 1;
const MAX_PAYMENT_MONTHS = 24;

const __dirname = dirname(fileURLToPath(import.meta.url));
export const KYC_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "kyc");

const MIN_FILE_BYTES = 5 * 1024;
const MIN_DIMENSION_PX = 200;

// Validación automática básica (Bloque 10) — no es un modelo de ML ni
// verifica identidad: solo comprueba que el archivo existe, no está
// vacío/corrupto, y tiene resolución mínima razonable. Sirve para rechazar
// de entrada una captura obviamente rota (cámara falló, archivo truncado),
// pero desde Bloque 16 NUNCA aprueba la solicitud por sí sola — la
// aprobación final siempre la hace un admin a mano (ver updateVerification
// en admin.controller.js). Si la imagen no pasa este chequeo mínimo, se
// rechaza el envío ahí mismo (400) para que el vendedor vuelva a capturar.
async function validateKycImage(filename) {
  if (!filename) return { ok: false, reason: "falta el archivo" };
  try {
    const filepath = join(KYC_UPLOAD_DIR, filename);
    const stats = await stat(filepath);
    if (stats.size < MIN_FILE_BYTES) return { ok: false, reason: `archivo demasiado pequeño (${stats.size} bytes)` };

    const buffer = await readFile(filepath);
    const dimensions = imageSize(buffer);
    if (!dimensions.width || !dimensions.height) return { ok: false, reason: "no se pudo leer la imagen (formato inválido)" };
    if (dimensions.width < MIN_DIMENSION_PX || dimensions.height < MIN_DIMENSION_PX) {
      return { ok: false, reason: `resolución insuficiente (${dimensions.width}x${dimensions.height}px)` };
    }
    return { ok: true };
  } catch {
    return { ok: false, reason: "archivo corrupto o ilegible" };
  }
}

// Bloque 64: el "stage" que consume VendorVerification.jsx ahora ES
// directamente Vendor.verificationStatus (fuente única de verdad) — ya no
// hace falta traducir un enum interno de VerificationRequest a un ciclo de
// negocio aparte, el enum nuevo (NOT_STARTED/PENDING_DOCS/IN_REVIEW/
// PENDING_PAYMENT/VERIFIED/PAYMENT_FAILED/SUSPENDED/REJECTED) ya describe el
// ciclo completo un solo lugar.

// KYC: las fotos son privadas y nunca se sirven por URL pública — solo por
// este endpoint autenticado (dueño de la tienda o admin), nunca por
// express.static ni por un path expuesto directamente al frontend.
export async function getMyVerification(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true, user: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const v = vendor.verification;

  // Bloque 145 (pedido explícito — "el cliente debe recibir la información
  // que diga que esa aprobación será válida por 24 horas"): se calcula del
  // mismo historial real que usa el cron de vencimiento
  // (expireStalePendingPaymentApprovals, verificationPayment.job.js) — nunca
  // un campo aparte que se podría desincronizar de cuándo vence de verdad.
  let paymentDeadlineAt = null;
  if (vendor.verificationStatus === "PENDING_PAYMENT") {
    const lastEntry = await prisma.verificationStatusLog.findFirst({
      where: { vendorId: vendor.id, toStatus: "PENDING_PAYMENT" },
      orderBy: { at: "desc" },
    });
    if (lastEntry) paymentDeadlineAt = new Date(lastEntry.at.getTime() + 24 * 60 * 60 * 1000);
  }

  // Bloque 150: el monto esperado (precio mensual × meses elegidos) se
  // calcula acá, nunca se guarda aparte — así nunca puede desincronizarse
  // del precio vigente configurado por el admin (AdminSubscriptions.jsx).
  let expectedAmount = null;
  if (v?.paymentMonths) {
    const pricing = await getSubscriptionPricing();
    const pricePerMonth = v.paymentCurrency === "USD" ? pricing.cardPricePerMonthUsd : pricing.cupPricePerMonth;
    expectedAmount = pricePerMonth * v.paymentMonths;
  }

  res.json({
    verification: {
      verificationStatus: vendor.verificationStatus,
      nextPaymentDueDate: vendor.nextPaymentDueDate,
      paymentDeadlineAt,
      fullName: v?.fullName ?? null,
      idNumber: v?.idNumber ?? null,
      selfieReceived: !!v?.selfieUrl,
      idDocumentReceived: !!v?.idPhotoFrontUrl,
      selfieVideoReceived: !!v?.selfieVideoUrl,
      notes: v?.notes ?? null,
      createdAt: v?.createdAt ?? null,
      reviewedAt: v?.reviewedAt ?? null,
      paymentMethod: v?.paymentMethod ?? null,
      // Bloque 150: cuántos meses eligió pagar (1..24) y el monto esperado
      // (calculado, ver arriba) en la moneda que corresponda al método.
      paymentMonths: v?.paymentMonths ?? null,
      paymentCurrency: v?.paymentCurrency ?? null,
      expectedAmount,
      // Bloque 25: Checkout Session real de Stripe — expiresAt para que el
      // frontend sepa si el link todavía sirve o hay que ofrecer uno nuevo
      // (Stripe los vence solo, típicamente a las 24h).
      stripeCheckoutUrl: v?.stripeCheckoutUrl ?? null,
      stripeCheckoutExpired: v?.stripeCheckoutExpiresAt ? v.stripeCheckoutExpiresAt < new Date() : false,
      // Bloque 150: Stripe ya confirmó el cobro (webhook) — falta que el
      // vendedor suba su comprobante para que un admin finalice.
      stripePaidAt: v?.stripePaidAt ?? null,
      paymentProofReceived: !!v?.paymentProofUrl,
      paymentProofUnavailable: v?.paymentProofUnavailable ?? false,
      paymentClaimedAt: v?.paymentClaimedAt ?? null,
      paymentConfirmedAt: v?.paymentConfirmedAt ?? null,
    },
  });
}

// Bloque 66 (pedido explícito): además de las fotos, el trámite ahora exige
// desde el ARRANQUE los datos legales de la tienda — nunca se piden después,
// junto con documentos en el mismo envío. companyTaxId se queda opcional a
// propósito — es el ID fiscal de la EMPRESA, un dato distinto de idNumber
// (el de la persona responsable, ver abajo), no una alternativa a él.
// Bloque 153 (pedido explícito, bug real reportado en vivo — "este campo de
// responsable del negocio está vacío, eso no puede pasar, esos son campos
// obligatorios a llenar antes de verificar la tienda"): `fullName` pasa de
// opcional a obligatorio — es el nombre real, confirmado por cámara en el
// mismo envío, de la persona responsable. Nunca puede quedar una tienda
// VERIFIED sin saber quién es su responsable.
// Bloque 165 (pedido explícito, bug real reportado en vivo — con captura:
// una tienda VERIFIED con "Identificación del responsable" y "Dirección de
// la empresa" vacíos y BLOQUEADOS para siempre, porque nunca se los pedía
// acá y el candado de identidad post-verificación después no dejaba
// completarlos): `idNumber` pasa de opcional a obligatorio (antes se podía
// evitar el envío por completo con solo cargar companyTaxId, dejando
// Vendor.ownerIdNumber sin sincronizar ni una vez, ver más abajo) y se suma
// `companyAddress`, que directamente NUNCA se pedía en ningún lado del
// trámite.
const submitSchema = z.object({
  fullName: z.string().trim().min(2, "Escribe el nombre completo del responsable."),
  idNumber: z.string().trim().min(4, "Escribe el número de identificación del responsable."),
  idDocumentType: z.enum(["NATIONAL_ID", "PASSPORT", "INTERNATIONAL_ID"]),
  companyTaxId: z.string().trim().min(1).optional(),
  companyAddress: z.string().trim().min(1, "Escribe la dirección de la empresa."),
  registrationCountryId: z.string().min(1, "Elige el país de registro legal de tu negocio."),
  legalProvinceId: z.string().min(1, "Elige la provincia de registro legal."),
  legalMunicipalityId: z.string().trim().min(1).optional(),
});

// Mínimo para considerar que la descripción pública de la tienda ya cuenta
// "qué hace el negocio" de verdad, no un par de palabras sueltas.
const MIN_DESCRIPTION_LENGTH = 30;

// Captura solo por cámara (Bloque 10): el frontend nunca ofrece selector de
// archivo, así que llegar acá con ambos archivos significa que son fotos
// recién tomadas en vivo. Bloque 16: ya no hay aprobación automática — todo
// envío válido cae en PENDING_REVIEW para que un admin lo revise a mano. Solo
// se puede enviar si todavía no hay nada en curso (REGULAR) o si el envío
// anterior fue RECHAZADO — con documentos en revisión o en fase de pago, no
// se puede reenviar hasta que el admin resuelva.
export async function submitVerification(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true, user: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  if (vendor.verificationStatus !== "NOT_STARTED" && vendor.verificationStatus !== "REJECTED") {
    const { siteName } = await getBrandSettings();
    throw new AppError(`Ya tienes una solicitud en curso — espera la resolución del equipo de ${siteName}.`, 409);
  }

  const data = submitSchema.parse(req.body);
  const selfieFile = req.files?.selfie?.[0];
  const idFile = req.files?.idDocument?.[0];
  // Bloque 146: opcional a propósito — el navegador puede no soportar
  // detección de rostro/MediaRecorder (Safari/Firefox viejos), en cuyo caso
  // CameraCapture.jsx nunca graba nada y este campo simplemente no llega.
  // Nunca bloquea el envío por faltar, a diferencia de selfie/idDocument.
  const selfieVideoFile = req.files?.selfieVideo?.[0];
  if (!selfieFile || !idFile) {
    throw new AppError("Necesitas capturar la selfie y el documento con la cámara antes de enviar.", 400);
  }

  const [selfieCheck, idCheck] = await Promise.all([validateKycImage(selfieFile.filename), validateKycImage(idFile.filename)]);
  if (!selfieCheck.ok || !idCheck.ok) {
    const reasons = [!selfieCheck.ok && `selfie (${selfieCheck.reason})`, !idCheck.ok && `documento (${idCheck.reason})`].filter(Boolean).join("; ");
    throw new AppError(`No se pudo procesar la captura: ${reasons}. Vuelve a intentarlo.`, 400);
  }

  // Bloque 165: el gate de "companyTaxId o ownerIdNumber, alcanza con uno"
  // desaparece — idNumber ya es obligatorio en submitSchema (zod ya lo
  // exigió arriba, con parse()), así que Vendor.ownerIdNumber siempre va a
  // quedar sincronizado desde ESTE envío (ver el update de abajo). Ya no
  // hace falta ningún chequeo en tiempo de ejecución acá.
  if (!vendor.description || vendor.description.trim().length < MIN_DESCRIPTION_LENGTH) {
    throw new AppError(
      `Completa la descripción de tu tienda (mínimo ${MIN_DESCRIPTION_LENGTH} caracteres) antes de verificarte — puedes editarla en Configuración.`,
      400
    );
  }

  await prisma.vendor.update({
    where: { id: vendor.id },
    data: {
      ...(data.companyTaxId ? { companyTaxId: data.companyTaxId } : {}),
      registrationCountryId: data.registrationCountryId,
      legalProvinceId: data.legalProvinceId,
      legalMunicipalityId: data.legalMunicipalityId || null,
      // Bloque 153 (pedido explícito — "el responsable debe ser la misma
      // persona a la que está registrada la cuenta"): se sincroniza SIEMPRE
      // desde el nombre confirmado por cámara en este mismo envío — la
      // fuente más confiable que hay, nunca lo que haya quedado (o no)
      // cargado antes a mano en el perfil.
      ownerName: data.fullName,
      // Bloque 165 (bug real corregido — antes idNumber quedaba SOLO en
      // VerificationRequest, nunca sincronizado acá): mismo criterio que
      // ownerName arriba, la fuente más confiable es este mismo envío.
      ownerIdNumber: data.idNumber,
      companyAddress: data.companyAddress,
    },
  });

  const update = {
    reviewedAt: null,
    reviewedById: null,
    idDocumentType: data.idDocumentType,
    selfieUrl: selfieFile.filename,
    idPhotoFrontUrl: idFile.filename,
    selfieVideoUrl: selfieVideoFile?.filename ?? null,
    notes: null,
    // Reinicia cualquier rastro de un ciclo de pago anterior (relevante si
    // este envío viene de un RECHAZADO — un rechazo de documentos siempre
    // ocurre antes de llegar a elegir método de pago, pero por las dudas).
    paymentMethod: null,
    stripeCheckoutSessionId: null,
    stripeCheckoutUrl: null,
    stripeCheckoutExpiresAt: null,
    paymentProofUrl: null,
    paymentClaimedAt: null,
    paymentConfirmedAt: null,
    paymentConfirmedById: null,
    // Bloque 150: mismo criterio — un reenvío (tras un rechazo) arranca un
    // ciclo de pago 100% nuevo, ningún rastro del anterior sobrevive.
    paymentMonths: null,
    paymentAmount: null,
    paymentCurrency: null,
    payerName: null,
    payerAccountNumber: null,
    payerPhone: null,
    payerAddress: null,
    payerCountry: null,
    payerCardLast4: null,
    paymentProofUnavailable: false,
    stripePaidAt: null,
    stripePaymentIntentId: null,
    archiveId: null,
    // Bloque 153/165: ya no son condicionales — el schema los exige siempre.
    fullName: data.fullName,
    idNumber: data.idNumber,
  };

  await prisma.verificationRequest.upsert({
    where: { vendorId: vendor.id },
    update,
    create: { vendorId: vendor.id, ...update },
  });
  // Sin `notify` — el propio submit ya es la confirmación que ve el
  // vendedor en su panel, avisarle por correo/campanita de algo que él mismo
  // acaba de hacer no aporta nada (mismo criterio que antes de este bloque).
  await transitionVendorVerification(vendor.id, "PENDING_DOCS", { source: "VENDOR_ACTION" });

  // Bloque 150 (pedido explícito — "debe quedar archivado todo el historial
  // desde que el cliente envía la solicitud"): arranca la rama de archivo de
  // ESTE ciclo ahora mismo, no recién si llega a VERIFIED — ver
  // vendorVerification.service.js.
  await archiveVerificationSubmission(vendor.id).catch(() => {});

  // Bloque 66 (pedido explícito): a diferencia del aviso al VENDEDOR de
  // arriba (que no aporta nada), acá sí hace falta avisar al ADMIN — es
  // quien tiene que actuar, y antes no se enteraba hasta entrar al panel.
  await notifyAdminActionNeeded(
    "Nueva verificación pendiente de revisión",
    `${vendor.companyName} envió sus documentos de verificación — revísalos en el panel de administración.`,
    vendor.id
  );
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "verification_submitted",
    description: `Envió documentos de verificación`,
  });

  res.status(201).json({
    verification: { verificationStatus: "PENDING_DOCS", selfieReceived: true, idDocumentReceived: true },
  });
}

// Bloque 150 (pedido explícito): "el cliente podrá seleccionar cuántos
// meses desea pagar, mínimo 1, máximo 24" — se elige en el MISMO paso que el
// método (nunca hace falta un tercer paso aparte).
const paymentMethodSchema = z.object({
  method: z.enum(["CARD", "CUP_TRANSFER"]),
  months: z.number().int().min(MIN_PAYMENT_MONTHS).max(MAX_PAYMENT_MONTHS),
});

// Bloque 150 (pedido explícito — "utilizaremos Stripe para generar el pago
// correspondiente al monto con la cantidad de meses... automáticamente se
// va a sumar el monto de cada mes"): pasa de `mode:"subscription"` (cobro
// recurrente automático, activaba solo) a `mode:"payment"` (cobro ÚNICO por
// el bloque completo de N meses) — el monto ya es precio mensual × meses,
// Stripe no vuelve a cobrar solo cuando ese bloque se termina; renovar es
// elegir método de pago de nuevo (mismo flujo que ya existe para CUP). Se
// reusa tanto desde chooseMyPaymentMethod (primera vez que elige CARD) como
// desde retryMyStripeCheckout (el link anterior venció o el vendedor
// abandonó el pago) — cada llamada genera una sesión NUEVA.
async function createAndSaveCheckoutSession(vendor, verification, amountUsd) {
  const session = await createVerificationCheckoutSession({ verification, vendor, amountUsd, months: verification.paymentMonths });
  const updated = await prisma.verificationRequest.update({
    where: { id: verification.id },
    data: {
      stripeCheckoutSessionId: session.sessionId,
      stripeCheckoutUrl: session.url,
      stripeCheckoutExpiresAt: session.expiresAt,
    },
  });
  await notifyVerificationEvent(vendor, "VERIFICATION_PAYMENT_LINK_SENT", { ctaHref: session.url });
  return updated;
}

// El vendedor elige cómo va a pagar la suscripción Y cuántos meses de una —
// se le pide como parte del mismo trámite. CARD dispara el Checkout Session
// de Stripe en el momento (pago único por el total de los meses elegidos);
// CUP_TRANSFER muestra el monto a transferir (precio × meses). En LOS DOS
// casos, después de pagar, el vendedor tiene que subir su comprobante (o
// marcar que no pudo) para que un admin finalice — ver uploadMyPaymentProof.
export async function chooseMyPaymentMethod(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true, user: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  // Bloque 64: además de la fase inicial, SUSPENDED también puede volver a
  // elegir método de pago — su suscripción anterior ya no está vigente (o
  // venció su ciclo sin recuperarse), pero sus documentos ya aprobados
  // siguen valiendo, así que arranca un ciclo de pago nuevo sin rehacerlos.
  if (!["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"].includes(vendor.verificationStatus)) {
    throw new AppError("Todavía no llegaste a la fase de cobro de la suscripción.", 409);
  }

  const { method, months } = paymentMethodSchema.parse(req.body);
  const pricing = await getSubscriptionPricing();
  const paymentCurrency = method === "CARD" ? "USD" : "CUP";

  // Arrancar un ciclo nuevo (típicamente tras SUSPENDED/PAYMENT_FAILED)
  // limpia el rastro de confirmación del ciclo ANTERIOR — si no, el chequeo
  // de idempotencia del webhook (handleCheckoutCompleted) vería
  // stripePaidAt/paymentConfirmedAt ya seteados de la vez pasada.
  let verification = await prisma.verificationRequest.update({
    where: { vendorId: vendor.id },
    data: {
      paymentMethod: method,
      paymentMonths: months,
      paymentCurrency,
      paymentClaimedAt: null,
      paymentConfirmedAt: null,
      paymentConfirmedById: null,
      paymentProofUrl: null,
      paymentProofUnavailable: false,
      stripePaidAt: null,
      stripePaymentIntentId: null,
      payerName: null,
      payerAccountNumber: null,
      payerPhone: null,
      payerAddress: null,
      payerCountry: null,
      payerCardLast4: null,
    },
  });
  await syncVerificationArchive(vendor.id, { paymentMethod: method, paymentMonths: months, paymentCurrency });

  // Elegir método de pago ES el gesto que reinicia el ciclo — vuelve a
  // PENDING_PAYMENT de una (el resto del frontend/flujo ya sabe qué hacer
  // desde ahí), así el vendedor no queda en SUSPENDED/PAYMENT_FAILED
  // mostrando el mismo selector para siempre.
  if (vendor.verificationStatus !== "PENDING_PAYMENT") {
    await transitionVendorVerification(vendor.id, "PENDING_PAYMENT", { actorId: req.user.id, source: "VENDOR_ACTION" });
  }

  if (method === "CARD") {
    const amountUsd = pricing.cardPricePerMonthUsd * months;
    verification = await createAndSaveCheckoutSession(vendor, verification, amountUsd);
  }

  res.json({
    verification: {
      paymentMethod: verification.paymentMethod,
      paymentMonths: verification.paymentMonths,
      paymentCurrency: verification.paymentCurrency,
      expectedAmount: method === "CARD" ? pricing.cardPricePerMonthUsd * months : pricing.cupPricePerMonth * months,
      stripeCheckoutUrl: verification.stripeCheckoutUrl,
      stripeCheckoutExpired: verification.stripeCheckoutExpiresAt ? verification.stripeCheckoutExpiresAt < new Date() : false,
    },
  });
}

// Bloque 25: "reintentar" — el vendedor ya había elegido CARD (link vencido
// o pago abandonado en Stripe) y quiere un link nuevo, sin tener que volver
// a elegir el método de pago (ni los meses) desde cero.
export async function retryMyStripeCheckout(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true, user: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const v = vendor.verification;
  if (!["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"].includes(vendor.verificationStatus) || v?.paymentMethod !== "CARD" || !v?.paymentMonths) {
    throw new AppError("Elige tarjeta como método de pago antes de generar un link de Stripe.", 409);
  }

  const pricing = await getSubscriptionPricing();
  const verification = await createAndSaveCheckoutSession(vendor, v, pricing.cardPricePerMonthUsd * v.paymentMonths);
  res.json({
    verification: {
      stripeCheckoutUrl: verification.stripeCheckoutUrl,
      stripeCheckoutExpired: false,
    },
  });
}

// Bloque 150 (pedido explícito, reescribe el punto único de "Ya pagué" de
// antes): ahora cubre CARD Y CUP_TRANSFER por igual — "para ambas cosas,
// tanto en pago en moneda nacional como Visa/Mastercard, el cliente siempre
// deberá subir una captura de pantalla del pago... y el monto pagado".
// Datos exigidos según el método:
//  - CUP_TRANSFER: payerName + payerAccountNumber + payerPhone (siempre).
//  - CARD: payerName (siempre; tiene que coincidir con el titular de la
//    tarjeta — se lo aclara el frontend, no se valida acá). NUNCA se pide
//    el número completo de la tarjeta (fuera de alcance de este sistema,
//    no está certificado PCI — Stripe ya lo tiene). Si el vendedor no pudo
//    hacer la captura (`proofUnavailable:true`, sin archivo), se piden datos
//    de respaldo para que el admin pueda conciliar: payerPhone, payerAddress,
//    payerCountry, payerCardLast4 (opcional, solo los últimos 4 dígitos).
// Bloque 153 (pedido explícito — "el monto pagado no se puede editar ya que
// es un valor que ya se calculó por los meses que eligió el cliente...
// quiero que esas cuentas sean bien estrictas"): `paymentAmount` DEJA de
// venir del cliente — antes era un número que el vendedor tipeaba a mano
// (aunque prellenado), lo que técnicamente permitía declarar cualquier
// monto. Ahora se calcula siempre server-side (precio vigente × meses
// elegidos, ver getSubscriptionPricing) en el momento del reclamo — el
// mismo criterio "estricto" que ya regía para el monto ESPERADO que ve el
// admin, ahora también para el monto que queda archivado como "lo pagado".
// FormData manda todo como string — z.coerce.boolean() volvería "false"
// también en `true` (mismo problema ya documentado en
// announcements.controller.js), por eso el preprocess explícito.
const boolish = z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean());

const claimPaymentSchema = z.object({
  payerName: z.string().trim().min(2, "Escribe el nombre y apellidos de quien pagó."),
  payerAccountNumber: z.string().trim().optional(),
  payerPhone: z.string().trim().optional(),
  payerAddress: z.string().trim().optional(),
  payerCountry: z.string().trim().optional(),
  payerCardLast4: z
    .string()
    .trim()
    .regex(/^\d{4}$/, "Los últimos 4 dígitos de la tarjeta.")
    .optional()
    .or(z.literal("")),
  proofUnavailable: boolish.optional().default(false),
});

export async function uploadMyPaymentProof(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true, user: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const v = vendor.verification;
  // Bloque 64: además de la fase inicial (PENDING_PAYMENT), acepta también
  // PAYMENT_FAILED (ciclo vencido, ver verificationPayment.job.js) y
  // SUSPENDED (revocado a mano por un admin) — en los 3 casos renueva
  // reclamando el pago de nuevo, sin rehacer los documentos ya aprobados.
  const canUploadProof = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"].includes(vendor.verificationStatus);
  if (!canUploadProof || !v?.paymentMethod) {
    throw new AppError("Elige un método de pago antes de reclamar el pago.", 409);
  }

  const data = claimPaymentSchema.parse(req.body);
  const isCup = v.paymentMethod === "CUP_TRANSFER";
  if (isCup && (!data.payerAccountNumber?.trim() || !data.payerPhone?.trim())) {
    throw new AppError("Indica el número de cuenta y el teléfono con el que realizaste la transferencia.", 400);
  }
  const hasProofFile = !!req.file;
  if (!isCup && !hasProofFile && !data.proofUnavailable) {
    throw new AppError("Sube la captura del pago, o marca que no pudiste hacerla.", 400);
  }
  // Bloque 150 (pedido explícito): sin captura, hacen falta datos de
  // respaldo para que el admin pueda conciliar el pago igual.
  if (!isCup && !hasProofFile && data.proofUnavailable && (!data.payerPhone?.trim() || !data.payerAddress?.trim() || !data.payerCountry?.trim())) {
    throw new AppError("Sin captura, indica al menos tu teléfono, dirección y país para poder conciliar el pago.", 400);
  }

  // Bloque 153: monto estricto, calculado acá — nunca lo que mande el
  // cliente (ver comentario de claimPaymentSchema arriba).
  const pricing = await getSubscriptionPricing();
  const pricePerMonth = v.paymentCurrency === "USD" ? pricing.cardPricePerMonthUsd : pricing.cupPricePerMonth;
  const strictAmount = pricePerMonth * (v.paymentMonths ?? 1);

  const patch = {
    payerName: data.payerName,
    paymentAmount: strictAmount,
    payerAccountNumber: data.payerAccountNumber?.trim() || null,
    payerPhone: data.payerPhone?.trim() || null,
    payerAddress: data.payerAddress?.trim() || null,
    payerCountry: data.payerCountry?.trim() || null,
    payerCardLast4: data.payerCardLast4?.trim() || null,
    paymentProofUnavailable: !hasProofFile && !!data.proofUnavailable,
    ...(hasProofFile ? { paymentProofUrl: req.file.filename } : {}),
    paymentClaimedAt: new Date(),
  };
  const verification = await prisma.verificationRequest.update({ where: { vendorId: vendor.id }, data: patch });
  await syncVerificationArchive(vendor.id, patch);

  const methodLabel = isCup ? "transferencia CUP" : "pago con tarjeta";
  await notifyAdminActionNeeded(
    `Pago reclamado (${methodLabel}) — esperando confirmación`,
    `${vendor.companyName} marcó "Ya pagué" su ${methodLabel} (${strictAmount} ${v.paymentCurrency ?? ""})${
      hasProofFile ? " y adjuntó una captura" : " — sin captura, con datos de respaldo"
    } — confírmalo en el panel de administración.`,
    vendor.id
  );
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "payment_claimed",
    description: `Reclamó el pago (${methodLabel}, ${strictAmount} ${v.paymentCurrency ?? ""})`,
  });

  res.status(201).json({
    verification: { paymentProofReceived: !!verification.paymentProofUrl, paymentClaimedAt: verification.paymentClaimedAt },
  });
}

// --- Suscripción — renovación mientras la tienda YA está VERIFIED --------
// Bloque 153 (pedido explícito — "una vez el cliente esté verificado, en la
// sección de suscripción podrá ver cuántos días vence la suscripción del
// mes actual, la fecha de inicio y fecha de fin, y podrá activar un nuevo
// mes o varios... el proceso será casi igual... se guardará todo ese
// historial"): a diferencia del ciclo inicial (VerificationRequest, que se
// REUTILIZA — un solo registro que se pisa en cada envío), cada renovación
// es una fila propia e inmutable de `SubscriptionPayment` — mismo
// método/meses/comprobante/reclamo/confirmación que el ciclo inicial, pero
// con historial real (nunca se pisa la anterior).

// Estado de la suscripción vigente — período actual, cuánto falta, y la
// renovación en curso (si hay alguna sin confirmar todavía) + el historial
// de las ya confirmadas. `null` si la tienda no está VERIFIED (no aplica).
export async function getMySubscription(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  if (vendor.verificationStatus !== "VERIFIED") return res.json({ subscription: null });

  const [lastConfirmed, pending, history] = await Promise.all([
    prisma.subscriptionPayment.findFirst({ where: { vendorId: vendor.id, confirmedAt: { not: null } }, orderBy: { confirmedAt: "desc" } }),
    prisma.subscriptionPayment.findFirst({ where: { vendorId: vendor.id, confirmedAt: null }, orderBy: { createdAt: "desc" } }),
    prisma.subscriptionPayment.findMany({ where: { vendorId: vendor.id, confirmedAt: { not: null } }, orderBy: { confirmedAt: "desc" } }),
  ]);

  // El inicio del ciclo VIGENTE: la renovación confirmada más reciente, o
  // si nunca hubo ninguna, el pago inicial que llevó a VERIFIED (siempre
  // real — VerificationStatusLog/VerificationRequest ya lo prueban).
  const periodStart = lastConfirmed?.periodStart ?? vendor.verification?.paymentConfirmedAt ?? null;
  const periodEnd = vendor.nextPaymentDueDate;
  const daysRemaining = periodEnd ? Math.ceil((periodEnd.getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null;

  let pendingRenewal = null;
  if (pending) {
    const pricing = await getSubscriptionPricing();
    const pricePerMonth = pending.paymentMethod === "CARD" ? pricing.cardPricePerMonthUsd : pricing.cupPricePerMonth;
    pendingRenewal = {
      id: pending.id,
      paymentMethod: pending.paymentMethod,
      months: pending.months,
      currency: pending.currency,
      expectedAmount: pricePerMonth * pending.months,
      stripeCheckoutUrl: pending.stripeCheckoutUrl,
      stripeCheckoutExpired: pending.stripeCheckoutExpiresAt ? pending.stripeCheckoutExpiresAt < new Date() : false,
      stripePaidAt: pending.stripePaidAt,
      paymentProofReceived: !!pending.proofUrl,
      paymentProofUnavailable: pending.proofUnavailable,
      paymentClaimedAt: pending.claimedAt,
    };
  }

  res.json({
    subscription: {
      periodStart,
      periodEnd,
      daysRemaining,
      pendingRenewal,
      history: history.map((h) => ({
        id: h.id,
        paymentMethod: h.paymentMethod,
        months: h.months,
        amount: h.amount,
        currency: h.currency,
        periodStart: h.periodStart,
        periodEnd: h.periodEnd,
        claimedAt: h.claimedAt,
        confirmedAt: h.confirmedAt,
      })),
    },
  });
}

const renewalMethodSchema = z.object({
  method: z.enum(["CARD", "CUP_TRANSFER"]),
  months: z.number().int().min(MIN_PAYMENT_MONTHS).max(MAX_PAYMENT_MONTHS),
});

// Elegir método+meses para una renovación — si ya había una sin confirmar,
// la reemplaza (mismo criterio de "elegir de nuevo limpia lo anterior" que
// ya usa chooseMyPaymentMethod para el ciclo inicial).
export async function chooseMyRenewalPayment(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  if (vendor.verificationStatus !== "VERIFIED") {
    throw new AppError("Solo puedes renovar mientras tu tienda está verificada.", 409);
  }

  const { method, months } = renewalMethodSchema.parse(req.body);
  const pricing = await getSubscriptionPricing();
  const currency = method === "CARD" ? "USD" : "CUP";

  const existingPending = await prisma.subscriptionPayment.findFirst({
    where: { vendorId: vendor.id, confirmedAt: null },
    orderBy: { createdAt: "desc" },
  });
  if (existingPending) await prisma.subscriptionPayment.delete({ where: { id: existingPending.id } });

  let payment = await prisma.subscriptionPayment.create({
    data: { vendorId: vendor.id, paymentMethod: method, months, currency },
  });

  if (method === "CARD") {
    const amountUsd = pricing.cardPricePerMonthUsd * months;
    const session = await createRenewalCheckoutSession({ subscriptionPayment: payment, vendor, months, amountUsd });
    payment = await prisma.subscriptionPayment.update({
      where: { id: payment.id },
      data: { stripeCheckoutSessionId: session.sessionId, stripeCheckoutUrl: session.url, stripeCheckoutExpiresAt: session.expiresAt },
    });
  }

  res.json({
    subscriptionPayment: {
      id: payment.id,
      paymentMethod: payment.paymentMethod,
      months: payment.months,
      currency: payment.currency,
      expectedAmount: (method === "CARD" ? pricing.cardPricePerMonthUsd : pricing.cupPricePerMonth) * months,
      stripeCheckoutUrl: payment.stripeCheckoutUrl,
      stripeCheckoutExpired: false,
    },
  });
}

export async function retryRenewalStripeCheckout(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const payment = await prisma.subscriptionPayment.findFirst({
    where: { vendorId: vendor.id, confirmedAt: null, paymentMethod: "CARD" },
    orderBy: { createdAt: "desc" },
  });
  if (!payment) throw new AppError("Elige tarjeta como método de pago antes de generar un link de Stripe.", 409);

  const pricing = await getSubscriptionPricing();
  const session = await createRenewalCheckoutSession({
    subscriptionPayment: payment,
    vendor,
    months: payment.months,
    amountUsd: pricing.cardPricePerMonthUsd * payment.months,
  });
  const updated = await prisma.subscriptionPayment.update({
    where: { id: payment.id },
    data: { stripeCheckoutSessionId: session.sessionId, stripeCheckoutUrl: session.url, stripeCheckoutExpiresAt: session.expiresAt },
  });
  res.json({ subscriptionPayment: { stripeCheckoutUrl: updated.stripeCheckoutUrl, stripeCheckoutExpired: false } });
}

// "Ya pagué" para una renovación — mismas reglas/campos que
// uploadMyPaymentProof (ver ese comentario para el detalle completo), acá
// aplicadas sobre la fila SubscriptionPayment pendiente en vez de
// VerificationRequest.
export async function claimRenewalPayment(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  if (vendor.verificationStatus !== "VERIFIED") throw new AppError("Solo puedes reclamar una renovación mientras tu tienda está verificada.", 409);

  const pending = await prisma.subscriptionPayment.findFirst({ where: { vendorId: vendor.id, confirmedAt: null }, orderBy: { createdAt: "desc" } });
  if (!pending) throw new AppError("Elige un método de pago antes de reclamar la renovación.", 409);

  const data = claimPaymentSchema.parse(req.body);
  const isCup = pending.paymentMethod === "CUP_TRANSFER";
  if (isCup && (!data.payerAccountNumber?.trim() || !data.payerPhone?.trim())) {
    throw new AppError("Indica el número de cuenta y el teléfono con el que realizaste la transferencia.", 400);
  }
  const hasProofFile = !!req.file;
  if (!isCup && !hasProofFile && !data.proofUnavailable) {
    throw new AppError("Sube la captura del pago, o marca que no pudiste hacerla.", 400);
  }
  if (!isCup && !hasProofFile && data.proofUnavailable && (!data.payerPhone?.trim() || !data.payerAddress?.trim() || !data.payerCountry?.trim())) {
    throw new AppError("Sin captura, indica al menos tu teléfono, dirección y país para poder conciliar el pago.", 400);
  }

  const pricing = await getSubscriptionPricing();
  const pricePerMonth = pending.paymentMethod === "CARD" ? pricing.cardPricePerMonthUsd : pricing.cupPricePerMonth;
  const strictAmount = pricePerMonth * pending.months;

  const updated = await prisma.subscriptionPayment.update({
    where: { id: pending.id },
    data: {
      payerName: data.payerName,
      amount: strictAmount,
      payerAccountNumber: data.payerAccountNumber?.trim() || null,
      payerPhone: data.payerPhone?.trim() || null,
      payerAddress: data.payerAddress?.trim() || null,
      payerCountry: data.payerCountry?.trim() || null,
      payerCardLast4: data.payerCardLast4?.trim() || null,
      proofUnavailable: !hasProofFile && !!data.proofUnavailable,
      ...(hasProofFile ? { proofUrl: req.file.filename } : {}),
      claimedAt: new Date(),
    },
  });

  const methodLabel = isCup ? "transferencia CUP" : "pago con tarjeta";
  await notifyAdminActionNeeded(
    `Renovación reclamada (${methodLabel}) — esperando confirmación`,
    `${vendor.companyName} marcó "Ya pagué" la renovación de su suscripción (${pending.months} ${pending.months === 1 ? "mes" : "meses"}, ${strictAmount} ${pending.currency})${
      hasProofFile ? " y adjuntó una captura" : " — sin captura, con datos de respaldo"
    } — confírmalo en el panel de administración.`,
    vendor.id
  );
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "subscription_renewal_claimed",
    description: `Reclamó la renovación (${methodLabel}, ${pending.months} ${pending.months === 1 ? "mes" : "meses"}, ${strictAmount} ${pending.currency})`,
  });

  res.status(201).json({
    subscriptionPayment: { paymentProofReceived: !!updated.proofUrl, paymentClaimedAt: updated.claimedAt },
  });
}

// Sirve el archivo privado solo al dueño de la tienda o a un admin — nunca
// como URL pública/estática. "proof" (Bloque 16) usa el mismo mecanismo que
// selfie/id — no es un documento de identidad, pero tampoco es información
// que deba quedar pública en un path adivinable.
export async function getVerificationFile(req, res) {
  const { vendorId, type } = req.params;

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, include: { verification: true } });
  if (!vendor || !vendor.verification) throw new AppError("No encontrado.", 404);

  const isOwner = vendor.userId === req.user.id;
  const isAdmin = req.user.role === "ADMIN";
  if (!isOwner && !isAdmin) throw new AppError("No tienes permiso para ver este documento.", 403);

  // Bloque 146: "video" sumado a la cadena — el video corto de liveness,
  // mismo criterio de ownership/serving que el resto.
  const filename =
    type === "selfie"
      ? vendor.verification.selfieUrl
      : type === "proof"
        ? vendor.verification.paymentProofUrl
        : type === "video"
          ? vendor.verification.selfieVideoUrl
          : vendor.verification.idPhotoFrontUrl;
  if (!filename) throw new AppError("Documento no encontrado.", 404);

  // Encontrado durante verificación en vivo del Bloque 49 (VendorProfile.jsx
  // pasó a ser el segundo consumidor de este endpoint, no solo
  // AdminVerifications.jsx): algunas tiendas sembradas tienen filenames de
  // placeholder en la DB (ej. "seed-placeholder-selfie.jpg") que nunca
  // existieron de verdad en disco — sin este catch, ENOENT quedaba sin
  // capturar y Express lo convertía en un 500 genérico en vez de un 404 con
  // mensaje claro (que el frontend (PrivateDocument.jsx) ya maneja bien).
  let buffer;
  try {
    buffer = await readFile(join(KYC_UPLOAD_DIR, filename));
  } catch {
    throw new AppError("Documento no encontrado.", 404);
  }
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType =
    { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", webm: "video/webm", mp4: "video/mp4" }[ext] ??
    "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
}

// Bloque 153: mismo mecanismo que getVerificationFile pero para el
// comprobante de una renovación (SubscriptionPayment, no
// VerificationRequest) — dueño de la tienda o admin, nunca URL pública.
export async function getSubscriptionPaymentFile(req, res) {
  const { id } = req.params;
  const payment = await prisma.subscriptionPayment.findUnique({ where: { id }, include: { vendor: true } });
  if (!payment || !payment.proofUrl) throw new AppError("No encontrado.", 404);

  const isOwner = payment.vendor.userId === req.user.id;
  const isAdmin = req.user.role === "ADMIN";
  if (!isOwner && !isAdmin) throw new AppError("No tienes permiso para ver este documento.", 403);

  let buffer;
  try {
    buffer = await readFile(join(KYC_UPLOAD_DIR, payment.proofUrl));
  } catch {
    throw new AppError("Documento no encontrado.", 404);
  }
  const ext = payment.proofUrl.split(".").pop()?.toLowerCase();
  const contentType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" }[ext] ?? "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
}

// --- Webhooks de Stripe (Bloque 25, recurrente desde Bloque 64) ------------
// Bloque 150 (pedido explícito — "el administrador reciba correctamente el
// documento... y de allí el administrador pueda concluir y finalizar la
// aprobación"): checkout.session.completed YA NO activa la verificación
// solo — Stripe confirmando el cobro deja de ser el ÚNICO paso 100%
// automático que era desde el Bloque 25/64. Ahora deja una marca
// (stripePaidAt) y avisa al vendedor que falta subir su comprobante — el
// resto del ciclo (subir captura/datos, admin confirma) es EXACTAMENTE el
// mismo que ya usa CUP_TRANSFER (ver uploadMyPaymentProof/
// confirmSubscriptionPayment), así los 2 métodos terminan por el mismo
// camino. `invoice.payment_succeeded`/`payment_failed`/
// `customer.subscription.deleted` de abajo quedan SOLO para suscripciones
// de Stripe YA EXISTENTES de antes de este bloque (mode:"subscription") —
// los checkouts nuevos usan mode:"payment" (pago único por el bloque de
// meses elegido, ver lib/stripe.js) y nunca generan una Subscription real,
// así que esos 3 webhooks simplemente no encuentran ningún vendor para esos
// eventos y no hacen nada — comportamiento intacto para quien ya estaba
// pagando así, sin duplicar lógica para el camino nuevo.
async function handleCheckoutCompleted(session) {
  // Bloque 153: 2 caminos posibles según qué generó el checkout —
  // verificationId (ciclo inicial) o subscriptionPaymentId (renovación
  // mientras ya está VERIFIED, ver createRenewalCheckoutSession).
  if (session.metadata?.subscriptionPaymentId) return handleRenewalCheckoutCompleted(session);

  const verificationId = session.metadata?.verificationId;
  if (!verificationId) return;

  const verification = await prisma.verificationRequest.findUnique({ where: { id: verificationId }, include: { vendor: true } });
  if (!verification) return;

  // Idempotencia: Stripe puede reenviar el mismo evento más de una vez si no
  // recibe el 200 a tiempo — sin este chequeo, un reintento repetiría el
  // aviso de "recibimos tu pago" sin ninguna necesidad.
  if (verification.stripePaidAt) return;
  if (verification.paymentMethod !== "CARD" || !["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"].includes(verification.vendor.verificationStatus)) return;
  // Un evento de una sesión VIEJA (el vendedor generó un link nuevo después
  // de que este venciera) no debe activar nada — solo cuenta la sesión
  // vigente guardada en la solicitud.
  if (verification.stripeCheckoutSessionId !== session.id) return;

  await prisma.verificationRequest.update({
    where: { id: verification.id },
    data: { stripePaidAt: new Date(), stripePaymentIntentId: session.payment_intent ?? null },
  });
  await syncVerificationArchive(verification.vendorId, { stripePaidAt: new Date() });
  await notifyVerificationEvent(verification.vendor, "VERIFICATION_STRIPE_PAID");
}

// Bloque 153: misma idea que handleCheckoutCompleted de arriba, pero para
// una renovación (SubscriptionPayment) — deja `stripePaidAt` y avisa, un
// admin igual confirma a mano antes de extender `nextPaymentDueDate`.
async function handleRenewalCheckoutCompleted(session) {
  const paymentId = session.metadata.subscriptionPaymentId;
  const payment = await prisma.subscriptionPayment.findUnique({ where: { id: paymentId }, include: { vendor: true } });
  if (!payment) return;

  if (payment.stripePaidAt || payment.confirmedAt) return; // idempotencia
  if (payment.paymentMethod !== "CARD" || payment.vendor.verificationStatus !== "VERIFIED") return;
  if (payment.stripeCheckoutSessionId !== session.id) return; // sesión vieja

  await prisma.subscriptionPayment.update({
    where: { id: payment.id },
    data: { stripePaidAt: new Date(), stripePaymentIntentId: session.payment_intent ?? null },
  });
  await notifyVerificationEvent(payment.vendor, "VERIFICATION_STRIPE_PAID");
}

// Legado (Bloque 64) — solo dispara para suscripciones de Stripe reales
// creadas ANTES de este bloque (`mode:"subscription"`); los checkouts
// nuevos son pagos únicos, nunca generan `invoice.subscription`.
async function handleInvoicePaymentSucceeded(invoice) {
  if (!invoice.subscription) return;
  const vendor = await prisma.vendor.findFirst({ where: { stripeSubscriptionId: invoice.subscription } });
  if (!vendor) return; // checkout.session.completed todavía no procesó este ciclo — se recupera solo en la próxima factura.

  const nextPaymentDueDate = invoice.period_end ? new Date(invoice.period_end * 1000) : null;

  if (vendor.verificationStatus === "PAYMENT_FAILED") {
    await transitionVendorVerification(vendor.id, "VERIFIED", {
      source: "STRIPE_WEBHOOK",
      extraData: { nextPaymentDueDate },
      notify: { type: "VERIFICATION_VERIFIED" },
    });
  } else {
    // Renovación de rutina (ya estaba VERIFIED) — no es un cambio de estado,
    // solo se actualiza la fecha de vencimiento informativa.
    await prisma.vendor.update({ where: { id: vendor.id }, data: { nextPaymentDueDate } });
  }
}

async function handleInvoicePaymentFailed(invoice) {
  if (!invoice.subscription) return;
  const vendor = await prisma.vendor.findFirst({ where: { stripeSubscriptionId: invoice.subscription } });
  if (!vendor || vendor.verificationStatus === "PAYMENT_FAILED" || vendor.verificationStatus === "SUSPENDED") return;

  await transitionVendorVerification(vendor.id, "PAYMENT_FAILED", {
    source: "STRIPE_WEBHOOK",
    reason: "Stripe no pudo cobrar la factura de la suscripción.",
    notify: { type: "VERIFICATION_PAYMENT_FAILED" },
  });
}

// La suscripción de Stripe ya no existe (agotó reintentos, o se canceló
// directo) — distinto de PAYMENT_FAILED: acá no alcanza con pagar una
// factura vencida, hace falta una suscripción nueva desde cero.
async function handleSubscriptionDeleted(subscription) {
  const vendor = await prisma.vendor.findFirst({ where: { stripeSubscriptionId: subscription.id } });
  if (!vendor || vendor.verificationStatus === "SUSPENDED") return;

  await transitionVendorVerification(vendor.id, "SUSPENDED", {
    source: "STRIPE_WEBHOOK",
    reason: "La suscripción de Stripe se canceló.",
    // Bloque 66: este webhook dispara tanto por un fallo de cobro agotado
    // como por una cancelación diferida que el vendedor pidió a propósito
    // (cancel_at_period_end, ver updateMyVendor) — en los dos casos el ciclo
    // pago YA terminó de verdad, así que cancelAtPeriodEnd vuelve a false
    // para no arrastrar el flag a una futura suscripción nueva.
    extraData: { stripeSubscriptionId: null, cancelAtPeriodEnd: false },
    notify: { type: "VERIFICATION_SUSPENDED" },
  });
}

export async function handleStripeWebhookEvent(event) {
  const obj = event.data.object;
  if (event.type === "checkout.session.completed") return handleCheckoutCompleted(obj);
  if (event.type === "invoice.payment_succeeded") return handleInvoicePaymentSucceeded(obj);
  if (event.type === "invoice.payment_failed") return handleInvoicePaymentFailed(obj);
  if (event.type === "customer.subscription.deleted") return handleSubscriptionDeleted(obj);
}
