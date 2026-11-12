import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { logActivity } from "../lib/activityLog.js";
import {
  PRIORITY_NOTICE, SESSION_ID, WHATSAPP_KINDS, canSendNow, enqueueBroadcast, enqueueDirect, enqueueVendorNotice, forgetSessionCache,
  getSession, isOptedOut, kindEnabled, refOf, workerAlive,
} from "../whatsapp/outbox.js";
import { digitsOf, normalizePhone, samePhone } from "../whatsapp/phone.js";
import { BROADCAST_MAX, broadcastText, testText } from "../whatsapp/templates.js";

// Admin → WhatsApp: vincular el número de la plataforma con un QR, ver el estado, ajustar qué se envía y a qué ritmo,
// y revisar el historial. Este controlador solo lee y escribe la base de datos: la conexión la lleva el proceso aparte
// (src/whatsapp/worker.js), que mira la fila de WhatsappSession cada 2 segundos.

const PAGE = 40;

function setSession(data) {
  forgetSessionCache();
  return prisma.whatsappSession.update({ where: { id: SESSION_ID }, data });
}

export async function getWhatsappStatus(req, res) {
  const session = await getSession();
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const notice = { priority: { gte: PRIORITY_NOTICE } };
  const [sentHour, sentDay, pending, failedDay, users, vendors, optOuts] = await Promise.all([
    prisma.whatsappMessage.count({ where: { ...notice, status: "SENT", sentAt: { gt: hourAgo } } }),
    prisma.whatsappMessage.count({ where: { ...notice, status: "SENT", sentAt: { gt: dayAgo } } }),
    prisma.whatsappMessage.count({ where: { status: { in: ["PENDING", "SENDING"] } } }),
    prisma.whatsappMessage.count({ where: { status: "FAILED", createdAt: { gt: dayAgo } } }),
    prisma.user.count({ where: { deletedAt: null, whatsappVerifiedPhone: { not: null } } }),
    prisma.vendor.count({ where: { deletedAt: null, whatsappVerifiedPhone: { not: null } } }),
    prisma.whatsappOptOut.count(),
  ]);
  res.json({
    status: session.status,
    desired: session.desired,
    qr: session.status === "QR" ? session.qr : null,
    qrAt: session.qrAt,
    phone: session.phone,
    pushName: session.pushName,
    connectedAt: session.connectedAt,
    lastError: session.lastError,
    workerAlive: workerAlive(session),
    canSend: canSendNow(session),
    paused: session.paused,
    limits: {
      hourlyLimit: session.hourlyLimit, dailyLimit: session.dailyLimit,
      minDelaySec: session.minDelaySec, maxDelaySec: session.maxDelaySec,
    },
    kinds: WHATSAPP_KINDS.map((kind) => ({ ...kind, enabled: kindEnabled(session, kind.key) })),
    counts: { sentHour, sentDay, pending, failedDay },
    confirmed: { users, vendors, optOuts },
  });
}

// Pide el QR. El proceso de WhatsApp lo genera en unos segundos y la página lo muestra.
export async function linkWhatsapp(req, res) {
  const session = await getSession();
  if (!workerAlive(session)) {
    throw new AppError("El proceso de WhatsApp no está en marcha en el servidor. Arráncalo (npm run whatsapp) y prueba de nuevo.", 409);
  }
  await setSession({ desired: "ON", lastError: null, downAlertAt: null });
  res.json({ ok: true });
}

// Cancela un enlace a medias (QR sin escanear o conexión que no termina de abrir).
export async function cancelWhatsappLink(req, res) {
  const session = await getSession();
  if (session.status === "CONNECTED") throw new AppError("El número ya está vinculado. Para quitarlo usa Desvincular.", 409);
  await setSession({ desired: "OFF" });
  res.json({ ok: true });
}

