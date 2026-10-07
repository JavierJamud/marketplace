import { prisma } from "./prisma.js";

// Bloque 280 (pedido explícito — "las API de IA deben mantenerse SIEMPRE en su
// consumo gratis: cuando una se acerca a su límite se rota a la siguiente, y así
// hasta que se restablezcan; nunca pasarse"): este archivo lleva la cuenta del
// consumo real de cada proveedor+modelo y decide si todavía se puede usar.
//
// De dónde sale cada número:
// - Groq manda en CADA respuesta cabeceras x-ratelimit-* con el límite, lo que
//   queda y cuándo se renueva (pedidos por día y tokens por minuto). Esas cifras
//   son de la propia API y mandan sobre cualquier cuenta local.
// - NVIDIA a veces las manda; si no, se cuenta aquí (su plan gratis es por minuto).
// - Gemini no las manda en las respuestas buenas: se cuenta aquí contra el límite
//   gratis conocido del modelo, y cuando responde 429 su mensaje trae el límite
//   real ("limit: 250"), que se guarda y pasa a ser el límite usado.
// El admin puede corregir los límites gratis de cada proveedor en Integraciones.
//
// Regla de seguridad: un modelo deja de usarse cuando le queda el MARGEN (10 %,
// mínimo 1 pedido) de su cupo, no cuando ya lo agotó. Así nunca se llega al
// tope, que es donde algunos proveedores empiezan a cobrar.
//
// Archivo hoja (solo prisma): lo importan ai.js, los clientes de cada proveedor,
// aiProviderHealth.js y los controllers sin crear ciclos.

export const AI_PRIORITY = ["groq", "nvidia", "gemini"];

// Límites del plan gratis usados mientras la API no informe los suyos (publicados por
// cada proveedor, junio 2026). Son conservadores a propósito; la cifra real de la API
// los reemplaza en cuanto llega.
//  - Groq manda sus límites reales en cada respuesta (pedidos por día y tokens por minuto).
//  - NVIDIA (build.nvidia.com) da 40 pedidos por minuto gratis, sin cupo diario.
//  - Gemini NO informa su consumo por la API: Google solo lo muestra en
//    aistudio.google.com/rate-limit (o en la consola de Google Cloud). Aquí se cuenta
//    contra el límite gratis publicado de cada familia de modelos. Además lleva un tope
//    de seguridad de tokens por día: si la clave fuera de un proyecto CON facturación
//    (donde no existe plan gratis y todo se cobra), el gasto queda acotado.
export const DEFAULT_FREE_LIMITS = {
  groq: { rpm: 30, rpd: 1000, tpm: 6000, tpd: 100000 },
  nvidia: { rpm: 40, rpd: null, tpm: null, tpd: null },
  gemini: { rpm: 10, rpd: 250, tpm: 250000, tpd: 300000 },
};

// Límites propios de algunos modelos (por nombre).
function modelFreeLimits(provider, model) {
  const id = String(model || "").toLowerCase();
  if (provider === "groq" && id.startsWith("whisper")) return { rpm: 20, rpd: 2000, tpm: null, tpd: null };
  if (provider === "groq" && /8b|instant/.test(id)) return { rpm: 30, rpd: 14400, tpm: 6000, tpd: 500000 };
  if (provider === "gemini" && /flash-lite/.test(id)) return { rpm: 15, rpd: 1000 };
  return {};
}

const SAFETY_RATIO = 0.1;
const MINUTE_MS = 60_000;
const QUOTA_TIMEZONE = "America/Los_Angeles"; // Gemini reinicia su cupo diario a medianoche del Pacífico.
const PERSIST_DEBOUNCE_MS = 3_000;

const state = new Map(); // "provider::model" -> entry
const overrides = new Map(); // provider -> { rpm, rpd, tpm, tpd }
let loaded = null;
const dirty = new Set();
let persistTimer = null;

const keyOf = (provider, model) => `${provider}::${model}`;

