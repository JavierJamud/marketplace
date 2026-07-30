import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyVerificationEvent } from "../services/verificationNotify.service.js";
import { transitionVendorVerification } from "../services/vendorVerification.service.js";
import { createVerificationCheckoutSession } from "../lib/stripe.js";
import { getBrandSettings } from "./settings.controller.js";
// Bloque 69: extraído a un lib compartido — reviews.controller.js es el
// segundo consumidor real de este mismo "avisar al admin ya" (ver lib/adminNotify.js).
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { logActivity } from "../lib/activityLog.js";

// Bloque 64: el cobro recurrente dura 30 días — mismo criterio para Stripe
// (informativo, Stripe vence solo vía webhook) y CUP (lo enforcea de verdad
// verificationPayment.job.js).
const PAYMENT_CYCLE_DAYS = 30;

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
  res.json({
    verification: {
      verificationStatus: vendor.verificationStatus,
      nextPaymentDueDate: vendor.nextPaymentDueDate,
      fullName: v?.fullName ?? null,
      idNumber: v?.idNumber ?? null,
      selfieReceived: !!v?.selfieUrl,
      idDocumentReceived: !!v?.idPhotoFrontUrl,
      notes: v?.notes ?? null,
      createdAt: v?.createdAt ?? null,
      reviewedAt: v?.reviewedAt ?? null,
      paymentMethod: v?.paymentMethod ?? null,
      // Bloque 25: Checkout Session real de Stripe — expiresAt para que el
      // frontend sepa si el link todavía sirve o hay que ofrecer uno nuevo
      // (Stripe los vence solo, típicamente a las 24h).
      stripeCheckoutUrl: v?.stripeCheckoutUrl ?? null,
      stripeCheckoutExpired: v?.stripeCheckoutExpiresAt ? v.stripeCheckoutExpiresAt < new Date() : false,
      paymentProofReceived: !!v?.paymentProofUrl,
      paymentClaimedAt: v?.paymentClaimedAt ?? null,
      paymentConfirmedAt: v?.paymentConfirmedAt ?? null,
    },
  });
}

// Bloque 66 (pedido explícito): además de las fotos, el trámite ahora exige
// desde el ARRANQUE los datos legales de la tienda — nunca se piden después,
// junto con documentos en el mismo envío. companyTaxId es opcional en el
// schema porque el gate real (ver más abajo) acepta ownerIdNumber (ya
// existente en Vendor) como alternativa — alcanza con uno de los dos.
const submitSchema = z.object({
  fullName: z.string().min(2).optional(),
  idNumber: z.string().min(4).optional(),
  idDocumentType: z.enum(["NATIONAL_ID", "PASSPORT", "INTERNATIONAL_ID"]),
  companyTaxId: z.string().trim().min(1).optional(),
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
  if (!selfieFile || !idFile) {
    throw new AppError("Necesitas capturar la selfie y el documento con la cámara antes de enviar.", 400);
  }

  const [selfieCheck, idCheck] = await Promise.all([validateKycImage(selfieFile.filename), validateKycImage(idFile.filename)]);
  if (!selfieCheck.ok || !idCheck.ok) {
    const reasons = [!selfieCheck.ok && `selfie (${selfieCheck.reason})`, !idCheck.ok && `documento (${idCheck.reason})`].filter(Boolean).join("; ");
    throw new AppError(`No se pudo procesar la captura: ${reasons}. Vuelve a intentarlo.`, 400);
  }

  // Bloque 66 (pedido explícito): datos legales obligatorios DESDE el
  // arranque del trámite, junto con los documentos — nunca en una fase
  // posterior. companyTaxId acepta ownerIdNumber (ya cargado en Vendor,
  // KYC del responsable) como alternativa — alcanza con uno de los dos.
  if (!data.companyTaxId && !vendor.ownerIdNumber) {
    throw new AppError("Falta un ID fiscal de la empresa o el número de identificación del propietario.", 400);
  }
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
    },
  });

  const update = {
    reviewedAt: null,
    reviewedById: null,
    idDocumentType: data.idDocumentType,
    selfieUrl: selfieFile.filename,
    idPhotoFrontUrl: idFile.filename,
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
  };
  if (data.fullName) update.fullName = data.fullName;
  if (data.idNumber) update.idNumber = data.idNumber;

  await prisma.verificationRequest.upsert({
    where: { vendorId: vendor.id },
    update,
    create: { vendorId: vendor.id, ...update },
  });
  // Sin `notify` — el propio submit ya es la confirmación que ve el
  // vendedor en su panel, avisarle por correo/campanita de algo que él mismo
  // acaba de hacer no aporta nada (mismo criterio que antes de este bloque).
  await transitionVendorVerification(vendor.id, "PENDING_DOCS", { source: "VENDOR_ACTION" });

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
    actorRole: "VENDOR",
    vendorId: vendor.id,
    action: "verification_submitted",
    description: `Envió documentos de verificación`,
  });

  res.status(201).json({
    verification: { verificationStatus: "PENDING_DOCS", selfieReceived: true, idDocumentReceived: true },
  });
}

