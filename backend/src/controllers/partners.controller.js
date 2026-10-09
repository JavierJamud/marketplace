import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { logActivity } from "../lib/activityLog.js";
import { generateApiKey, normalizeDomain, normalizeIp } from "../lib/partnerKeys.js";
import {
  PARTNER_SCOPES,
  PARTNER_SCOPE_IDS,
  DEFAULT_PARTNER_SCOPES,
  DEFAULT_RATE_PER_MINUTE,
  DEFAULT_DAILY_LIMIT,
  MAX_RATE_PER_MINUTE,
  MAX_DAILY_LIMIT,
} from "../lib/partnerScopes.js";
import { invalidatePartnerKeyCache } from "../middleware/partnerAuth.js";
import { usageSummary, recentMovements, keysWithLive } from "../lib/partnerStats.js";
import { siteUrl } from "../lib/partnerDto.js";
import { paginationQuerySchema, pageArgs, pageMeta } from "../lib/pagination.js";

// Sección "Socios de la API" del panel de administrador.

const CODE_RE = /^[A-Z0-9][A-Z0-9-]{2,23}$/;

export function codeFromName(name) {
  return String(name)
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 24);
}

const partnerBody = z.object({
  name: z.string().trim().min(2).max(80),
  code: z.string().trim().toUpperCase().regex(CODE_RE, "El código admite letras, números y guion, de 3 a 24 caracteres.").optional(),
  contactEmail: z.string().trim().toLowerCase().email().max(120),
  contactName: z.string().trim().max(80).optional().nullable(),
  website: z.string().trim().max(200).optional().nullable(),
  listInMarketplace: z.boolean().optional(),
  notes: z.string().trim().max(1000).optional().nullable(),
});

const listDomains = (arr) => {
  const out = [];
  for (const d of arr) {
    const n = normalizeDomain(d);
    if (!n) throw new AppError(`El dominio "${d}" no es válido. Escríbelo sin ruta, por ejemplo mitienda.com o *.mitienda.com.`, 400);
    if (!out.includes(n)) out.push(n);
  }
  return out;
};
const listIps = (arr) => {
  const out = [];
  for (const i of arr) {
    const n = normalizeIp(i);
    if (!n) throw new AppError(`La dirección IP "${i}" no es válida.`, 400);
    if (!out.includes(n)) out.push(n);
  }
  return out;
};

const keyFields = {
  name: z.string().trim().min(2).max(60),
  scopes: z.array(z.enum(PARTNER_SCOPE_IDS)).min(1, "Elige al menos un permiso."),
  rateLimitPerMinute: z.coerce.number().int().min(1).max(MAX_RATE_PER_MINUTE),
  dailyLimit: z.coerce.number().int().min(1).max(MAX_DAILY_LIMIT),
  allowedDomains: z.array(z.string().max(253)).max(20),
  allowedIps: z.array(z.string().max(45)).max(20),
  expiresAt: z.coerce.date().nullable(),
};
const createKeyBody = z.object({
  name: keyFields.name,
  kind: z.enum(["BROWSER", "SERVER"]),
  scopes: keyFields.scopes.default(DEFAULT_PARTNER_SCOPES),
  rateLimitPerMinute: keyFields.rateLimitPerMinute.default(DEFAULT_RATE_PER_MINUTE),
  dailyLimit: keyFields.dailyLimit.default(DEFAULT_DAILY_LIMIT),
  allowedDomains: keyFields.allowedDomains.default([]),
  allowedIps: keyFields.allowedIps.default([]),
  expiresAt: keyFields.expiresAt.optional(),
});
const updateKeyBody = z.object({
  name: keyFields.name.optional(),
  scopes: keyFields.scopes.optional(),
  rateLimitPerMinute: keyFields.rateLimitPerMinute.optional(),
  dailyLimit: keyFields.dailyLimit.optional(),
  allowedDomains: keyFields.allowedDomains.optional(),
  allowedIps: keyFields.allowedIps.optional(),
  expiresAt: keyFields.expiresAt.optional(),
});