export async function unlinkWhatsapp(req, res) {
  const session = await getSession();
  if (workerAlive(session)) {
    await setSession({ desired: "LOGOUT" });
  } else {
    // Sin el proceso no se le puede avisar a WhatsApp: se borra la sesión guardada y el dispositivo queda en la lista
    // del teléfono hasta que se quite desde ahí.
    await prisma.whatsappAuthKey.deleteMany({});
    await setSession({ status: "DISCONNECTED", desired: "OFF", qr: null, qrAt: null, phone: null, pushName: null, connectedAt: null, lastError: null });
  }
  res.json({ ok: true });
}

const settingsSchema = z.object({
  paused: z.boolean().optional(),
  enabledKinds: z.record(z.boolean()).optional(),
  hourlyLimit: z.number().int().min(1).max(300).optional(),
  dailyLimit: z.number().int().min(1).max(3000).optional(),
  minDelaySec: z.number().int().min(1).max(120).optional(),
  maxDelaySec: z.number().int().min(1).max(300).optional(),
});

export async function updateWhatsappSettings(req, res) {
  const data = settingsSchema.parse(req.body);
  const session = await getSession();
  const next = {};
  if (data.paused !== undefined) next.paused = data.paused;
  for (const key of ["hourlyLimit", "dailyLimit", "minDelaySec", "maxDelaySec"]) {
    if (data[key] !== undefined) next[key] = data[key];
  }
  const min = next.minDelaySec ?? session.minDelaySec;
  const max = next.maxDelaySec ?? session.maxDelaySec;
  if (max < min) throw new AppError("La pausa máxima no puede ser menor que la mínima.", 400);
  const hourly = next.hourlyLimit ?? session.hourlyLimit;
  const daily = next.dailyLimit ?? session.dailyLimit;
  if (daily < hourly) throw new AppError("El tope por día no puede ser menor que el tope por hora.", 400);
  if (data.enabledKinds) {
    const known = new Set(WHATSAPP_KINDS.map((kind) => kind.key));
    const merged = { ...(session.enabledKinds ?? {}) };
    for (const [key, value] of Object.entries(data.enabledKinds)) {
      if (known.has(key)) merged[key] = value;
    }
    next.enabledKinds = merged;
  }
  await setSession(next);
  res.json({ ok: true });
}

const testSchema = z.object({ phone: z.string().trim().min(8).max(20) });

export async function sendWhatsappTest(req, res) {
  const raw = testSchema.parse(req.body).phone;
  // Sin el "+" no se sabe de qué país es: un móvil cubano de 8 cifras saldría hacia otro país.
  const phone = raw.startsWith("+") ? normalizePhone(raw) : null;
  if (!phone) throw new AppError("Escribe el número completo, con el código del país.", 400);
  if (!canSendNow(await getSession())) throw new AppError("El WhatsApp de la plataforma no está conectado.", 409);
  const message = await enqueueDirect({ phone, kind: "test", audience: "SYSTEM", body: testText(), priority: 2, ttlMs: 5 * 60 * 1000 });
  res.json({ ok: true, id: message.id, ref: refOf(message.dedupeKey) });
}

