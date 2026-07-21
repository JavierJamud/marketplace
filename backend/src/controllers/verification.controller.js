import { z } from "zod";
import { readFile, stat } from "node:fs/promises";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { imageSize } from "image-size";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyVerificationEvent } from "../services/verificationNotify.service.js";
import { createVerificationCheckoutSession } from "../lib/stripe.js";

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

// Estado derivado para el frontend — un solo lugar que traduce el enum
// interno (PENDING_REVIEW/PENDING_PAYMENT/APPROVED/REJECTED) + "¿ya subió
// algo?" al ciclo que describe el negocio: REGULAR (nada enviado todavía) →
// PENDIENTE_DOCS → PENDIENTE_PAGO → VERIFICADO (o RECHAZADO en el medio).
// No hace falta un valor de enum aparte para REGULAR: es simplemente
// PENDING_REVIEW sin fotos todavía (la fila vacía que se crea al registrar
// la tienda, ver createVendor en vendors.controller.js).
function computeStage(v) {
  if (!v) return "REGULAR";
  if (v.status === "PENDING_REVIEW") return v.selfieUrl || v.idPhotoFrontUrl ? "PENDIENTE_DOCS" : "REGULAR";
  if (v.status === "PENDING_PAYMENT") return "PENDIENTE_PAGO";
  if (v.status === "APPROVED") return "VERIFICADO";
  return "RECHAZADO";
}

// KYC: las fotos son privadas y nunca se sirven por URL pública — solo por
// este endpoint autenticado (dueño de la tienda o admin), nunca por
// express.static ni por un path expuesto directamente al frontend.
export async function getMyVerification(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const v = vendor.verification;
  res.json({
    verification: v && {
      status: v.status,
      stage: computeStage(v),
      fullName: v.fullName,
      idNumber: v.idNumber,
      selfieReceived: !!v.selfieUrl,
      idDocumentReceived: !!v.idPhotoFrontUrl,
      notes: v.notes,
      createdAt: v.createdAt,
      reviewedAt: v.reviewedAt,
      paymentMethod: v.paymentMethod,
      // Bloque 25: Checkout Session real de Stripe — expiresAt para que el
      // frontend sepa si el link todavía sirve o hay que ofrecer uno nuevo
      // (Stripe los vence solo, típicamente a las 24h).
      stripeCheckoutUrl: v.stripeCheckoutUrl,
      stripeCheckoutExpired: v.stripeCheckoutExpiresAt ? v.stripeCheckoutExpiresAt < new Date() : false,
      paymentProofReceived: !!v.paymentProofUrl,
      paymentConfirmedAt: v.paymentConfirmedAt,
    },
  });
}

const submitSchema = z.object({
  fullName: z.string().min(2).optional(),
  idNumber: z.string().min(4).optional(),
});

