import { Prisma } from "@prisma/client";
import { env } from "../config/env.js";
import { prisma } from "../lib/prisma.js";
import { decryptSecret } from "../lib/crypto.js";
import { clearAuthState } from "./authStore.js";
import { createBaileysDriver } from "./drivers/baileys.js";
import { createMockDriver } from "./drivers/mock.js";
import { PRIORITY_BULK, PRIORITY_CODE, PRIORITY_NOTICE, SESSION_ID, enqueueDirect, getSession } from "./outbox.js";
import { normalizePhone } from "./phone.js";
import { OPT_OUT_REPLY } from "./templates.js";

// Proceso de WhatsApp. Corre aparte de la API (npm run whatsapp): mantiene la sesión abierta y envía la cola.
// La API y el panel del admin le hablan a través de la base de datos: la fila de WhatsappSession dice qué se
// quiere (desired) y este proceso escribe ahí lo que pasa (status, qr, phone). Debe haber uno solo corriendo.

const POLL_MS = 2000;
const HEARTBEAT_MS = 15_000;
const HOUSEKEEPING_MS = 60_000;
// Un QR sin escanear no se queda abierto para siempre.
const QR_TIMEOUT_MS = 5 * 60 * 1000;
const BACKOFF_SEC = [2, 5, 10, 30, 60];
// Otra sesión abrió con las mismas credenciales: insistir enseguida solo las hace pelear.
const REPLACED_WAIT_MS = 5 * 60 * 1000;
const MAX_ATTEMPTS = 3;
const RETRY_STEP_MS = 30_000;
// Tope propio de los códigos: no pasan por el límite de avisos del admin.
const CODES_PER_HOUR = 40;
const JID_CACHE_MS = 24 * 60 * 60 * 1000;
const IDLE_WAIT_MS = 1500;

const useMock = process.env.WHATSAPP_DRIVER === "mock" && env.nodeEnv !== "production";

let driver = null;
let connected = false;
let starting = false;
let stopping = false;
let attempt = 0;
let reconnectAt = 0;
let qrSince = 0;
const jidCache = new Map();

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const log = (...args) => console.log("[whatsapp]", ...args);

function setSession(data) {
  return prisma.whatsappSession.update({ where: { id: SESSION_ID }, data });
}

function guard(fn) {
  return (...args) => Promise.resolve(fn(...args)).catch((err) => console.error("[whatsapp] error:", err.message));
}

// ── Conexión ─────────────────────────────────────────────────────────────────────────────────────────────

const onQr = guard(async (qr) => {
  if (!qrSince) qrSince = Date.now();
  await setSession({ status: "QR", qr, qrAt: new Date() });
});

const onOpen = guard(async ({ phone, pushName }) => {
  connected = true;
  attempt = 0;
  qrSince = 0;
  log("conectado como", phone);
  await setSession({
    status: "CONNECTED", qr: null, qrAt: null, phone: normalizePhone(phone), pushName: pushName ?? null,
    connectedAt: new Date(), lastSeenAt: new Date(), lastError: null, downAlertAt: null,
  });
});

const onClose = guard(async ({ code, loggedOut }) => {
  connected = false;
  driver = null;
  if (loggedOut || code === 403) {
    // 401: alguien quitó el dispositivo desde el teléfono. 403: WhatsApp rechaza el número (puede estar bloqueado).
    // En los dos casos insistir no sirve: se apaga y el admin decide si vincula de nuevo.
    log(loggedOut ? "la sesión se cerró desde el teléfono" : "WhatsApp rechazó la conexión (403)");
    qrSince = 0;
    await clearAuthState();
    await setSession({
      status: "LOGGED_OUT", desired: "OFF", qr: null, qrAt: null, phone: null, pushName: null, connectedAt: null,
      lastError: loggedOut ? "LOGGED_OUT" : "BLOCKED",
    });
    return;
  }
  let wait;
  if (code === 515) wait = 0; // WhatsApp pide reiniciar justo después de escanear el QR: es parte normal del enlace.
  else if (code === 440) wait = REPLACED_WAIT_MS;
  else wait = BACKOFF_SEC[Math.min(attempt++, BACKOFF_SEC.length - 1)] * 1000;
  reconnectAt = Date.now() + wait;
  log(`conexión cerrada (${code ?? "sin código"}); reintento en ${Math.round(wait / 1000)} s`);
  await setSession({ status: "CONNECTING", qr: null, qrAt: null, lastError: code === 515 ? null : `CLOSED_${code ?? "UNKNOWN"}` });
});

// Respuestas que llegan al número. Solo se atiende BAJA (o STOP, que mucha gente escribe por costumbre): esa persona deja
// de recibir avisos. "Cancelar" no cuenta: un cliente lo puede escribir pensando en su pedido.
const onText = guard(async ({ phone: raw, text }) => {
  const phone = normalizePhone(raw);
  if (!phone || !/^(baja|stop)[\s.!]*$/i.test(text.trim())) return;
  const already = await prisma.whatsappOptOut.findUnique({ where: { phone } });
  if (already) return;
  await prisma.whatsappOptOut.create({ data: { phone } });
  await prisma.whatsappMessage.updateMany({
    where: { phone, status: "PENDING", priority: { gte: PRIORITY_NOTICE } },
    data: { status: "SKIPPED", lastError: "OPT_OUT" },
  });
  await enqueueDirect({ phone, kind: "optout", audience: "SYSTEM", body: OPT_OUT_REPLY, priority: 2, ttlMs: 10 * 60 * 1000 });
  log("baja de avisos:", phone);
});