function assertKeyRestrictions(kind, domains, ips) {
  if (kind === "SERVER" && ips.length === 0) throw new AppError("Una llave de servidor necesita al menos una dirección IP autorizada.", 400);
  if (kind === "SERVER" && domains.length > 0) throw new AppError("Una llave de servidor se autoriza por IP, no por dominio.", 400);
  if (kind === "BROWSER" && domains.length === 0 && ips.length === 0) throw new AppError("Una llave de navegador necesita al menos un dominio autorizado.", 400);
}

async function getPartnerOr404(id) {
  const partner = await prisma.partner.findUnique({ where: { id } });
  if (!partner) throw new AppError("Socio no encontrado.", 404);
  return partner;
}

export function listScopes(_req, res) {
  res.json({ scopes: PARTNER_SCOPES, defaults: { rateLimitPerMinute: DEFAULT_RATE_PER_MINUTE, dailyLimit: DEFAULT_DAILY_LIMIT } });
}

export async function listPartners(req, res) {
  const p = paginationQuerySchema.parse(req.query);
  const q = typeof req.query.q === "string" ? req.query.q.trim() : "";
  const where = q
    ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { code: { contains: q, mode: "insensitive" } }, { contactEmail: { contains: q, mode: "insensitive" } }] }
    : {};
  const startToday = new Date();
  startToday.setUTCHours(0, 0, 0, 0);
  const [total, rows] = await Promise.all([
    prisma.partner.count({ where }),
    prisma.partner.findMany({
      where,
      orderBy: { createdAt: "desc" },
      ...pageArgs(p),
      include: { _count: { select: { vendors: true, keys: { where: { status: "ACTIVE" } } } } },
    }),
  ]);
  const ids = rows.map((r) => r.id);
  const today = ids.length
    ? await prisma.partnerApiUsageHour.groupBy({ by: ["partnerId"], where: { partnerId: { in: ids }, hour: { gte: startToday } }, _sum: { requests: true } })
    : [];
  const todayBy = new Map(today.map((t) => [t.partnerId, t._sum.requests ?? 0]));
  res.json({
    partners: rows.map(({ _count, ...r }) => ({ ...r, stores: _count.vendors, activeKeys: _count.keys, requestsToday: todayBy.get(r.id) ?? 0, signupUrl: `${siteUrl()}/vender?socio=${r.code}` })),
    ...pageMeta(p, total),
  });
}

export async function createPartner(req, res) {
  const data = partnerBody.parse(req.body);
  const code = data.code ?? codeFromName(data.name);
  if (!CODE_RE.test(code)) throw new AppError("No se pudo generar un código válido; escríbelo a mano (3 a 24 letras, números o guion).", 400);
  if (await prisma.partner.findUnique({ where: { code } })) throw new AppError(`El código ${code} ya está en uso.`, 409);
  const partner = await prisma.partner.create({
    data: { name: data.name, code, contactEmail: data.contactEmail, contactName: data.contactName || null, website: data.website || null, listInMarketplace: data.listInMarketplace ?? true, notes: data.notes || null },
  });
  logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "partner_created", description: `Creó el socio de la API "${partner.name}" (${partner.code})`, meta: { partnerId: partner.id } });
  res.status(201).json({ partner: { ...partner, signupUrl: `${siteUrl()}/vender?socio=${partner.code}` } });
}

export async function getPartner(req, res) {
  const partner = await getPartnerOr404(req.params.id);
  const [keys, usage, stores] = await Promise.all([
    keysWithLive(partner.id),
    usageSummary(partner.id, 30),
    prisma.vendor.count({ where: { partnerId: partner.id } }),
  ]);
  res.json({ partner: { ...partner, signupUrl: `${siteUrl()}/vender?socio=${partner.code}`, stores }, keys, usage });
}

export async function updatePartner(req, res) {
  const partner = await getPartnerOr404(req.params.id);
  const data = partnerBody.partial().extend({ status: z.enum(["ACTIVE", "SUSPENDED"]).optional() }).parse(req.body);
  if (data.code && data.code !== partner.code) {
    // Cambiar el código rompería los enlaces de socio ya repartidos.
    throw new AppError("El código del socio no se puede cambiar: ya está en sus enlaces.", 400);
  }
  const { code: _ignore, ...rest } = data;
  const updated = await prisma.partner.update({ where: { id: partner.id }, data: rest });
  invalidatePartnerKeyCache();
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    action: data.status && data.status !== partner.status ? (data.status === "SUSPENDED" ? "partner_suspended" : "partner_reactivated") : "partner_updated",
    description: `Actualizó el socio "${updated.name}" (${updated.code})`,
    meta: { partnerId: partner.id },
  });
  res.json({ partner: updated });
}

