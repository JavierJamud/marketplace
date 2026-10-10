import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { usageSummary, recentMovements, keysWithLive } from "../lib/partnerStats.js";
import { siteUrl, apiBase } from "../lib/partnerDto.js";
import { PARTNER_SCOPES } from "../lib/partnerScopes.js";
import { paginationQuerySchema, pageMeta } from "../lib/pagination.js";
import { z } from "zod";
import { plansForPartner } from "./partnerOrders.controller.js";
import { revealKeyValue } from "./partners.controller.js";
import { logActivity } from "../lib/activityLog.js";

// Panel del socio (/partner-portal). El socio ve sus métricas, su credencial completa (siempre visible), sus cuotas y
// movimientos, y fija el precio final de sus planes. NO puede crear, regenerar ni cambiar la credencial: eso solo lo hace
// el administrador de Baznova. El socio sale SIEMPRE de la sesión (Partner.userId), nunca de un id que mande el navegador.
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
    apiBase: apiBase(),
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

// La credencial vigente del socio. Siempre se puede volver a ver; regenerarla o cambiarla solo lo hace el administrador.
export async function getPortalApiKey(req, res) {
  const partner = await myPartner(req);
  const key = await prisma.partnerApiKey.findFirst({ where: { partnerId: partner.id, status: "ACTIVE" }, orderBy: { createdAt: "desc" } });
  if (!key) return res.json({ apiKey: null, reason: "none" });
  const apiKey = revealKeyValue(key);
  res.json({ apiKey, prefix: key.prefix, reason: apiKey ? null : "legacy", apiBase: apiBase() });
}

export async function getPortalPlans(req, res) {
  const partner = await myPartner(req);
  res.json({ plans: await plansForPartner(partner.id) });
}

// El socio fija el precio final de cada plan. Nunca puede quedar por debajo del precio base de Baznova:
// lo que pone por encima es su ganancia. Se guarda solo el extra (final menos base), así si Baznova cambia
// su precio base el extra del socio se conserva.
const planPriceBody = z.object({
  finalCup: z.coerce.number().min(0).max(100000000),
  finalUsd: z.coerce.number().min(0).max(1000000),
});

export async function setPortalPlanPrice(req, res) {
  const partner = await myPartner(req);
  const planType = z.enum(["REGULAR", "BUSINESS"]).parse(req.params.planType);
  const { finalCup, finalUsd } = planPriceBody.parse(req.body);
  const current = (await plansForPartner(partner.id)).find((p) => p.planType === planType);
  if (!current) throw new AppError("Plan no encontrado.", 404);
  if (finalCup < current.baseMonthly.cup || finalUsd < current.baseMonthly.usd) {
    throw new AppError(`El precio no puede ser menor que el de Baznova (${current.baseMonthly.cup} CUP y ${current.baseMonthly.usd} USD al mes). Solo puedes sumar un extra.`, 400);
  }
  const extraCup = Math.round((finalCup - current.baseMonthly.cup) * 100) / 100;
  const extraUsd = Math.round((finalUsd - current.baseMonthly.usd) * 100) / 100;
  await prisma.partnerPlanPrice.upsert({
    where: { partnerId_planType: { partnerId: partner.id, planType } },
    create: { partnerId: partner.id, planType, extraCup, extraUsd },
    update: { extraCup, extraUsd },
  });
  logActivity({ actorId: req.user.id, actorRole: "PARTNER", action: "partner_plan_price_set", description: `El socio "${partner.name}" fijó el precio del plan ${planType}`, meta: { partnerId: partner.id, planType, extraCup, extraUsd } });
  res.json({ plans: await plansForPartner(partner.id) });
}
