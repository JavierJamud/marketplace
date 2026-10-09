import { prisma } from "./prisma.js";

// Contadores en memoria de la API de socios (el backend corre como UN solo proceso PM2).
//  - por minuto: ventana fija de 60 s por llave
//  - por día: día UTC; al arrancar el servidor se rehidrata sumando lo ya registrado hoy
// Todo lo que pasa por la API se anota en un buffer y se vuelca a la base cada pocos segundos
// (nunca una escritura por solicitud) en PartnerApiLog (movimientos, 30 días) y
// PartnerApiUsageHour (totales por hora y endpoint, para siempre).

const MINUTE_MS = 60_000;
const FLUSH_EVERY_MS = 3_000;
const FLUSH_AT = 500;
const MAX_BUFFER = 20_000;
const LOG_RETENTION_DAYS = 30;

const minuteWindows = new Map(); // keyId -> { start, count }
const dayCounters = new Map(); // keyId -> { day, count, ready: Promise }
const authFails = new Map(); // ip -> { start, count }
let buffer = [];
let flushing = false;
let lastCleanup = 0;

function utcDay(d = new Date()) {
  return d.toISOString().slice(0, 10);
}

function startOfUtcDay(d = new Date()) {
  return new Date(`${utcDay(d)}T00:00:00.000Z`);
}

async function hydrateDay(keyId, day) {
  const agg = await prisma.partnerApiUsageHour.aggregate({
    where: { keyId, hour: { gte: new Date(`${day}T00:00:00.000Z`) } },
    _sum: { requests: true },
  });
  const pending = buffer.filter((e) => e.keyId === keyId && e.counted && utcDay(e.createdAt) === day).length;
  return (agg._sum.requests ?? 0) + pending;
}

function dayEntry(keyId) {
  const today = utcDay();
  let e = dayCounters.get(keyId);
  if (!e || e.day !== today) {
    e = { day: today, count: 0, ready: null };
    e.ready = hydrateDay(keyId, today).then((n) => {
      e.count += n;
    });
    dayCounters.set(keyId, e);
  }
  return e;
}

// Cuenta la solicitud contra los límites de la llave. Devuelve { ok, reason, headers }.
export async function consumeQuota(key, now = Date.now()) {
  let w = minuteWindows.get(key.id);
  if (!w || now - w.start >= MINUTE_MS) {
    w = { start: now, count: 0 };
    minuteWindows.set(key.id, w);
  }
  w.count += 1;
  const resetSec = Math.max(1, Math.ceil((w.start + MINUTE_MS - now) / 1000));

  const d = dayEntry(key.id);
  await d.ready;

  const minuteLeft = Math.max(0, key.rateLimitPerMinute - w.count);
  const dayLeftBefore = Math.max(0, key.dailyLimit - d.count);
  const headers = {
    "X-RateLimit-Limit": String(key.rateLimitPerMinute),
    "X-RateLimit-Remaining": String(minuteLeft),
    "X-RateLimit-Reset": String(resetSec),
    "X-DailyLimit-Limit": String(key.dailyLimit),
  };

  if (w.count > key.rateLimitPerMinute) {
    headers["Retry-After"] = String(resetSec);
    headers["X-DailyLimit-Remaining"] = String(dayLeftBefore);
    return { ok: false, reason: "minute", headers };
  }
  if (d.count >= key.dailyLimit) {
    const toMidnight = Math.ceil((startOfUtcDay(new Date(now + 86_400_000)).getTime() - now) / 1000);
    headers["Retry-After"] = String(toMidnight);
    headers["X-DailyLimit-Remaining"] = "0";
    return { ok: false, reason: "day", headers };
  }
  d.count += 1;
  headers["X-DailyLimit-Remaining"] = String(Math.max(0, key.dailyLimit - d.count));
  return { ok: true, headers };
}

// Estado en vivo de una llave (para el panel): lo que lleva hoy y en el minuto actual.
export async function liveCounters(key, now = Date.now()) {
  const w = minuteWindows.get(key.id);
  const minuteCount = w && now - w.start < MINUTE_MS ? w.count : 0;
  const d = dayEntry(key.id);
  await d.ready;
  return {
    minuteUsed: minuteCount,
    minuteLimit: key.rateLimitPerMinute,
    minuteRemaining: Math.max(0, key.rateLimitPerMinute - minuteCount),
    dayUsed: d.count,
    dayLimit: key.dailyLimit,
    dayRemaining: Math.max(0, key.dailyLimit - d.count),
    dayResetsAt: startOfUtcDay(new Date(now + 86_400_000)).toISOString(),
  };
}

