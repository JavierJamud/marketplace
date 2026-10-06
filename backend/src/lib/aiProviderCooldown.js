// Bloque 260 (pedido explícito — "si se consume la cuota de una API, en vez de
// cambiar a otro modelo de la misma API, debe saltar a otra de las API de
// respaldo y seguir probando hasta que la principal se restablezca"): cuando un
// proveedor responde "cuota agotada" (429) o "clave inválida", TODOS sus modelos
// comparten ese problema (la cuota y la clave son de la cuenta, no del modelo),
// así que probar otro modelo del mismo proveedor solo gasta tiempo en otro
// fallo seguro. Este archivo guarda en memoria hasta cuándo se deja descansar a
// cada proveedor; getActiveProviders (ai.js) manda sus modelos al final de la
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

export function clearProviderCooldown(provider) {
  cooldowns.delete(provider);
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