async function teardown({ logout = false } = {}) {
  const current = driver;
  driver = null;
  connected = false;
  qrSince = 0;
  attempt = 0;
  reconnectAt = 0;
  if (!current) return;
  await (logout ? current.logout() : current.stop()).catch(() => {});
}

async function connect() {
  starting = true;
  try {
    await setSession({ status: "CONNECTING" });
    const created = (useMock ? createMockDriver : createBaileysDriver)({ onQr, onOpen, onClose, onText });
    driver = created;
    await created.start();
  } catch (err) {
    driver = null;
    const wait = BACKOFF_SEC[Math.min(attempt++, BACKOFF_SEC.length - 1)] * 1000;
    reconnectAt = Date.now() + wait;
    console.error("[whatsapp] no se pudo iniciar la conexión:", err.message);
    await setSession({ lastError: "START_FAILED" }).catch(() => {});
  } finally {
    starting = false;
  }
}

// Mira qué pidió el admin (vincular, apagar, desvincular) y lo cumple.
async function control() {
  const session = await getSession();

  if (session.desired === "LOGOUT") {
    await teardown({ logout: true });
    await clearAuthState();
    jidCache.clear();
    await setSession({ status: "DISCONNECTED", desired: "OFF", qr: null, qrAt: null, phone: null, pushName: null, connectedAt: null, lastError: null });
    log("desvinculado");
    return;
  }

  if (session.desired !== "ON") {
    if (driver) await teardown();
    if (!["DISCONNECTED", "LOGGED_OUT"].includes(session.status) || session.qr) {
      await setSession({ status: "DISCONNECTED", qr: null, qrAt: null });
    }
    return;
  }

  if (qrSince && Date.now() - qrSince > QR_TIMEOUT_MS) {
    await teardown();
    await setSession({ status: "DISCONNECTED", desired: "OFF", qr: null, qrAt: null, lastError: "QR_TIMEOUT" });
    log("nadie escaneó el QR a tiempo");
    return;
  }

  if (!driver && !starting && Date.now() >= reconnectAt) await connect();
}

// ── Envío ────────────────────────────────────────────────────────────────────────────────────────────────

async function underNoticeLimits(session) {
  const hourAgo = new Date(Date.now() - 60 * 60 * 1000);
  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const [hour, day] = await Promise.all([
    prisma.whatsappMessage.count({ where: { status: "SENT", priority: { gte: PRIORITY_NOTICE }, sentAt: { gt: hourAgo } } }),
    prisma.whatsappMessage.count({ where: { status: "SENT", priority: { gte: PRIORITY_NOTICE }, sentAt: { gt: dayAgo } } }),
  ]);
  // Los masivos solo usan la mitad del tope por hora y el 60 % del diario: el resto queda libre para los pedidos.
  return {
    notice: hour < session.hourlyLimit && day < session.dailyLimit,
    bulk: hour < Math.floor(session.hourlyLimit / 2) && day < Math.floor(session.dailyLimit * 0.6) && bulkHoursNow(),
  };
}

async function underCodeLimit() {
  const sent = await prisma.whatsappMessage.count({
    where: { status: "SENT", priority: { lte: PRIORITY_CODE }, sentAt: { gt: new Date(Date.now() - 60 * 60 * 1000) } },
  });
  return sent < CODES_PER_HOUR;
}

// Los mensajes masivos solo salen de 8:00 a 20:59, hora de Cuba: un mensaje que no es urgente a medianoche es el que la
// gente reporta como spam. Los avisos de pedidos y los códigos salen a cualquier hora porque alguien los está esperando.
const BULK_FROM_HOUR = 8;
const BULK_UNTIL_HOUR = 21;
function bulkHoursNow() {
  const hour = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: "America/Havana" }).format(new Date()));
  return hour >= BULK_FROM_HOUR && hour < BULK_UNTIL_HOUR;
}