const listSchema = z.object({
  status: z.enum(["PENDING", "SENDING", "SENT", "FAILED", "EXPIRED", "SKIPPED"]).optional(),
  q: z.string().trim().max(40).optional(),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

export async function listWhatsappMessages(req, res) {
  const { status, q, page } = listSchema.parse(req.query);
  const where = {};
  if (status) where.status = status;
  if (q) {
    const digits = digitsOf(q);
    where.OR = [
      // La referencia del pie del mensaje son los primeros 6 caracteres de la llave.
      { dedupeKey: { startsWith: q.toLowerCase() } },
      { refCode: { contains: q, mode: "insensitive" } },
      ...(digits.length >= 4 ? [{ phone: { contains: digits } }] : []),
    ];
  }
  const [total, rows] = await Promise.all([
    prisma.whatsappMessage.count({ where }),
    prisma.whatsappMessage.findMany({
      where, orderBy: { createdAt: "desc" }, skip: (page - 1) * PAGE, take: PAGE,
      select: {
        id: true, dedupeKey: true, kind: true, audience: true, phone: true, refCode: true, body: true, status: true,
        attempts: true, lastError: true, createdAt: true, sentAt: true,
      },
    }),
  ]);
  res.json({
    total, page, pageSize: PAGE,
    messages: rows.map(({ dedupeKey, ...row }) => ({ ...row, ref: refOf(dedupeKey) })),
  });
}

// ── Tiendas: quién tiene los avisos por WhatsApp y activarlos a mano ──

const VENDOR_PAGE = 30;
const vendorListSchema = z.object({
  q: z.string().trim().max(60).optional(),
  filter: z.enum(["all", "on", "off"]).default("all"),
  page: z.coerce.number().int().min(1).max(500).default(1),
});

// ON: confirmado y es el número de ahora. CHANGED: confirmó otro número (cambió el WhatsApp después). OPTED_OUT: respondió
// BAJA. OFF: nunca lo activó.
function vendorWhatsappState(vendor, optedOut) {
  if (optedOut) return "OPTED_OUT";
  if (!vendor.whatsappVerifiedPhone) return "OFF";
  return samePhone(vendor.whatsappVerifiedPhone, vendor.whatsapp) ? "ON" : "CHANGED";
}

export async function listWhatsappVendors(req, res) {
  const { q, filter, page } = vendorListSchema.parse(req.query);
  const where = { deletedAt: null };
  if (filter === "on") where.whatsappVerifiedPhone = { not: null };
  if (filter === "off") where.whatsappVerifiedPhone = null;
  if (q) {
    const digits = digitsOf(q);
    where.OR = [
      { companyName: { contains: q, mode: "insensitive" } },
      { slug: { contains: q.toLowerCase() } },
      ...(digits.length >= 4 ? [{ whatsapp: { contains: digits } }] : []),
    ];
  }
  const [total, rows, on, all] = await Promise.all([
    prisma.vendor.count({ where }),
    prisma.vendor.findMany({
      where, orderBy: { companyName: "asc" }, skip: (page - 1) * VENDOR_PAGE, take: VENDOR_PAGE,
      select: { id: true, companyName: true, slug: true, whatsapp: true, whatsappVerifiedPhone: true, whatsappVerifiedAt: true },
    }),
    prisma.vendor.count({ where: { deletedAt: null, whatsappVerifiedPhone: { not: null } } }),
    prisma.vendor.count({ where: { deletedAt: null } }),
  ]);
  const phones = rows.map((r) => normalizePhone(r.whatsapp)).filter(Boolean);
  const [optOuts, sent] = await Promise.all([
    prisma.whatsappOptOut.findMany({ where: { phone: { in: phones } }, select: { phone: true } }),
    prisma.whatsappMessage.groupBy({
      by: ["vendorId"],
      where: { vendorId: { in: rows.map((r) => r.id) }, status: "SENT", priority: { gte: PRIORITY_NOTICE } },
      _count: { _all: true },
    }),
  ]);
  const optedOut = new Set(optOuts.map((o) => o.phone));
  const sentOf = new Map(sent.map((s) => [s.vendorId, s._count._all]));
  res.json({
    total, page, pageSize: VENDOR_PAGE, totals: { on, off: all - on, all },
    vendors: rows.map((v) => ({
      id: v.id, companyName: v.companyName, slug: v.slug, whatsapp: v.whatsapp,
      state: vendorWhatsappState(v, optedOut.has(normalizePhone(v.whatsapp))),
      verifiedAt: v.whatsappVerifiedAt, noticesSent: sentOf.get(v.id) ?? 0,
    })),
  });
}

// El admin activa los avisos de una tienda sin código (por ejemplo, la tienda lo pidió por teléfono). Le llega un mensaje
// de bienvenida que explica cómo darse de baja. A una tienda que respondió BAJA no se le puede activar desde aquí.
export async function activateVendorWhatsapp(req, res) {
  const vendor = await prisma.vendor.findFirst({
    where: { id: req.params.id, deletedAt: null },
    select: { id: true, companyName: true, whatsapp: true, whatsappVerifiedPhone: true },
  });
  if (!vendor) throw new AppError("Esa tienda no existe.", 404);
  const phone = normalizePhone(vendor.whatsapp);
  if (!phone) throw new AppError("La tienda no tiene un WhatsApp válido. Corrígelo antes de activar los avisos.", 400);
  if (await isOptedOut(phone)) {
    throw new AppError("Esta tienda respondió BAJA. Solo ella puede volver a activarlos desde su perfil, con un código.", 409);
  }
  await prisma.vendor.update({ where: { id: vendor.id }, data: { whatsappVerifiedPhone: phone, whatsappVerifiedAt: new Date() } });
  await enqueueVendorNotice(vendor.id, {
    category: "account",
    title: `Hola, ${vendor.companyName}: tus avisos ya llegan aquí`,
    body: "Te escribiremos por este número cuando tengas pedidos nuevos o pendientes, mensajes, stock bajo y tu resumen semanal. Puedes apagarlos desde tu perfil.",
    url: "/vendedor/perfil#avisos-whatsapp",
  });
  await logActivity({
    actorId: req.user.id, actorRole: "ADMIN", vendorId: vendor.id, action: "whatsapp_activated",
    description: `Activó a mano los avisos por WhatsApp de la tienda en el ${phone}.`,
  });
  res.json({ ok: true, state: "ON" });
}

export async function deactivateVendorWhatsapp(req, res) {
  const vendor = await prisma.vendor.findFirst({ where: { id: req.params.id, deletedAt: null }, select: { id: true } });
  if (!vendor) throw new AppError("Esa tienda no existe.", 404);
  await prisma.vendor.update({ where: { id: vendor.id }, data: { whatsappVerifiedPhone: null, whatsappVerifiedAt: null } });
  await logActivity({ actorId: req.user.id, actorRole: "ADMIN", vendorId: vendor.id, action: "whatsapp_deactivated", description: "Apagó los avisos por WhatsApp de la tienda." });
  res.json({ ok: true, state: "OFF" });
}

// ── Mensaje a tiendas (masivo) ───────────────────────────────────────────────────────────────────────────────
// Reglas para no quemar el número de la plataforma:
//  · solo a tiendas que confirmaron su WhatsApp (con código o activadas por el admin) y no respondieron BAJA;
//  · uno cada 24 horas como mucho;
//  · cada mensaje empieza con el nombre de la tienda (no salen cientos de textos idénticos);
//  · sale después de los avisos de pedidos, al doble de pausa, de 8:00 a 21:00 de Cuba y usando como mucho la mitad del
//    tope por hora y el 60 % del diario (worker.js);
//  · lo que no alcanzó a salir en 48 horas se descarta.

const BROADCAST_KIND = "BROADCAST:vendors";
const BROADCAST_EVERY_MS = 24 * 60 * 60 * 1000;
const BROADCAST_TTL_HOURS = 48;
const BULK_HOURS_PER_DAY = 13;

const broadcastSchema = z.object({
  message: z.string().trim().min(10, "Escribe al menos 10 caracteres.").max(BROADCAST_MAX, `Como mucho ${BROADCAST_MAX} caracteres.`),
  url: z
    .string()
    .trim()
    .max(300)
    .refine((v) => !v || /^\/(?!\/)/.test(v) || /^https:\/\//.test(v), "El enlace debe empezar con / o con https://.")
    .optional()
    .default(""),
  audience: z.enum(["ALL", "SELECTED"]).default("ALL"),
  vendorIds: z.array(z.string().min(1).max(40)).max(500).default([]),
});

async function broadcastRecipients({ audience, vendorIds }) {
  if (audience === "SELECTED" && !vendorIds.length) throw new AppError("Elige al menos una tienda.", 400);
  const vendors = await prisma.vendor.findMany({
    where: { deletedAt: null, whatsappVerifiedPhone: { not: null }, ...(audience === "SELECTED" ? { id: { in: vendorIds } } : {}) },
    select: { id: true, companyName: true, whatsapp: true, whatsappVerifiedPhone: true },
    orderBy: { companyName: "asc" },
  });
  const verified = vendors.filter((v) => samePhone(v.whatsappVerifiedPhone, v.whatsapp));
  const phones = verified.map((v) => normalizePhone(v.whatsapp)).filter(Boolean);
  const optedOut = new Set((await prisma.whatsappOptOut.findMany({ where: { phone: { in: phones } }, select: { phone: true } })).map((o) => o.phone));
  const recipients = verified.filter((v) => !optedOut.has(normalizePhone(v.whatsapp)));
  const asked = audience === "SELECTED" ? new Set(vendorIds).size : recipients.length;
  return { recipients, skipped: Math.max(0, asked - recipients.length) };
}

// Cuántos mensajes masivos salen por hora con los topes y pausas de ahora (pausa doble + unos 3 s de "escribiendo").
function bulkPerHour(session) {
  const byLimit = Math.max(1, Math.floor(session.hourlyLimit / 2));
  const min = Math.max(1, session.minDelaySec);
  const avgSec = ((min + Math.max(min, session.maxDelaySec)) / 2) * 2 + 3;
  return Math.max(1, Math.min(byLimit, Math.floor(3600 / avgSec)));
}

async function lastBroadcastAt() {
  const last = await prisma.whatsappMessage.findFirst({
    // Un envío detenido antes de salir no cuenta para la espera de 24 horas (lastError es null en los que no fallaron).
    where: { kind: BROADCAST_KIND, OR: [{ lastError: null }, { lastError: { not: "CANCELLED" } }] },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  return last?.createdAt ?? null;
}

async function broadcastPlan(input) {
  const session = await getSession();
  const { recipients, skipped } = await broadcastRecipients(input);
  const perHour = bulkPerHour(session);
  const perDay = Math.max(1, Math.min(perHour * BULK_HOURS_PER_DAY, Math.floor(session.dailyLimit * 0.6)));
  const capacity = perDay * (BROADCAST_TTL_HOURS / 24);
  const last = await lastBroadcastAt();
  const nextAllowedAt = last && Date.now() - last.getTime() < BROADCAST_EVERY_MS ? new Date(last.getTime() + BROADCAST_EVERY_MS) : null;
  return {
    session, recipients, skipped, perHour, perDay, capacity, nextAllowedAt,
    hours: Math.ceil(recipients.length / perHour),
  };
}

function planJson(plan, input) {
  const sample = plan.recipients[0];
  return {
    recipients: plan.recipients.length,
    skipped: plan.skipped,
    perHour: plan.perHour,
    perDay: plan.perDay,
    hours: plan.hours,
    capacity: plan.capacity,
    tooMany: plan.recipients.length > plan.capacity,
    nextAllowedAt: plan.nextAllowedAt,
    linked: plan.session.desired === "ON",
    connected: canSendNow(plan.session),
    enabled: kindEnabled(plan.session, BROADCAST_KIND),
    sample: input.message
      ? broadcastText({ companyName: sample?.companyName ?? "Nombre de la tienda", message: input.message, url: input.url || null }, "XXXXXX")
      : null,
  };
}

// Vista previa: a cuántas tiendas llega, cuánto tarda y cómo se ve. No envía nada.
export async function previewBroadcast(req, res) {
  const input = broadcastSchema.extend({ message: z.string().max(BROADCAST_MAX).optional().default("") }).parse(req.body ?? {});
  res.json(planJson(await broadcastPlan(input), input));
}

export async function sendBroadcast(req, res) {
  const input = broadcastSchema.parse(req.body ?? {});
  const plan = await broadcastPlan(input);
  if (plan.session.desired !== "ON") throw new AppError("El WhatsApp de la plataforma está apagado. Vincúlalo antes de enviar.", 409);
  if (!kindEnabled(plan.session, BROADCAST_KIND)) throw new AppError("Los mensajes masivos están apagados en \"Qué se envía\".", 409);
  if (plan.nextAllowedAt) {
    const when = plan.nextAllowedAt.toLocaleString("es-ES", { timeZone: "America/Havana", dateStyle: "short", timeStyle: "short" });
    throw new AppError(`Solo se puede enviar un mensaje masivo cada 24 horas. El próximo, desde el ${when} (hora de Cuba).`, 429);
  }
  if (!plan.recipients.length) throw new AppError("Ninguna de esas tiendas tiene los avisos por WhatsApp activos.", 400);
  if (plan.recipients.length > plan.capacity) {
    throw new AppError(`Son ${plan.recipients.length} tiendas y con tus topes solo salen unas ${plan.capacity} en 48 horas. Elige menos tiendas o sube los topes.`, 400);
  }
  const batch = `M${crypto.randomBytes(3).toString("hex").toUpperCase()}`;
  let queued = 0;
  for (const vendor of plan.recipients) {
    if (await enqueueBroadcast({ vendor, message: input.message, url: input.url || null, batch })) queued += 1;
  }
  await logActivity({
    actorId: req.user.id, actorRole: "ADMIN", action: "whatsapp_broadcast",
    description: `Envió un mensaje masivo por WhatsApp (${batch}) a ${queued} tiendas: "${input.message.slice(0, 120)}"`,
  });
  res.status(201).json({ batch, queued, skipped: plan.recipients.length - queued, hours: plan.hours });
}

// Envíos masivos anteriores, con cuántos salieron, cuántos esperan y cuántos no salieron.
export async function listBroadcasts(req, res) {
  const rows = await prisma.whatsappMessage.groupBy({
    by: ["refCode", "status"],
    where: { kind: BROADCAST_KIND },
    _count: { _all: true },
    _min: { createdAt: true },
  });
  const batches = new Map();
  for (const r of rows) {
    const b = batches.get(r.refCode) ?? { batch: r.refCode, createdAt: r._min.createdAt, total: 0, sent: 0, pending: 0, notSent: 0 };
    b.total += r._count._all;
    if (r.status === "SENT") b.sent += r._count._all;
    else if (r.status === "PENDING" || r.status === "SENDING") b.pending += r._count._all;
    else b.notSent += r._count._all;
    if (r._min.createdAt < b.createdAt) b.createdAt = r._min.createdAt;
    batches.set(r.refCode, b);
  }
  const list = [...batches.values()].sort((a, b) => b.createdAt - a.createdAt).slice(0, 10);
  const samples = await Promise.all(
    list.map((b) => prisma.whatsappMessage.findFirst({ where: { kind: BROADCAST_KIND, refCode: b.batch }, select: { body: true } })),
  );
  res.json({ broadcasts: list.map((b, i) => ({ ...b, sample: samples[i]?.body ?? "" })) });
}

// Detiene lo que falta de un envío masivo (lo ya enviado no se puede deshacer).
export async function cancelBroadcast(req, res) {
  const { count } = await prisma.whatsappMessage.updateMany({
    where: { kind: BROADCAST_KIND, refCode: req.params.batch, status: "PENDING" },
    data: { status: "SKIPPED", lastError: "CANCELLED" },
  });
  await logActivity({
    actorId: req.user.id, actorRole: "ADMIN", action: "whatsapp_broadcast_cancelled",
    description: `Detuvo el mensaje masivo ${req.params.batch}: ${count} sin enviar.`,
  });
  res.json({ cancelled: count });
}
