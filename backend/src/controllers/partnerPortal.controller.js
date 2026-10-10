import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { usageSummary, recentMovements, keysWithLive } from "../lib/partnerStats.js";
import { siteUrl } from "../lib/partnerDto.js";
import { PARTNER_SCOPES } from "../lib/partnerScopes.js";
import { paginationQuerySchema, pageMeta } from "../lib/pagination.js";

// Bloque 299: API del panel del socio (/partner-portal). Solo lectura: el socio ve sus propias métricas,
// llaves (nunca el valor secreto: solo el prefijo), cuotas y movimientos. Crear o cambiar llaves lo sigue
// haciendo el administrador de Baznova. El socio sale SIEMPRE de la sesión (Partner.userId), nunca de un id
// que mande el navegador.
async function myPartner(req) {
  const partner = await prisma.partner.findUnique({ where: { userId: req.user.id } });
  if (!partner) throw new AppError("Tu cuenta no está vinculada a ningún socio.", 404);
  return partner;
}

export async function getPortalMe(req, res) {
  const partner = await myPartner(req);
  const stores = await prisma.vendor.count({ where: { partnerId: partner.id } });
  res.json({
    partner: { name: partner.name, code: partner.code, status: partner.status, contactEmail: partner.contactEmail, website: partner.website, listInMarketplace: partner.listInMarketplace, stores, signupUrl: `${siteUrl()}/vender?socio=${partner.code}` },
    docsUrl: `${siteUrl()}/api-socios`,
    apiBase: `${process.env.BACKEND_URL || "http://localhost:4000"}/partner/v1`,
    scopes: PARTNER_SCOPES.map(({ id, label, description, endpoints }) => ({ id, label, description, endpoints })),
  });
}

export async function getPortalOverview(req, res) {
  const partner = await myPartner(req);
  const days = Math.min(90, Math.max(1, Number(req.query.days) || 30));
  const [usage, keys] = await Promise.all([usageSummary(partner.id, days), keysWithLive(partner.id)]);
  res.json({ usage, keys });
}

export async function getPortalMovements(req, res) {
  const partner = await myPartner(req);
  const p = paginationQuerySchema.parse(req.query);
  const keyId = typeof req.query.keyId === "string" ? req.query.keyId : undefined;
  // Un filtro que no sea un código HTTP (p. ej. "abc") se ignora en vez de llegar a Prisma como NaN y dar 500.
  const rawStatus = Number(req.query.status);
  const status = Number.isInteger(rawStatus) && rawStatus >= 100 && rawStatus <= 599 ? rawStatus : undefined;
  const { total, rows } = await recentMovements(partner.id, { ...p, keyId, status });
  res.json({ movements: rows, ...pageMeta(p, total) });
}