const paymentMethodSchema = z.object({ method: z.enum(["CARD", "CUP_TRANSFER"]) });

// Bloque 25: acá está el "el sistema lo hace solo apenas el vendedor elige
// esta opción" del bloque — arma un Checkout Session real de Stripe y lo
// guarda, sin ningún paso manual del admin en el medio. Se reusa tanto
// desde chooseMyPaymentMethod (primera vez que elige CARD) como desde
// retryMyStripeCheckout (el link anterior venció o el vendedor abandonó el
// pago) — cada llamada genera una sesión NUEVA, la vieja simplemente deja
// de usarse (Stripe la vence sola).
async function createAndSaveCheckoutSession(vendor, verification) {
  const session = await createVerificationCheckoutSession({ verification, vendor });
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

// El vendedor elige cómo va a pagar la suscripción — se le pide como parte
// del mismo trámite. CARD dispara el Checkout Session de Stripe en el
// momento; CUP_TRANSFER sigue siendo 100% manual (el vendedor sube
// comprobante, el admin confirma a mano — ver confirmCupPayment).
export async function chooseMyPaymentMethod(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true, user: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  // Bloque 64: además de la fase inicial, SUSPENDED también puede volver a
  // elegir método de pago — su suscripción de Stripe ya no existe (o venció
  // su ciclo CUP sin recuperarse), pero sus documentos ya aprobados siguen
  // valiendo, así que arranca un ciclo de pago nuevo sin rehacerlos.
  if (!["PENDING_PAYMENT", "SUSPENDED"].includes(vendor.verificationStatus)) {
    throw new AppError("Todavía no llegaste a la fase de cobro de la suscripción.", 409);
  }

  const { method } = paymentMethodSchema.parse(req.body);
  // Arrancar un ciclo nuevo (típicamente tras SUSPENDED) limpia el rastro de
  // confirmación del ciclo ANTERIOR — si no, el chequeo de idempotencia del
  // webhook (handleCheckoutCompleted) vería paymentConfirmedAt ya seteado de
  // la vez pasada y se saltearía la activación de este pago nuevo.
  let verification = await prisma.verificationRequest.update({
    where: { vendorId: vendor.id },
    data: { paymentMethod: method, paymentClaimedAt: null, paymentConfirmedAt: null, paymentConfirmedById: null },
  });

  // Elegir método de pago ES el gesto que reinicia el ciclo — vuelve a
  // PENDING_PAYMENT de una (el resto del frontend/flujo ya sabe qué hacer
  // desde ahí), así el vendedor no queda en SUSPENDED mostrando el mismo
  // selector para siempre.
  if (vendor.verificationStatus === "SUSPENDED") {
    await transitionVendorVerification(vendor.id, "PENDING_PAYMENT", { actorId: req.user.id, source: "VENDOR_ACTION" });
  }

  if (method === "CARD") verification = await createAndSaveCheckoutSession(vendor, verification);

  res.json({
    verification: {
      paymentMethod: verification.paymentMethod,
      stripeCheckoutUrl: verification.stripeCheckoutUrl,
      stripeCheckoutExpired: verification.stripeCheckoutExpiresAt ? verification.stripeCheckoutExpiresAt < new Date() : false,
    },
  });
}

// Bloque 25: "reintentar" — el vendedor ya había elegido CARD (link vencido
// o pago abandonado en Stripe) y quiere un link nuevo, sin tener que volver
// a elegir el método de pago desde cero.
export async function retryMyStripeCheckout(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true, user: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const v = vendor.verification;
  if (!["PENDING_PAYMENT", "SUSPENDED"].includes(vendor.verificationStatus) || v?.paymentMethod !== "CARD") {
    throw new AppError("Elige tarjeta como método de pago antes de generar un link de Stripe.", 409);
  }

  const verification = await createAndSaveCheckoutSession(vendor, v);
  res.json({
    verification: {
      stripeCheckoutUrl: verification.stripeCheckoutUrl,
      stripeCheckoutExpired: false,
    },
  });
}

// "Ya pagué" — reclamo de pago de transferencia CUP. Bloque 66 (pedido
// explícito, confirmado con el usuario): el comprobante queda OPCIONAL —
// nunca se exige un archivo para poder reclamar el pago, aunque adjuntar uno
// sigue ayudando al admin a confirmar más rápido (mismo mecanismo de subida
// que las fotos de KYC, reutilizado tal cual). paymentClaimedAt se setea
// SIEMPRE (con o sin archivo) — es lo que dispara el aviso al admin y lo que
// el panel de admin muestra como "esperando confirmación". La activación
// real la sigue haciendo un admin a mano (ver confirmCupPayment en
// admin.controller.js).
export async function uploadMyPaymentProof(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true, user: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const v = vendor.verification;
  // Bloque 64: además de la fase inicial (PENDING_PAYMENT), acepta también
  // PAYMENT_FAILED (ciclo CUP vencido, ver verificationPayment.job.js) y
  // SUSPENDED (revocado a mano por un admin) — en los 3 casos renueva
  // reclamando el pago de nuevo, sin rehacer los documentos ya aprobados.
  const canUploadProof = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED"].includes(vendor.verificationStatus);
  if (!canUploadProof || v?.paymentMethod !== "CUP_TRANSFER") {
    throw new AppError("Elige transferencia CUP como método de pago antes de reclamar el pago.", 409);
  }

  const verification = await prisma.verificationRequest.update({
    where: { vendorId: vendor.id },
    data: {
      ...(req.file ? { paymentProofUrl: req.file.filename } : {}),
      paymentClaimedAt: new Date(),
    },
  });

  await notifyAdminActionNeeded(
    "Pago CUP reclamado — esperando confirmación",
    `${vendor.companyName} marcó "Ya pagué" su transferencia CUP${req.file ? " y adjuntó un comprobante" : " (sin comprobante adjunto)"} — confírmalo en el panel de administración.`,
    vendor.id
  );
  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR",
    vendorId: vendor.id,
    action: "payment_claimed",
    description: `Reclamó el pago CUP ("Ya pagué")`,
  });

  res.status(201).json({
    verification: { paymentProofReceived: !!verification.paymentProofUrl, paymentClaimedAt: verification.paymentClaimedAt },
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

  const filename =
    type === "selfie" ? vendor.verification.selfieUrl : type === "proof" ? vendor.verification.paymentProofUrl : vendor.verification.idPhotoFrontUrl;
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
  const contentType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" }[ext] ?? "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
}

// --- Webhooks de Stripe (Bloque 25, recurrente desde Bloque 64) ------------
// El único paso 100% automático de todo el ciclo de verificación — activa o
// desactiva la cuenta sin intervención de un admin, pero SOLO porque depende
// de una confirmación real y separada del "vendedor dice que pagó": la
// firma del webhook (verificada en stripeWebhook.controller.js antes de
// llegar acá) prueba que el evento viene de Stripe de verdad. Nunca se marca
// VERIFIED/PAYMENT_FAILED/SUSPENDED a mano desde la UI del admin para pagos
// con tarjeta — solo estos 4 eventos.
async function handleCheckoutCompleted(session) {
  const verificationId = session.metadata?.verificationId;
  if (!verificationId) return;

  const verification = await prisma.verificationRequest.findUnique({ where: { id: verificationId }, include: { vendor: true } });
  if (!verification) return;

  // Idempotencia: Stripe puede reenviar el mismo evento más de una vez si no
  // recibe el 200 a tiempo — sin este chequeo, un reintento repetiría la
  // notificación de "¡verificado!" sin ninguna necesidad.
  if (verification.paymentConfirmedAt) return;
  if (verification.paymentMethod !== "CARD" || !["PENDING_PAYMENT", "SUSPENDED"].includes(verification.vendor.verificationStatus)) return;
  // Un evento de una sesión VIEJA (el vendedor generó un link nuevo después
  // de que este venciera) no debe activar nada — solo cuenta la sesión
  // vigente guardada en la solicitud.
  if (verification.stripeCheckoutSessionId !== session.id) return;

  await prisma.verificationRequest.update({
    where: { id: verification.id },
    data: { paymentConfirmedAt: new Date(), paymentConfirmedById: null },
  });
  await transitionVendorVerification(verification.vendorId, "VERIFIED", {
    source: "STRIPE_WEBHOOK",
    extraData: { planType: "BUSINESS", stripeCustomerId: session.customer, stripeSubscriptionId: session.subscription },
    notify: { type: "VERIFICATION_VERIFIED" },
  });
}

// Renueva un mes más — cubre tanto la primera factura (Stripe la dispara
// junto a checkout.session.completed) como cada renovación mensual real
// después. Si la tienda venía de PAYMENT_FAILED, este es el camino que la
// recupera SIN pedirle documentos de nuevo.
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
