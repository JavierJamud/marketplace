// Bloque 260 / 286: descansos en memoria. Una clave inválida o un cobro pendiente
// (402) son de la cuenta: todo el proveedor descansa. Un límite agotado (429) es
// del modelo en Groq y Gemini (Bloque 286), así que solo ese modelo descansa y los
// demás de la misma API siguen. Este archivo guarda hasta cuándo descansa cada uno; getActiveProviders (ai.js) manda sus modelos al final de la
// cadena mientras dure, y cuando vence el plazo vuelve a probarse solo con
// tráfico real, en su orden normal de velocidad: así "se restablece" sin que
// nadie tenga que intervenir. Archivo hoja (sin imports) para que ai.js y las
// herramientas del asistente lo consuman sin ciclos.
//
// Vive en memoria a propósito: es una señal de "ahora mismo no vale la pena
// insistir", no un dato que deba sobrevivir a un reinicio (con el primer pedido
// real se vuelve a aprender sola).

const MIN_COOLDOWN_MS = 30_000;
const DEFAULT_QUOTA_COOLDOWN_MS = 5 * 60_000;
const DAILY_QUOTA_COOLDOWN_MS = 30 * 60_000;
const AUTH_COOLDOWN_MS = 10 * 60_000;
const MAX_COOLDOWN_MS = 60 * 60_000;

const cooldowns = new Map(); // provider -> { until, kind, reason }

// Los proveedores dicen cuándo reintentar dentro del cuerpo del error: Gemini
// "Please retry in 34.5s", Groq "Please try again in 7m12.5s". Si lo dicen, se
// respeta (con un colchón); si no, un plazo por defecto según el tipo de límite.
export function parseRetryDelayMs(text) {
  const raw = String(text || "");
  const m = raw.match(/(?:retry|try again)(?:\s+in)?\s+(?:(\d+)h)?\s*(?:(\d+)m(?!s))?\s*(?:([\d.]+)s)?/i);
  if (m && (m[1] || m[2] || m[3])) {
    const ms = (Number(m[1] || 0) * 3600 + Number(m[2] || 0) * 60 + Number(m[3] || 0)) * 1000;
    if (ms > 0) return ms;
  }
  return null;
}

export function cooldownFor(kind, detailText) {
  if (kind === "auth") return AUTH_COOLDOWN_MS;
  const hinted = parseRetryDelayMs(detailText);
  if (hinted) return Math.min(MAX_COOLDOWN_MS, Math.max(MIN_COOLDOWN_MS, hinted + 5_000));
  return /per ?day|daily|tokens per day|\bRPD\b|\bTPD\b/i.test(String(detailText || "")) ? DAILY_QUOTA_COOLDOWN_MS : DEFAULT_QUOTA_COOLDOWN_MS;
}

export function markProviderCooldown(provider, kind, detailText) {
  const ms = cooldownFor(kind, detailText);
  const until = Date.now() + ms;
  const current = cooldowns.get(provider);
  // Nunca se acorta un descanso que ya estaba corriendo.
  if (current && current.until > until) return current.until;
  cooldowns.set(provider, { until, kind, reason: String(detailText || "").slice(0, 160) });
  return until;
}

export function isProviderCoolingDown(provider) {
  const entry = cooldowns.get(provider);
  if (!entry) return false;
  if (entry.until <= Date.now()) {
    cooldowns.delete(provider);
    return false;
  }
  return true;
}

// Un pedido que salió bien prueba que la clave y la cuenta funcionan: se levanta solo el
// descanso del proveedor entero. Los descansos individuales de otros modelos siguen.
export function clearProviderLevelCooldown(provider) {
  cooldowns.delete(provider);
}

export function clearProviderCooldown(provider) {
  cooldowns.delete(provider);
  for (const key of [...modelCooldowns.keys()]) if (key.startsWith(`${provider}::`)) modelCooldowns.delete(key);
}

// Descanso por MODELO. En Groq y Gemini el límite gratis es de cada modelo, no de la
// cuenta: si uno se agota, los demás de la misma API siguen sirviendo. Solo una clave
// inválida o un cobro (402) afectan al proveedor entero, y esos usan el descanso de arriba.
const modelCooldowns = new Map(); // "provider::model" -> { until, kind, reason, at }
// NVIDIA no publica sus límites: si dos modelos distintos agotan el cupo en esta ventana,
// se trata como un límite de la cuenta y todo el proveedor descansa.
const ACCOUNT_LEVEL_WINDOW_MS = 10 * 60_000;
const ACCOUNT_LEVEL_MODELS = 2;
const UNPUBLISHED_LIMITS = new Set(["nvidia"]);

const modelKey = (provider, model) => `${provider}::${model}`;

// Un cobro pendiente o una clave mala son de la cuenta, nunca de un modelo.
export function isAccountLevelText(text) {
  return /\b402\b|prepayment|credits are depleted|billing|insufficient.?(quota|credit)/i.test(String(text || ""));
}

export function markModelCooldown(provider, model, kind, detailText) {
  const ms = cooldownFor(kind, detailText);
  const now = Date.now();
  const key = modelKey(provider, model);
  const current = modelCooldowns.get(key);
  const until = current && current.until > now + ms ? current.until : now + ms;
  modelCooldowns.set(key, { until, kind, reason: String(detailText || "").slice(0, 160), at: now });
  let escalated = false;
  if (UNPUBLISHED_LIMITS.has(provider) || isAccountLevelText(detailText)) {
    const recent = [...modelCooldowns.entries()].filter(([k, v]) => k.startsWith(`${provider}::`) && now - v.at < ACCOUNT_LEVEL_WINDOW_MS && v.until > now);
    if (isAccountLevelText(detailText) || recent.length >= ACCOUNT_LEVEL_MODELS) {
      markProviderCooldown(provider, kind, detailText);
      escalated = true;
    }
  }
  return { until, escalated };
}

export function isModelCoolingDown(provider, model) {
  const key = modelKey(provider, model);
  const entry = modelCooldowns.get(key);
  if (!entry) return false;
  if (entry.until <= Date.now()) {
    modelCooldowns.delete(key);
    return false;
  }
  return true;
}

export function clearModelCooldown(provider, model) {
  modelCooldowns.delete(modelKey(provider, model));
}

export function getModelCooldowns() {
  const now = Date.now();
  const out = [];
  for (const [key, entry] of modelCooldowns) {
    if (entry.until <= now) {
      modelCooldowns.delete(key);
      continue;
    }
    const [provider, model] = key.split("::");
    out.push({ provider, model, kind: entry.kind, secondsLeft: Math.ceil((entry.until - now) / 1000), reason: entry.reason });
  }
  return out;
}

export function getProviderCooldowns() {
  const now = Date.now();
  const out = [];
  for (const [provider, entry] of cooldowns) {
    if (entry.until <= now) {
      cooldowns.delete(provider);
      continue;
    }
    out.push({ provider, kind: entry.kind, secondsLeft: Math.ceil((entry.until - now) / 1000), reason: entry.reason });
  }
  return out;
}