function nextPending(where) {
  const now = new Date();
  return prisma.whatsappMessage.findFirst({
    where: { status: "PENDING", nextAttemptAt: { lte: now }, expiresAt: { gt: now }, ...where },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
}

async function jidFor(phone) {
  const hit = jidCache.get(phone);
  if (hit && Date.now() - hit.at < JID_CACHE_MS) return hit.jid;
  const jid = await driver.resolveJid(phone);
  // Un "no tiene WhatsApp" no se recuerda: la persona puede activarlo y probar otra vez enseguida.
  if (jid) jidCache.set(phone, { jid, at: Date.now() });
  return jid;
}

function finish(id, data) {
  return prisma.whatsappMessage.update({ where: { id }, data: { secret: Prisma.DbNull, ...data } });
}

// Envía el siguiente mensaje de la cola. Devuelve cuánto esperar antes del próximo.
async function sendNext() {
  if (!connected || !driver) return IDLE_WAIT_MS;
  const session = await getSession();

  // Primero lo urgente (códigos y respuestas): sale aunque los avisos estén en pausa.
  let message = null;
  if (await underCodeLimit()) message = await nextPending({ priority: { lt: PRIORITY_NOTICE } });
  if (!message && !session.paused) {
    const limits = await underNoticeLimits(session);
    if (limits.notice) message = await nextPending({ priority: limits.bulk ? { gte: PRIORITY_NOTICE } : { gte: PRIORITY_NOTICE, lt: PRIORITY_BULK } });
  }
  if (!message) return IDLE_WAIT_MS;

  const claimed = await prisma.whatsappMessage.updateMany({
    where: { id: message.id, status: "PENDING" },
    data: { status: "SENDING", attempts: { increment: 1 } },
  });
  if (!claimed.count) return 0;

  const isNotice = message.priority >= PRIORITY_NOTICE;
  const attempts = message.attempts + 1;
  try {
    if (isNotice && (await prisma.whatsappOptOut.findUnique({ where: { phone: message.phone } }))) {
      await finish(message.id, { status: "SKIPPED", lastError: "OPT_OUT" });
      return 0;
    }
    const jid = await jidFor(message.phone);
    if (!jid) {
      await finish(message.id, { status: "SKIPPED", lastError: "NO_WHATSAPP" });
      return 0;
    }
    const text = message.secret ? decryptSecret(message.secret) : message.body;
    const waMessageId = await driver.sendText(jid, text);
    await finish(message.id, { status: "SENT", sentAt: new Date(), waMessageId, lastError: null });
  } catch (err) {
    const lastError = String(err?.message ?? err).slice(0, 180);
    if (attempts >= MAX_ATTEMPTS) await finish(message.id, { status: "FAILED", lastError });
    else {
      await prisma.whatsappMessage.update({
        where: { id: message.id },
        data: { status: "PENDING", lastError, nextAttemptAt: new Date(Date.now() + RETRY_STEP_MS * attempts) },
      });
    }
    return IDLE_WAIT_MS;
  }

  // Pausa entre mensajes, distinta cada vez: un número que dispara ráfagas iguales es el que WhatsApp bloquea.
  if (!isNotice) return 700 + Math.random() * 800;
  // Los masivos van el doble de despacio que los avisos.
  const pace = message.priority >= PRIORITY_BULK ? 2 : 1;
  const min = Math.max(1, session.minDelaySec) * pace;
  const max = Math.max(min, session.maxDelaySec * pace);
  return (min + Math.random() * (max - min)) * 1000;
}

async function housekeeping() {
  await prisma.whatsappMessage.updateMany({
    where: { status: "PENDING", expiresAt: { lt: new Date() } },
    data: { status: "EXPIRED", secret: Prisma.DbNull },
  });
}

// ── Arranque y cierre ────────────────────────────────────────────────────────────────────────────────────

async function loop(fn, waitMs) {
  while (!stopping) {
    let wait = waitMs;
    try {
      const result = await fn();
      if (typeof result === "number") wait = result;
    } catch (err) {
      console.error("[whatsapp] error:", err.message);
    }
    await sleep(wait);
  }
}

async function shutdown() {
  if (stopping) return;
  stopping = true;
  log("cerrando");
  await teardown().catch(() => {});
  await setSession({ lastSeenAt: null }).catch(() => {});
  await prisma.$disconnect().catch(() => {});
  process.exit(0);
}

async function main() {
  if (process.env.WHATSAPP_DRIVER === "mock" && !useMock) {
    console.error("[whatsapp] el modo de prueba (WHATSAPP_DRIVER=mock) no se acepta en producción.");
    process.exit(1);
  }
  log(useMock ? "modo de prueba: no se conecta a WhatsApp de verdad" : "iniciando");

  // Dos procesos con la misma sesión se tumban la conexión entre sí: si otro está vivo, este espera.
  let warned = false;
  for (;;) {
    const session = await getSession();
    const fresh = session.lastSeenAt && Date.now() - new Date(session.lastSeenAt).getTime() < HEARTBEAT_MS + 5000;
    if (!fresh) break;
    if (!warned) log("hay otro proceso de WhatsApp activo; espero a que termine");
    warned = true;
    await sleep(3000);
  }

  await setSession({ lastSeenAt: new Date(), qr: null, qrAt: null });
  // Lo que quedó a medio enviar cuando el proceso anterior se cortó vuelve a la cola.
  await prisma.whatsappMessage.updateMany({ where: { status: "SENDING" }, data: { status: "PENDING" } });

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
  process.on("unhandledRejection", (err) => console.error("[whatsapp] error sin atender:", err?.message ?? err));

  loop(() => setSession({ lastSeenAt: new Date() }).then(() => undefined), HEARTBEAT_MS);
  loop(housekeeping, HOUSEKEEPING_MS);
  loop(control, POLL_MS);
  loop(sendNext, IDLE_WAIT_MS);
}

main().catch((err) => {
  console.error("[whatsapp] no pudo arrancar:", err);
  process.exit(1);
});