// Freno contra quien prueba llaves al azar: demasiados intentos inválidos desde una IP.
const AUTH_FAIL_LIMIT = 120;
export function tooManyAuthFailures(ip, now = Date.now()) {
  const w = authFails.get(ip);
  return !!w && now - w.start < MINUTE_MS && w.count >= AUTH_FAIL_LIMIT;
}
export function noteAuthFailure(ip, now = Date.now()) {
  let w = authFails.get(ip);
  if (!w || now - w.start >= MINUTE_MS) {
    w = { start: now, count: 0 };
    authFails.set(ip, w);
  }
  w.count += 1;
}

export function recordUsage(entry) {
  if (buffer.length >= MAX_BUFFER) buffer.shift();
  buffer.push({ ...entry, createdAt: entry.createdAt ?? new Date() });
  if (buffer.length >= FLUSH_AT) void flushUsage();
}

export async function flushUsage() {
  if (flushing || buffer.length === 0) return;
  flushing = true;
  const batch = buffer;
  buffer = [];
  try {
    await prisma.partnerApiLog.createMany({
      data: batch.map(({ counted, ...e }) => e),
    });

    const groups = new Map();
    const lastUsed = new Map();
    for (const e of batch) {
      // Las rechazadas antes de contar (dominio/IP no permitido, límite 429) quedan en el
      // movimiento reciente pero no suman a los totales: así el contador del día coincide
      // exactamente con lo registrado tras reiniciar el servidor.
      if (!e.counted) continue;
      const hour = new Date(e.createdAt);
      hour.setUTCMinutes(0, 0, 0);
      const k = `${e.keyId}|${hour.toISOString()}|${e.endpoint}`;
      const g = groups.get(k) ?? { keyId: e.keyId, partnerId: e.partnerId, hour, endpoint: e.endpoint, requests: 0, errors: 0, ms: 0 };
      g.requests += 1;
      if (e.status >= 400) g.errors += 1;
      g.ms += e.ms;
      groups.set(k, g);
      const prev = lastUsed.get(e.keyId);
      if (!prev || prev < e.createdAt) lastUsed.set(e.keyId, e.createdAt);
    }
    for (const g of groups.values()) {
      await prisma.$executeRaw`
        INSERT INTO "PartnerApiUsageHour" ("keyId","hour","endpoint","partnerId","requests","errors","totalMs")
        VALUES (${g.keyId}, ${g.hour}, ${g.endpoint}, ${g.partnerId}, ${g.requests}, ${g.errors}, ${g.ms})
        ON CONFLICT ("keyId","hour","endpoint") DO UPDATE SET
          "requests" = "PartnerApiUsageHour"."requests" + EXCLUDED."requests",
          "errors" = "PartnerApiUsageHour"."errors" + EXCLUDED."errors",
          "totalMs" = "PartnerApiUsageHour"."totalMs" + EXCLUDED."totalMs"`;
    }
    for (const [keyId, at] of lastUsed) {
      await prisma.partnerApiKey.updateMany({ where: { id: keyId }, data: { lastUsedAt: at } });
    }
  } catch (err) {
    // Mejor esfuerzo: se devuelven al buffer (con tope) para el próximo intento.
    buffer = [...batch, ...buffer].slice(-MAX_BUFFER);
    console.error("[partner-api] no se pudo volcar el uso:", err?.message ?? err);
  } finally {
    flushing = false;
  }

  const now = Date.now();
  if (now - lastCleanup > 3_600_000) {
    lastCleanup = now;
    const cutoff = new Date(now - LOG_RETENTION_DAYS * 86_400_000);
    prisma.partnerApiLog.deleteMany({ where: { createdAt: { lt: cutoff } } }).catch(() => {});
    for (const [k, w] of minuteWindows) if (now - w.start > 5 * MINUTE_MS) minuteWindows.delete(k);
    for (const [k, w] of authFails) if (now - w.start > 5 * MINUTE_MS) authFails.delete(k);
  }
}

export function startPartnerUsageFlusher() {
  const t = setInterval(() => void flushUsage(), FLUSH_EVERY_MS);
  t.unref?.();
  const stop = async () => {
    clearInterval(t);
    await flushUsage();
  };
  process.once("SIGTERM", () => void stop());
  process.once("SIGINT", () => void stop());
  return stop;
}

// Solo para pruebas.
export function _resetPartnerUsageForTests() {
  minuteWindows.clear();
  dayCounters.clear();
  authFails.clear();
  buffer = [];
}
