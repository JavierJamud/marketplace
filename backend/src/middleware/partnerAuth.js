import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { hashKey, looksLikeApiKey, hostFromOrigin, domainMatches, ipMatches, normalizeIp } from "../lib/partnerKeys.js";
import { consumeQuota, recordUsage, noteAuthFailure, tooManyAuthFailures } from "../lib/partnerUsage.js";

const KEY_CACHE_MS = 30_000;
const keyCache = new Map(); // hash -> { at, key }

export function invalidatePartnerKeyCache() {
  keyCache.clear();
}

async function loadKey(hash) {
  const hit = keyCache.get(hash);
  if (hit && Date.now() - hit.at < KEY_CACHE_MS) return hit.key;
  const key = await prisma.partnerApiKey.findUnique({
    where: { keyHash: hash },
    include: { partner: { select: { id: true, name: true, code: true, status: true, listInMarketplace: true } } },
  });
  keyCache.set(hash, { at: Date.now(), key });
  if (keyCache.size > 5000) keyCache.clear();
  return key;
}

function consoleHosts() {
  return env.frontendUrls.map((u) => hostFromOrigin(u)).filter(Boolean);
}

// CORS propio de la API de socios: la defensa real es la llave + dominio/IP, no CORS, y nunca
// se usan cookies (sin credentials). Se refleja el origen para que el navegador pueda leer la
// respuesta; si el dominio no está permitido la solicitud ya se rechazó con 403 antes.
export function partnerCors(req, res, next) {
  const origin = req.headers.origin;
  if (origin) {
    res.setHeader("Access-Control-Allow-Origin", origin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Headers", "Authorization, X-Api-Key, Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET, POST, OPTIONS");
  res.setHeader("Access-Control-Expose-Headers", "X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset, X-DailyLimit-Limit, X-DailyLimit-Remaining, Retry-After");
  res.setHeader("Access-Control-Max-Age", "86400");
  if (req.method === "OPTIONS") return res.status(204).end();
  next();
}

function deny(res, status, code, message, headers) {
  if (headers) for (const [k, v] of Object.entries(headers)) res.setHeader(k, v);
  return res.status(status).json({ error: message, code });
}

export async function partnerAuth(req, res, next) {
  const started = Date.now();
  const ip = normalizeIp(req.ip) ?? req.ip ?? "desconocida";

  if (tooManyAuthFailures(ip)) {
    return deny(res, 429, "too_many_invalid_keys", "Demasiados intentos con llaves inválidas. Espera un minuto.", { "Retry-After": "60" });
  }

  const bearer = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7).trim() : null;
  const raw = bearer || (typeof req.headers["x-api-key"] === "string" ? req.headers["x-api-key"].trim() : null);
  if (!raw) {
    noteAuthFailure(ip);
    return deny(res, 401, "missing_key", "Falta la llave de la API. Envíala en el encabezado Authorization: Bearer TU_LLAVE.");
  }
  if (!looksLikeApiKey(raw)) {
    noteAuthFailure(ip);
    return deny(res, 401, "invalid_key", "La llave de la API no es válida.");
  }
  const key = await loadKey(hashKey(raw));
  if (!key) {
    noteAuthFailure(ip);
    return deny(res, 401, "invalid_key", "La llave de la API no es válida.");
  }
  if (key.status !== "ACTIVE") return deny(res, 401, "revoked_key", "Esta llave fue revocada.");
  if (key.expiresAt && key.expiresAt.getTime() < Date.now()) return deny(res, 401, "expired_key", "Esta llave venció.");
  if (key.partner.status !== "ACTIVE") return deny(res, 403, "partner_suspended", "La cuenta de socio está suspendida.");

  const origin = req.headers.origin ?? null;
  const host = hostFromOrigin(origin) ?? hostFromOrigin(req.headers.referer);
  const logOnly = (status) => {
    recordUsage({ partnerId: key.partnerId, keyId: key.id, endpoint: "(rechazada)", method: req.method, status, ms: Date.now() - started, ip, origin, counted: false });
  };

  let allowed = false;
  if (key.kind === "SERVER") {
    if (origin) {
      logOnly(403);
      return deny(res, 403, "secret_key_in_browser", "Las llaves de servidor no se pueden usar desde un navegador. Usa una llave de navegador.");
    }
    allowed = ipMatches(ip, key.allowedIps);
  } else {
    allowed = domainMatches(host, key.allowedDomains) || ipMatches(ip, key.allowedIps) || (!!host && consoleHosts().includes(host));
  }
  if (!allowed) {
    logOnly(403);
    return deny(
      res,
      403,
      "origin_not_allowed",
      key.kind === "SERVER" ? "Esta dirección IP no está autorizada para esta llave." : "Este sitio web no está autorizado para esta llave."
    );
  }

  const quota = await consumeQuota(key);
  for (const [k, v] of Object.entries(quota.headers)) res.setHeader(k, v);
  if (!quota.ok) {
    recordUsage({ partnerId: key.partnerId, keyId: key.id, endpoint: "(límite)", method: req.method, status: 429, ms: Date.now() - started, ip, origin, counted: false });
    return deny(
      res,
      429,
      quota.reason === "day" ? "daily_limit" : "rate_limit",
      quota.reason === "day" ? "Se alcanzó el límite diario de esta llave." : "Demasiadas solicitudes por minuto. Intenta de nuevo en unos segundos."
    );
  }

  req.partnerKey = key;
  req.partner = key.partner;
  res.on("finish", () => {
    const route = req.route?.path ? `${req.baseUrl.replace(/^\/partner\/v1/, "")}${req.route.path}` : req.path;
    recordUsage({
      partnerId: key.partnerId,
      keyId: key.id,
      endpoint: route || "/",
      method: req.method,
      status: res.statusCode,
      ms: Date.now() - started,
      ip,
      origin,
      counted: true,
    });
  });
  next();
}

export function requireScope(scope) {
  return (req, res, next) => {
    if (!req.partnerKey.scopes.includes(scope)) {
      return deny(res, 403, "scope_missing", `Esta llave no tiene permiso para este recurso (${scope}).`);
    }
    next();
  };
}