export async function createKey(req, res) {
  const partner = await getPartnerOr404(req.params.id);
  const data = createKeyBody.parse(req.body);
  const allowedDomains = listDomains(data.allowedDomains);
  const allowedIps = listIps(data.allowedIps);
  assertKeyRestrictions(data.kind, allowedDomains, allowedIps);
  const gen = generateApiKey(data.kind);
  const key = await prisma.partnerApiKey.create({
    data: {
      partnerId: partner.id,
      name: data.name,
      kind: data.kind,
      prefix: gen.prefix,
      keyHash: gen.hash,
      scopes: data.scopes,
      rateLimitPerMinute: data.rateLimitPerMinute,
      dailyLimit: data.dailyLimit,
      allowedDomains,
      allowedIps,
      expiresAt: data.expiresAt ?? null,
    },
  });
  logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "partner_key_created", description: `Creó la llave "${key.name}" para el socio "${partner.name}"`, meta: { partnerId: partner.id, keyId: key.id } });
  const { keyHash, ...safe } = key;
  // Única vez que se muestra la llave completa.
  res.status(201).json({ key: safe, secret: gen.raw });
}

export async function updateKey(req, res) {
  const key = await prisma.partnerApiKey.findFirst({ where: { id: req.params.keyId, partnerId: req.params.id } });
  if (!key) throw new AppError("Llave no encontrada.", 404);
  if (key.status === "REVOKED") throw new AppError("Una llave revocada no se puede modificar.", 400);
  const data = updateKeyBody.parse(req.body);
  const allowedDomains = data.allowedDomains ? listDomains(data.allowedDomains) : key.allowedDomains;
  const allowedIps = data.allowedIps ? listIps(data.allowedIps) : key.allowedIps;
  assertKeyRestrictions(key.kind, allowedDomains, allowedIps);
  const updated = await prisma.partnerApiKey.update({
    where: { id: key.id },
    data: {
      name: data.name,
      scopes: data.scopes,
      rateLimitPerMinute: data.rateLimitPerMinute,
      dailyLimit: data.dailyLimit,
      allowedDomains,
      allowedIps,
      expiresAt: data.expiresAt === undefined ? undefined : data.expiresAt,
    },
  });
  invalidatePartnerKeyCache();
  logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "partner_key_updated", description: `Cambió la llave "${updated.name}"`, meta: { partnerId: key.partnerId, keyId: key.id } });
  const { keyHash, ...safe } = updated;
  res.json({ key: safe });
}

export async function revokeKey(req, res) {
  const key = await prisma.partnerApiKey.findFirst({ where: { id: req.params.keyId, partnerId: req.params.id } });
  if (!key) throw new AppError("Llave no encontrada.", 404);
  if (key.status === "REVOKED") return res.json({ ok: true });
  await prisma.partnerApiKey.update({ where: { id: key.id }, data: { status: "REVOKED", revokedAt: new Date() } });
  invalidatePartnerKeyCache();
  logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "partner_key_revoked", description: `Revocó la llave "${key.name}"`, meta: { partnerId: key.partnerId, keyId: key.id } });
  res.json({ ok: true });
}

export async function getPartnerUsage(req, res) {
  const partner = await getPartnerOr404(req.params.id);
  const days = z.coerce.number().int().min(1).max(90).default(30).parse(req.query.days);
  res.json({ usage: await usageSummary(partner.id, days) });
}

export async function getPartnerMovements(req, res) {
  const partner = await getPartnerOr404(req.params.id);
  const p = paginationQuerySchema.parse(req.query);
  const keyId = typeof req.query.keyId === "string" ? req.query.keyId : undefined;
  const status = req.query.status ? z.coerce.number().int().parse(req.query.status) : undefined;
  const { total, rows } = await recentMovements(partner.id, { ...p, keyId, status });
  res.json({ movements: rows, ...pageMeta(p, total) });
}
