import crypto from "node:crypto";

// Bloque 273 (pedido explícito — verificación en dos pasos con aplicación autenticadora,
// para clientes, tiendas y admin): TOTP estándar (RFC 6238, el que usan Google
// Authenticator, Microsoft Authenticator, Authy y 1Password): HMAC-SHA1, pasos de 30 s,
// 6 dígitos. Sin librerías externas: son ~40 líneas y evita una dependencia más.
const ALPHABET = "ABCDEFGHIJKLMNOPQRSTUVWXYZ234567";
const STEP_SECONDS = 30;
const DIGITS = 6;

export function base32Encode(buffer) {
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of buffer) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5) {
      out += ALPHABET[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  if (bits > 0) out += ALPHABET[(value << (5 - bits)) & 31];
  return out;
}

export function base32Decode(text) {
  let bits = 0;
  let value = 0;
  const out = [];
  for (const char of String(text).replace(/=+$/, "").toUpperCase()) {
    const index = ALPHABET.indexOf(char);
    if (index === -1) continue;
    value = (value << 5) | index;
    bits += 5;
    if (bits >= 8) {
      out.push((value >>> (bits - 8)) & 255);
      bits -= 8;
    }
  }
  return Buffer.from(out);
}

export function generateTotpSecret() {
  return base32Encode(crypto.randomBytes(20)); // 160 bits, el tamaño que recomienda el RFC
}

export function totpAt(secret, step) {
  const counter = Buffer.alloc(8);
  counter.writeBigUInt64BE(BigInt(step));
  const hmac = crypto.createHmac("sha1", base32Decode(secret)).update(counter).digest();
  const offset = hmac[hmac.length - 1] & 15;
  const binary = ((hmac[offset] & 127) << 24) | (hmac[offset + 1] << 16) | (hmac[offset + 2] << 8) | hmac[offset + 3];
  return String(binary % 10 ** DIGITS).padStart(DIGITS, "0");
}

export function currentStep(now = Date.now()) {
  return Math.floor(now / 1000 / STEP_SECONDS);
}

// Devuelve el paso (número) en que el código es válido, o null. Acepta el paso actual y el
// anterior/siguiente (relojes un poco desfasados) y rechaza cualquier paso <= lastStep: un
// código ya usado no sirve de nuevo aunque siga dentro de su ventana (anti-repetición).
export function verifyTotp(secret, code, lastStep = null, now = Date.now()) {
  const clean = String(code ?? "").replace(/\s+/g, "");
  if (!/^\d{6}$/.test(clean)) return null;
  const base = currentStep(now);
  for (const delta of [0, -1, 1]) {
    const step = base + delta;
    if (lastStep != null && step <= lastStep) continue;
    const expected = Buffer.from(totpAt(secret, step));
    const given = Buffer.from(clean);
    if (expected.length === given.length && crypto.timingSafeEqual(expected, given)) return step;
  }
  return null;
}

export function otpauthUrl({ secret, account, issuer }) {
  const label = encodeURIComponent(`${issuer}:${account}`);
  return `otpauth://totp/${label}?secret=${secret}&issuer=${encodeURIComponent(issuer)}&algorithm=SHA1&digits=${DIGITS}&period=${STEP_SECONDS}`;
}