// Captura solo por cámara (Bloque 10): el frontend nunca ofrece selector de
// archivo, así que llegar acá con ambos archivos significa que son fotos
// recién tomadas en vivo. Bloque 16: ya no hay aprobación automática — todo
// envío válido cae en PENDING_REVIEW para que un admin lo revise a mano. Solo
// se puede enviar si todavía no hay nada en curso (REGULAR) o si el envío
// anterior fue RECHAZADO — con documentos en revisión o en fase de pago, no
// se puede reenviar hasta que el admin resuelva.
export async function submitVerification(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const stage = computeStage(vendor.verification);
  if (stage !== "REGULAR" && stage !== "RECHAZADO") {
    throw new AppError("Ya tenés una solicitud en curso — esperá la resolución del equipo de ZeuDin.", 409);
  }

  const data = submitSchema.parse(req.body);
  const selfieFile = req.files?.selfie?.[0];
  const idFile = req.files?.idDocument?.[0];
  if (!selfieFile || !idFile) {
    throw new AppError("Necesitás capturar la selfie y el documento con la cámara antes de enviar.", 400);
  }

  const [selfieCheck, idCheck] = await Promise.all([validateKycImage(selfieFile.filename), validateKycImage(idFile.filename)]);
  if (!selfieCheck.ok || !idCheck.ok) {
    const reasons = [!selfieCheck.ok && `selfie (${selfieCheck.reason})`, !idCheck.ok && `documento (${idCheck.reason})`].filter(Boolean).join("; ");
    throw new AppError(`No se pudo procesar la captura: ${reasons}. Volvé a intentarlo.`, 400);
  }

  const update = {
    status: "PENDING_REVIEW",
    reviewedAt: null,
    reviewedById: null,
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
    paymentConfirmedAt: null,
    paymentConfirmedById: null,
  };
  if (data.fullName) update.fullName = data.fullName;
  if (data.idNumber) update.idNumber = data.idNumber;

  const verification = await prisma.verificationRequest.upsert({
    where: { vendorId: vendor.id },
    update,
    create: { vendorId: vendor.id, ...update },
  });

  res.status(201).json({
    verification: { status: verification.status, stage: "PENDIENTE_DOCS", selfieReceived: true, idDocumentReceived: true },
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
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);
  if (vendor.verification?.status !== "PENDING_PAYMENT") {
    throw new AppError("Todavía no llegaste a la fase de cobro de la suscripción.", 409);
  }

  const { method } = paymentMethodSchema.parse(req.body);
  let verification = await prisma.verificationRequest.update({ where: { vendorId: vendor.id }, data: { paymentMethod: method } });

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
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const v = vendor.verification;
  if (v?.status !== "PENDING_PAYMENT" || v.paymentMethod !== "CARD") {
    throw new AppError("Elegí tarjeta como método de pago antes de generar un link de Stripe.", 409);
  }

  const verification = await createAndSaveCheckoutSession(vendor, v);
  res.json({
    verification: {
      stripeCheckoutUrl: verification.stripeCheckoutUrl,
      stripeCheckoutExpired: false,
    },
  });
}

// Comprobante de transferencia CUP — mismo mecanismo de subida que las fotos
// de KYC (kycUpload), reutilizado tal cual en vez de duplicar lógica de
// archivos. La activación real la hace un admin a mano (ver confirmCupPayment
// en admin.controller.js) — este endpoint solo guarda el archivo.
export async function uploadMyPaymentProof(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id }, include: { verification: true } });
  if (!vendor) throw new AppError("No tienes una tienda registrada.", 404);

  const v = vendor.verification;
  if (v?.status !== "PENDING_PAYMENT" || v.paymentMethod !== "CUP_TRANSFER") {
    throw new AppError("Elegí transferencia CUP como método de pago antes de subir el comprobante.", 409);
  }
  if (!req.file) throw new AppError("Subí una foto o PDF del comprobante.", 400);

  const verification = await prisma.verificationRequest.update({
    where: { vendorId: vendor.id },
    data: { paymentProofUrl: req.file.filename },
  });
  res.status(201).json({ verification: { paymentProofReceived: !!verification.paymentProofUrl } });
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

  const buffer = await readFile(join(KYC_UPLOAD_DIR, filename));
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" }[ext] ?? "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.setHeader("Cache-Control", "no-store");
  res.send(buffer);
}

// --- Webhook de Stripe (Bloque 25) -------------------------------------
// Este es el único paso 100% automático de todo el ciclo de verificación —
// activa la cuenta sin intervención de un admin, pero SOLO porque depende
// de una confirmación real y separada del "vendedor dice que pagó": la
// firma del webhook (verificada en stripeWebhook.controller.js antes de
// llegar acá) prueba que el evento viene de Stripe de verdad. Mismo patrón
// de activación que confirmCupPayment (admin.controller.js) —
// paymentConfirmedById queda null a propósito: null = confirmación
// automática, con admin = confirmación manual (ver el badge "Pago
// automático" vs "Confirmado a mano" en AdminVerifications.jsx).
export async function handleStripeWebhookEvent(event) {
  if (event.type !== "checkout.session.completed") return;

  const session = event.data.object;
  const verificationId = session.metadata?.verificationId;
  if (!verificationId) return;

  const verification = await prisma.verificationRequest.findUnique({ where: { id: verificationId }, include: { vendor: true } });
  if (!verification) return;

  // Idempotencia: Stripe puede reenviar el mismo evento más de una vez si
  // no recibe el 200 a tiempo — sin este chequeo, un reintento repetiría la
  // notificación de "¡verificado!" sin ninguna necesidad.
  if (verification.paymentConfirmedAt) return;
  if (verification.paymentMethod !== "CARD" || verification.status !== "PENDING_PAYMENT") return;
  // Un evento de una sesión VIEJA (el vendedor generó un link nuevo después
  // de que este venciera) no debe activar nada — solo cuenta la sesión
  // vigente guardada en la solicitud.
  if (verification.stripeCheckoutSessionId !== session.id) return;

  await prisma.$transaction([
    prisma.verificationRequest.update({
      where: { id: verification.id },
      data: { status: "APPROVED", paymentConfirmedAt: new Date(), paymentConfirmedById: null },
    }),
    prisma.vendor.update({ where: { id: verification.vendorId }, data: { isVerified: true, planType: "BUSINESS" } }),
  ]);

  await notifyVerificationEvent(verification.vendor, "VERIFICATION_VERIFIED");
}