function nextMidnightPacific(from = Date.now()) {
  const fmt = new Intl.DateTimeFormat("en-US", { timeZone: QUOTA_TIMEZONE, hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23" });
  const [h, m, s] = fmt.format(new Date(from)).split(":").map(Number);
  const elapsed = ((h * 60 + m) * 60 + s) * 1000;
  return from - elapsed + 24 * 3600 * 1000;
}

function freshEntry(provider, model) {
  return {
    provider,
    model,
    minuteHits: [], // [{ at, tokens }]
    day: { used: 0, tokens: 0, resetAt: nextMidnightPacific() },
    api: null, // { limitRequests, remainingRequests, requestsResetAt, requestsWindow, limitTokens, remainingTokens, tokensResetAt, tokensWindow, at }
    learned: {}, // límites leídos de un 429 { rpd, tpd, rpm, tpm }
    blockedUntil: 0,
    blockedReason: null,
    lastCallAt: null,
    lastOkAt: null,
  };
}

async function ensureLoaded() {
  if (!loaded) {
    loaded = (async () => {
      try {
        const rows = await prisma.aiUsage.findMany();
        for (const row of rows) {
          if (row.model === "*") {
            overrides.set(row.provider, row.data ?? {});
            continue;
          }
          const entry = { ...freshEntry(row.provider, row.model), ...(row.data ?? {}) };
          entry.minuteHits = Array.isArray(entry.minuteHits) ? entry.minuteHits : [];
          state.set(keyOf(row.provider, row.model), entry);
        }
      } catch (err) {
        console.error("[aiQuota] no se pudo leer el consumo guardado:", err?.message);
      }
    })();
  }
  return loaded;
}

function schedulePersist(key) {
  dirty.add(key);
  if (persistTimer) return;
  persistTimer = setTimeout(async () => {
    persistTimer = null;
    const keys = [...dirty];
    dirty.clear();
    for (const k of keys) {
      const entry = state.get(k);
      if (!entry) continue;
      try {
        await prisma.aiUsage.upsert({
          where: { provider_model: { provider: entry.provider, model: entry.model } },
          create: { provider: entry.provider, model: entry.model, data: entry },
          update: { data: entry },
        });
      } catch (err) {
        console.error("[aiQuota] no se pudo guardar el consumo:", err?.message);
      }
    }
  }, PERSIST_DEBOUNCE_MS);
  persistTimer.unref?.();
}

function getEntry(provider, model) {
  const key = keyOf(provider, model);
  let entry = state.get(key);
  if (!entry) {
    entry = freshEntry(provider, model);
    state.set(key, entry);
  }
  const now = Date.now();
  if (entry.day.resetAt <= now) entry.day = { used: 0, tokens: 0, resetAt: nextMidnightPacific(now) };
  entry.minuteHits = entry.minuteHits.filter((h) => now - h.at < MINUTE_MS);
  if (entry.api) {
    if (entry.api.requestsResetAt && entry.api.requestsResetAt <= now) {
      entry.api.remainingRequests = entry.api.limitRequests;
      entry.api.requestsResetAt = null;
    }
    if (entry.api.tokensResetAt && entry.api.tokensResetAt <= now) {
      entry.api.remainingTokens = entry.api.limitTokens;
      entry.api.tokensResetAt = null;
    }
  }
  return entry;
}

// "2m59.56s", "7.66s", "120ms", "1h2m", o un número de segundos.
export function parseDurationMs(raw) {
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d+(\.\d+)?$/.test(s)) return Number(s) * 1000;
  const m = s.match(/^(?:(\d+)h)?(?:(\d+)m(?!s))?(?:([\d.]+)s)?(?:(\d+)ms)?$/);
  if (!m || !(m[1] || m[2] || m[3] || m[4])) return null;
  return (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) * 1000 + Number(m[4] || 0);
}

function readHeader(headers, name) {
  try {
    return headers?.get?.(name) ?? null;
  } catch {
    return null;
  }
}

function numberOrNull(v) {
  if (v == null || v === "") return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

// Una ventana que se renueva en 2 minutos o menos es "por minuto"; más que eso, "por día".
const windowOf = (resetMs) => (resetMs != null && resetMs <= 120_000 ? "minute" : "day");

function absorbHeaders(entry, headers) {
  const limitRequests = numberOrNull(readHeader(headers, "x-ratelimit-limit-requests"));
  const remainingRequests = numberOrNull(readHeader(headers, "x-ratelimit-remaining-requests"));
  const requestsResetMs = parseDurationMs(readHeader(headers, "x-ratelimit-reset-requests"));
  const limitTokens = numberOrNull(readHeader(headers, "x-ratelimit-limit-tokens"));
  const remainingTokens = numberOrNull(readHeader(headers, "x-ratelimit-remaining-tokens"));
  const tokensResetMs = parseDurationMs(readHeader(headers, "x-ratelimit-reset-tokens"));
  if (limitRequests == null && limitTokens == null) return false;
  const now = Date.now();
  entry.api = {
    limitRequests,
    remainingRequests,
    requestsResetAt: requestsResetMs != null ? now + requestsResetMs : null,
    requestsWindow: limitRequests != null ? (requestsResetMs != null ? windowOf(requestsResetMs) : "day") : null,
    limitTokens,
    remainingTokens,
    tokensResetAt: tokensResetMs != null ? now + tokensResetMs : null,
    tokensWindow: limitTokens != null ? (tokensResetMs != null ? windowOf(tokensResetMs) : "minute") : null,
    at: now,
  };
  return true;
}

// Mensajes de 429: Groq "Limit 100000, Used 99812, Requested 900 ... tokens per day (TPD)",
// Gemini "quotaValue": "250" con un quotaId "...PerDay...". Se guarda el límite real.
function learnFromQuotaError(entry, text) {
  const s = String(text || "");
  const perDay = /per ?day|\bTPD\b|\bRPD\b|PerDay/i.test(s);
  const tokens = /token/i.test(s);
  const limit = numberOrNull(s.match(/Limit\s*:?\s*(\d+)/i)?.[1] ?? s.match(/"quotaValue"\s*:\s*"?(\d+)/i)?.[1] ?? s.match(/limit:\s*(\d+)/i)?.[1]);
  if (limit != null) {
    const field = `${tokens ? "t" : "r"}${perDay ? "pd" : "pm"}`;
    entry.learned[field] = limit;
  }
  return perDay;
}

function retryHintMs(text) {
  const s = String(text || "");
  const m = s.match(/(?:retry|try again)(?:\s+in)?\s+((?:\d+h)?\s*(?:\d+m(?!s))?\s*(?:[\d.]+s)?)/i);
  if (m) return parseDurationMs(m[1].replace(/\s+/g, ""));
  const d = s.match(/"retryDelay"\s*:\s*"([\d.]+)s"/);
  return d ? Number(d[1]) * 1000 : null;
}

function effectiveLimits(provider, model) {
  return {
    ...(DEFAULT_FREE_LIMITS[provider] ?? {}),
    ...modelFreeLimits(provider, model),
    ...Object.fromEntries(Object.entries(overrides.get(provider) ?? {}).filter(([, v]) => v != null)),
  };
}

function margin(limit) {
  return Math.max(1, Math.ceil(limit * SAFETY_RATIO));
}

// Resumen de un proveedor+modelo: cuánto lleva, cuánto le queda y cuándo se renueva.
function describe(entry) {
  const now = Date.now();
  const limits = effectiveLimits(entry.provider, entry.model);
  const learned = entry.learned ?? {};
  const api = entry.api && entry.api.at && now - entry.api.at < 24 * 3600 * 1000 ? entry.api : null;
  const minuteUsed = entry.minuteHits.length;
  const minuteTokens = entry.minuteHits.reduce((a, h) => a + (h.tokens || 0), 0);
  const oldestMinute = entry.minuteHits[0]?.at;

  const windows = [];
  const add = (w) => {
    if (w.limit == null || w.limit <= 0) return;
    const remaining = Math.max(0, w.remaining ?? w.limit - w.used);
    windows.push({ ...w, remaining, used: w.used ?? Math.max(0, w.limit - remaining), nearLimit: remaining <= margin(w.limit) });
  };

  // Pedidos por día
  if (api?.requestsWindow === "day") {
    add({ kind: "requests", period: "day", limit: api.limitRequests, remaining: api.remainingRequests, used: null, resetAt: api.requestsResetAt, source: "api" });
  } else {
    const rpd = learned.rpd ?? limits.rpd;
    if (rpd) add({ kind: "requests", period: "day", limit: rpd, used: entry.day.used, resetAt: entry.day.resetAt, source: learned.rpd ? "api" : "estimado" });
  }
  // Pedidos por minuto
  if (api?.requestsWindow === "minute") {
    add({ kind: "requests", period: "minute", limit: api.limitRequests, remaining: api.remainingRequests, used: null, resetAt: api.requestsResetAt, source: "api" });
  } else {
    const rpm = learned.rpm ?? limits.rpm;
    if (rpm) add({ kind: "requests", period: "minute", limit: rpm, used: minuteUsed, resetAt: oldestMinute ? oldestMinute + MINUTE_MS : null, source: learned.rpm ? "api" : "estimado" });
  }
  // Tokens por minuto
  if (api?.tokensWindow === "minute") {
    add({ kind: "tokens", period: "minute", limit: api.limitTokens, remaining: api.remainingTokens, used: null, resetAt: api.tokensResetAt, source: "api" });
  } else {
    const tpm = learned.tpm ?? limits.tpm;
    if (tpm) add({ kind: "tokens", period: "minute", limit: tpm, used: minuteTokens, resetAt: oldestMinute ? oldestMinute + MINUTE_MS : null, source: learned.tpm ? "api" : "estimado" });
  }
  // Tokens por día (contados aquí; ninguna API los manda en cada respuesta)
  const tpd = api?.tokensWindow === "day" ? api.limitTokens : learned.tpd ?? limits.tpd;
  if (tpd) {
    if (api?.tokensWindow === "day") add({ kind: "tokens", period: "day", limit: api.limitTokens, remaining: api.remainingTokens, used: null, resetAt: api.tokensResetAt, source: "api" });
    else add({ kind: "tokens", period: "day", limit: tpd, used: entry.day.tokens, resetAt: entry.day.resetAt, source: learned.tpd ? "api" : "estimado" });
  }

  const blocked = entry.blockedUntil > now;
  const stoppers = windows.filter((w) => w.nearLimit);
  const available = !blocked && stoppers.length === 0;
  const resumesAt = blocked
    ? Math.max(entry.blockedUntil, ...stoppers.map((w) => w.resetAt ?? 0))
    : stoppers.length
      ? Math.max(...stoppers.map((w) => w.resetAt ?? now + MINUTE_MS))
      : null;
  // Uso del cupo más apretado, de 0 a 1: sirve para ordenar "el que menos consumió primero".
  const usageRatio = windows.length ? Math.max(...windows.map((w) => (w.limit - w.remaining) / w.limit)) : 0;

  return {
    provider: entry.provider,
    model: entry.model,
    available,
    reason: blocked ? entry.blockedReason || "La API pidió esperar." : stoppers.length ? "Cerca del límite gratis" : null,
    resumesAt: resumesAt ? new Date(resumesAt).toISOString() : null,
    usageRatio,
    windows: windows.map((w) => ({ ...w, resetAt: w.resetAt ? new Date(w.resetAt).toISOString() : null })),
    todayRequests: entry.day.used,
    todayTokens: entry.day.tokens,
    lastCallAt: entry.lastCallAt ? new Date(entry.lastCallAt).toISOString() : null,
    lastOkAt: entry.lastOkAt ? new Date(entry.lastOkAt).toISOString() : null,
  };
}

export async function getQuotaStatus(provider, model) {
  await ensureLoaded();
  return describe(getEntry(provider, model));
}

export async function isWithinFreeQuota(provider, model) {
  return (await getQuotaStatus(provider, model)).available;
}

// Se llama después de CADA respuesta de un proveedor (buena o mala). `tokens` es el
// total que informó la API (usage.total_tokens / usageMetadata.totalTokenCount).
export async function recordAiResponse({ provider, model, headers, status, tokens = 0, errorText = "" }) {
  await ensureLoaded();
  const entry = getEntry(provider, model);
  const now = Date.now();
  entry.lastCallAt = now;
  const tokenCount = Number.isFinite(tokens) ? tokens : 0;
  // Un 429 no consume cupo, pero sí dice que el cupo se acabó.
  if (status !== 429 && status !== 402) {
    entry.minuteHits.push({ at: now, tokens: tokenCount });
    entry.day.used += 1;
    entry.day.tokens += tokenCount;
  }
  absorbHeaders(entry, headers);
  if (status >= 200 && status < 300) {
    entry.lastOkAt = now;
    if (entry.blockedUntil && entry.blockedUntil <= now) entry.blockedUntil = 0;
  }
  // 402 = la cuenta pide pago (p. ej. Gemini "prepayment credits are depleted"): la
  // clave es de un proyecto con facturación. Nunca se insiste: queda fuera hasta el
  // día siguiente, y el panel avisa que hace falta una clave del plan gratis.
  if (status === 402) {
    entry.blockedUntil = Math.max(entry.blockedUntil || 0, entry.day.resetAt);
    entry.blockedReason = "La cuenta pide pago (sin cupo gratis): usa una clave de un proyecto con plan gratis.";
    void disablePaidProvider(provider, errorText);
  }
  if (status === 429) {
    const perDay = learnFromQuotaError(entry, errorText);
    const hint = retryHintMs(errorText);
    // Un límite DIARIO agotado no vuelve en los segundos que sugiere la API (ese
    // "retry" es para el límite por minuto): se espera a que se renueve el día.
    const until = perDay ? Math.max(entry.day.resetAt, now + (hint ?? 0)) : hint ? now + hint + 5_000 : now + MINUTE_MS;
    entry.blockedUntil = Math.max(entry.blockedUntil || 0, until);
    entry.blockedReason = perDay ? "Se agotó el cupo gratis del día." : "Se llegó al límite gratis por minuto.";
  }
  schedulePersist(keyOf(provider, model));
}

// Para pedidos que la propia app decide no hacer por estar cerca del límite: no cuentan.
export async function getProviderQuotaOverview(provider, models) {
  await ensureLoaded();
  return Promise.all(models.map((m) => getQuotaStatus(provider, m)));
}

export async function getFreeLimitOverrides(provider) {
  await ensureLoaded();
  return { defaults: DEFAULT_FREE_LIMITS[provider] ?? {}, overrides: overrides.get(provider) ?? {} };
}

export async function setFreeLimitOverrides(provider, values) {
  await ensureLoaded();
  const clean = {};
  for (const k of ["rpm", "rpd", "tpm", "tpd"]) {
    const v = values?.[k];
    clean[k] = v == null || v === "" ? null : Math.max(1, Math.floor(Number(v)));
  }
  overrides.set(provider, clean);
  await prisma.aiUsage.upsert({
    where: { provider_model: { provider, model: "*" } },
    create: { provider, model: "*", data: clean },
    update: { data: clean },
  });
  return clean;
}

// Bloque 281 (pedido explícito — "Gemini gastó 10 USD en minutos; eso no puede volver
// a pasar"): un 402 significa que la clave es de una cuenta de PAGO. El proveedor se
// apaga en Integraciones en ese mismo momento y se avisa al admin; solo vuelve a
// usarse cuando el admin ponga una clave del plan gratis y lo active a mano.
async function disablePaidProvider(provider, errorText) {
  try {
    const { count } = await prisma.integration.updateMany({ where: { name: provider, isActive: true }, data: { isActive: false } });
    if (count === 0) return;
    const { notifyAdminActionNeeded } = await import("./adminNotify.js");
    await notifyAdminActionNeeded(
      `Se apagó ${provider}: su clave es de pago`,
      `${provider} respondió que la cuenta no tiene saldo o pide pago (error 402). Eso significa que la clave es de un proyecto con facturación, donde no hay plan gratis y cada consulta se cobra.\n\n` +
        `Para no generar más gastos, ${provider} quedó DESACTIVADO en Admin → Integraciones. Para volver a usarlo, crea una clave en un proyecto SIN facturación (plan gratis), guárdala y actívalo.\n\nDetalle: ${String(errorText || "").slice(0, 300)}`
    );
  } catch (err) {
    console.error(`[aiQuota] no se pudo apagar ${provider} tras el 402:`, err?.message);
  }
}

// Exportado solo para pruebas.
export function __resetQuotaStateForTests() {
  state.clear();
  overrides.clear();
  loaded = Promise.resolve();
}
