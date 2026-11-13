import crypto from "node:crypto";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { encryptSecret } from "../lib/crypto.js";
import { PRIORITY_CODE, canSendNow, enqueueDirect, getSession, isOptedOut, kindEnabled } from "../whatsapp/outbox.js";
import { normalizePhone, samePhone } from "../whatsapp/phone.js";
import { CODE_MINUTES, verificationText } from "../whatsapp/templates.js";

// Confirmación de WhatsApp de una cuenta (su teléfono) o de una tienda (su WhatsApp). Un número solo recibe
// avisos por WhatsApp después de que su dueño escribe aquí el código que le llegó a ese mismo número.

const RESEND_SEC = 60;
const MAX_TRIES = 5;
const PER_PHONE_HOURLY = 3;
const PER_ACCOUNT_HOURLY = 5;
// Cuánto espera la respuesta a que el proceso de WhatsApp diga si el código salió.
const WAIT_SEND_MS = 15_000;

const targetSchema = z.object({ target: z.enum(["user", "vendor"]) });
const confirmSchema = targetSchema.extend({ code: z.string().trim().regex(/^\d{6}$/, "El código tiene 6 números.") });

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

// A quién se le confirma el número: la cuenta que hizo la solicitud, o la tienda de la que esa cuenta es dueña.
async function subjectOf(req, target) {
  if (target === "vendor") {
    const vendor = await prisma.vendor.findUnique({
      where: { userId: req.user.id },
      select: { id: true, deletedAt: true, whatsapp: true, whatsappVerifiedPhone: true, whatsappVerifiedAt: true },
    });
    if (!vendor || vendor.deletedAt) throw new AppError("Solo el dueño de la tienda puede confirmar su WhatsApp.", 403);
    return {
      target: "VENDOR", userId: req.user.id, vendorId: vendor.id, phone: normalizePhone(vendor.whatsapp),
      verifiedPhone: vendor.whatsappVerifiedPhone, verifiedAt: vendor.whatsappVerifiedAt,
      save: (data) => prisma.vendor.update({ where: { id: vendor.id }, data }),
    };
  }
  const user = await prisma.user.findUnique({
    where: { id: req.user.id },
    select: { id: true, phone: true, whatsappVerifiedPhone: true, whatsappVerifiedAt: true },
  });
  if (!user) throw new AppError("Inicia sesión de nuevo.", 401);
  return {
    target: "USER", userId: user.id, vendorId: null, phone: normalizePhone(user.phone),
    verifiedPhone: user.whatsappVerifiedPhone, verifiedAt: user.whatsappVerifiedAt,
    save: (data) => prisma.user.update({ where: { id: user.id }, data }),
  };
}

function codesAvailable(session) {
  return canSendNow(session) && kindEnabled(session, "verify");
}

// Público: ¿la plataforma puede enviar códigos ahora? El registro lo usa para mostrar o no la opción.
export async function getAvailability(req, res) {
  res.json({ available: codesAvailable(await getSession()) });
}

export async function getStatus(req, res) {
  const { target } = targetSchema.parse(req.query);
  const subject = await subjectOf(req, target);
  const verified = Boolean(subject.phone && subject.verifiedPhone && samePhone(subject.verifiedPhone, subject.phone));
  res.json({
    available: codesAvailable(await getSession()),
    phone: subject.phone,
    hasPhone: Boolean(subject.phone),
    verified,
    verifiedAt: verified ? subject.verifiedAt : null,
    optedOut: subject.phone ? await isOptedOut(subject.phone) : false,
  });
}

