import { createHash, randomBytes } from "node:crypto";
import { isIP } from "node:net";

const PREFIX = { BROWSER: "bzp_pub_", SERVER: "bzp_sec_" };

export function hashKey(rawKey) {
  return createHash("sha256").update(String(rawKey)).digest("hex");
}

// Devuelve la llave completa (se muestra una sola vez), su huella y un prefijo para reconocerla.
export function generateApiKey(kind) {
  const raw = `${PREFIX[kind] ?? PREFIX.SERVER}${randomBytes(24).toString("hex")}`;
  return { raw, hash: hashKey(raw), prefix: raw.slice(0, PREFIX.BROWSER.length + 6) };
}

export function looksLikeApiKey(value) {
  return typeof value === "string" && /^bzp_(pub|sec)_[0-9a-f]{48}$/.test(value);
}

// "https://www.MiTienda.com/ruta" -> "www.mitienda.com"; "*.mitienda.com" se conserva.
export function normalizeDomain(input) {
  let v = String(input ?? "").trim().toLowerCase();
  if (!v) return null;
  v = v.replace(/^https?:\/\//, "").split("/")[0].split("?")[0];
  const wildcard = v.startsWith("*.");
  if (wildcard) v = v.slice(2);
  v = v.replace(/:\d+$/, "");
  if (!/^(?=.{1,253}$)([a-z0-9]([a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(v) && v !== "localhost") return null;
  return wildcard ? `*.${v}` : v;
}

export function normalizeIp(input) {
  let v = String(input ?? "").trim();
  if (!v) return null;
  if (v.startsWith("::ffff:") && isIP(v.slice(7)) === 4) v = v.slice(7);
  return isIP(v) ? v.toLowerCase() : null;
}

export function hostFromOrigin(originOrReferer) {
  if (!originOrReferer) return null;
  try {
    return new URL(originOrReferer).hostname.toLowerCase();
  } catch {
    return null;
  }
}

export function domainMatches(host, allowedDomains) {
  if (!host) return false;
  return allowedDomains.some((d) => {
    if (d.startsWith("*.")) {
      const base = d.slice(2);
      return host.endsWith(`.${base}`);
    }
    return host === d;
  });
}

export function ipMatches(ip, allowedIps) {
  const n = normalizeIp(ip);
  return !!n && allowedIps.includes(n);
}