export async function startVerification(req, res) {
  const { target } = targetSchema.parse(req.body);
  const subject = await subjectOf(req, target);
  if (!subject.phone) throw new AppError("Primero guarda un número de teléfono.", 400);
  const session = await getSession();
  // El número vinculado es el que envía: un mensaje a sí mismo cae en su chat propio y el teléfono no avisa.
  if (samePhone(subject.phone, session.phone)) {
    throw new AppError("Ese es el número desde el que Baznova envía los mensajes. Para recibir avisos usa otro número.", 400, { reason: "PLATFORM_NUMBER" });
  }
  if (!codesAvailable(session)) {
    throw new AppError("Ahora mismo no podemos enviar códigos por WhatsApp. Prueba más tarde.", 409);
  }

  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const [last, byPhone, byAccount] = await Promise.all([
    prisma.whatsappVerification.findFirst({
      where: { userId: subject.userId, target: subject.target, consumedAt: null },
      orderBy: { createdAt: "desc" },
      select: { createdAt: true },
    }),
    prisma.whatsappVerification.count({ where: { phone: subject.phone, createdAt: { gt: hourAgo } } }),
    prisma.whatsappVerification.count({ where: { userId: subject.userId, createdAt: { gt: hourAgo } } }),
  ]);
  const sinceLast = last ? (Date.now() - last.createdAt.getTime()) / 1000 : Infinity;
  if (sinceLast < RESEND_SEC) {
    const retryInSec = Math.ceil(RESEND_SEC - sinceLast);
    throw new AppError(`Espera ${retryInSec} segundos para pedir otro código.`, 429, { retryInSec });
  }
  if (byPhone >= PER_PHONE_HOURLY || byAccount >= PER_ACCOUNT_HOURLY) {
    throw new AppError("Ya pediste varios códigos. Espera una hora y prueba de nuevo.", 429);
  }

  const code = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  const verification = await prisma.whatsappVerification.create({
    data: {
      target: subject.target, userId: subject.userId, vendorId: subject.vendorId, phone: subject.phone,
      codeHash: await bcrypt.hash(code, 10), expiresAt: new Date(Date.now() + CODE_MINUTES * 60 * 1000),
    },
  });
  // El código viaja cifrado en la cola: en el historial del admin solo se ve la etiqueta.
  const message = await enqueueDirect({
    phone: subject.phone, kind: "verify", audience: subject.target === "VENDOR" ? "VENDOR" : req.user.role === "ADMIN" ? "ADMIN" : "CLIENT",
    userId: subject.userId, vendorId: subject.vendorId, body: "Código de confirmación",
    secret: encryptSecret(verificationText(code)), priority: PRIORITY_CODE, ttlMs: 3 * 60 * 1000,
  });
  await prisma.whatsappVerification.update({ where: { id: verification.id }, data: { messageId: message.id } });

  const sent = { sent: true, phone: subject.phone, expiresInSec: CODE_MINUTES * 60, resendInSec: RESEND_SEC };
  const deadline = Date.now() + WAIT_SEND_MS;
  while (Date.now() < deadline) {
    await sleep(500);
    const row = await prisma.whatsappMessage.findUnique({ where: { id: message.id }, select: { status: true, lastError: true } });
    if (!row || row.status === "SENT") return res.json(sent);
    if (row.status === "PENDING" || row.status === "SENDING") continue;
    // No salió: ese intento ya no cuenta para la espera entre códigos, así la persona corrige el número y prueba otra vez.
    await prisma.whatsappVerification.update({ where: { id: verification.id }, data: { consumedAt: new Date() } });
    if (row.status === "SKIPPED" && row.lastError === "NO_WHATSAPP") {
      throw new AppError("Ese número no tiene WhatsApp. Revisa el número o usa otro.", 422, { reason: "NO_WHATSAPP" });
    }
    throw new AppError("No pudimos enviar el código. Prueba de nuevo en un momento.", 502);
  }
  // Sigue en la cola: sale en cuanto pueda, y el código sirve igual.
  res.json({ ...sent, delayed: true });
}

export async function confirmVerification(req, res) {
  const { target, code } = confirmSchema.parse(req.body);
  const subject = await subjectOf(req, target);
  const verification = await prisma.whatsappVerification.findFirst({
    where: { userId: subject.userId, target: subject.target, consumedAt: null, expiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  if (!verification) throw new AppError("El código venció. Pide uno nuevo.", 400, { reason: "EXPIRED" });
  if (!subject.phone || !samePhone(verification.phone, subject.phone)) {
    throw new AppError("El número cambió después de pedir el código. Pide uno nuevo.", 409, { reason: "PHONE_CHANGED" });
  }
  if (verification.attempts >= MAX_TRIES) {
    throw new AppError("Demasiados intentos. Pide un código nuevo.", 429, { reason: "TOO_MANY" });
  }
  if (!(await bcrypt.compare(code, verification.codeHash))) {
    const updated = await prisma.whatsappVerification.update({
      where: { id: verification.id }, data: { attempts: { increment: 1 } }, select: { attempts: true },
    });
    const left = Math.max(0, MAX_TRIES - updated.attempts);
    throw new AppError(
      left ? `Código incorrecto. Te quedan ${left} ${left === 1 ? "intento" : "intentos"}.` : "Código incorrecto. Pide un código nuevo.",
      400, { reason: "WRONG_CODE", left },
    );
  }

  const verifiedAt = new Date();
  // updateMany con consumedAt null: si dos solicitudes llegan a la vez con el mismo código, solo una lo usa.
  const used = await prisma.whatsappVerification.updateMany({ where: { id: verification.id, consumedAt: null }, data: { consumedAt: verifiedAt } });
  if (!used.count) throw new AppError("El código venció. Pide uno nuevo.", 400, { reason: "EXPIRED" });
  await subject.save({ whatsappVerifiedPhone: subject.phone, whatsappVerifiedAt: verifiedAt });
  // Quien confirma de nuevo quiere los avisos: se quita la baja que hubiera dado antes respondiendo BAJA.
  await prisma.whatsappOptOut.deleteMany({ where: { phone: subject.phone } });
  res.json({ verified: true, phone: subject.phone, verifiedAt });
}

export async function disableWhatsapp(req, res) {
  const { target } = targetSchema.parse(req.body);
  const subject = await subjectOf(req, target);
  await subject.save({ whatsappVerifiedPhone: null, whatsappVerifiedAt: null });
  res.json({ verified: false });
}
