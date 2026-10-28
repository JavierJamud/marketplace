import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { getPlanConfig } from "../lib/planConfig.js";
import { verifyUnsubscribe } from "../lib/marketingEmail.js";
import { activeProgramFor, serializeProgram, suggestionsFor, adjustPoints, touchStoreVisit, pointsWorth, programCost, programCostError, LOYALTY_LIMITS } from "../services/loyalty.service.js";
import { notifyPointsAdjusted } from "../services/loyaltyNotify.service.js";

const HISTORY_LIMIT = 100;
const TX_SELECT = { id: true, type: true, points: true, balanceAfter: true, orderCode: true, note: true, createdAt: true };

// --- Cliente ----------------------------------------------------------------

// Programa de una tienda tal como lo ve un visitante (aviso en la tienda y en el checkout). null = no tiene.
export async function getPublicProgram(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.vendorId }, select: { id: true, planType: true, currency: true } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);
  const program = await activeProgramFor(vendor);
  res.json({ program: program ? { ...program, currency: vendor.currency } : null });
}

// Saldo del cliente en una tienda y las reglas del programa, para el checkout.
export async function getMyBalanceAtVendor(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.vendorId }, select: { id: true, planType: true, currency: true } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);
  const program = await activeProgramFor(vendor);
  const account = await prisma.loyaltyAccount.findUnique({ where: { vendorId_userId: { vendorId: vendor.id, userId: req.user.id } }, select: { balance: true } });
  res.json({ program: program ? { ...program, currency: vendor.currency } : null, balance: account?.balance ?? 0 });
}

// "Mis puntos": una fila por tienda donde el cliente tiene o tuvo puntos.
export async function listMyAccounts(req, res) {
  const accounts = await prisma.loyaltyAccount.findMany({
    where: { userId: req.user.id, OR: [{ balance: { gt: 0 } }, { lifetimeEarned: { gt: 0 } }] },
    include: {
      vendor: {
        select: { id: true, companyName: true, slug: true, logoUrl: true, color: true, currency: true, planType: true, status: true, isBlocked: true, deletedAt: true, loyaltyProgram: true },
      },
    },
    orderBy: [{ balance: "desc" }, { updatedAt: "desc" }],
  });
  const rows = [];
  for (const a of accounts) {
    if (a.vendor.deletedAt) continue;
    const program = a.vendor.status === "ACTIVE" && !a.vendor.isBlocked ? await activeProgramFor(a.vendor) : null;
    const saved = serializeProgram(a.vendor.loyaltyProgram);
    rows.push({
      vendor: { id: a.vendor.id, name: a.vendor.companyName, slug: a.vendor.slug, logoUrl: a.vendor.logoUrl, color: a.vendor.color, currency: a.vendor.currency },
      balance: a.balance,
      value: pointsWorth(saved, a.balance),
      lifetimeEarned: a.lifetimeEarned,
      lifetimeRedeemed: a.lifetimeRedeemed,
      // Si la tienda apagó el programa, el saldo se conserva pero no se puede usar hasta que lo vuelva a encender.
      programActive: !!program,
      minRedeemPoints: program?.minRedeemPoints ?? null,
      updatedAt: a.updatedAt,
    });
  }
  res.json({ accounts: rows });
}

export async function getMyHistory(req, res) {
  const account = await prisma.loyaltyAccount.findUnique({ where: { vendorId_userId: { vendorId: req.params.vendorId, userId: req.user.id } }, select: { id: true } });
  if (!account) return res.json({ transactions: [] });
  const transactions = await prisma.loyaltyTransaction.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: HISTORY_LIMIT, select: TX_SELECT });
  res.json({ transactions });
}

// Visita a un producto de la tienda (la página de la tienda ya la registra trackEngagement en vendors.controller.js).
export async function recordStoreVisit(req, res) {
  const { vendorId } = z.object({ vendorId: z.string().min(1).max(40) }).parse(req.body);
  if (req.user.role !== "CUSTOMER") return res.status(204).send();
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true } });
  if (vendor) await touchStoreVisit(req.user.id, vendor.id);
  res.status(204).send();
}

export async function getEmailPreferences(req, res) {
  const user = await prisma.user.findUnique({ where: { id: req.user.id }, select: { marketingEmails: true } });
  res.json({ marketingEmails: user?.marketingEmails ?? true });
}

export async function updateEmailPreferences(req, res) {
  const { marketingEmails } = z.object({ marketingEmails: z.boolean() }).parse(req.body);
  await prisma.user.update({ where: { id: req.user.id }, data: { marketingEmails } });
  res.json({ marketingEmails });
}

// Enlace "dejar de recibir estos correos" del pie de los recordatorios: funciona sin sesión, con la firma del enlace.
export async function unsubscribe(req, res) {
  const { u, t } = z.object({ u: z.string().min(1).max(40), t: z.string().min(1).max(64) }).parse(req.body);
  if (!verifyUnsubscribe(u, t)) throw new AppError("El enlace no es válido. Puedes apagar estos correos desde tu perfil.", 400);
  await prisma.user.updateMany({ where: { id: u }, data: { marketingEmails: false } });
  res.json({ ok: true });
}

// --- Tienda -----------------------------------------------------------------

const tierSchema = z.object({ minTotal: z.number().positive().max(1e9), bonusPoints: z.number().int().min(1).max(1_000_000) });
const programSchema = z
  .object({
    enabled: z.boolean(),
    earnPerAmount: z.number().positive("El monto para ganar puntos tiene que ser mayor que 0.").max(1e9),
    earnPoints: z.number().int().min(1, "Da al menos 1 punto.").max(1_000_000),
    bonusTiers: z.array(tierSchema).max(5, "Puedes tener hasta 5 bonos."),
    valuePoints: z.number().int().min(1, "Escribe cuántos puntos.").max(10_000_000),
    valueAmount: z.number().positive("Escribe cuánto dinero equivalen esos puntos.").max(1e9),
    valueOrder: z.enum(["AMOUNT_FIRST", "POINTS_FIRST"]),
    minRedeemPoints: z.number().int().min(1).max(10_000_000),
    // El resto del pedido siempre se paga con dinero (LOYALTY_LIMITS en loyalty.service.js).
    maxRedeemPercent: z.number().int().min(1).max(LOYALTY_LIMITS.maxRedeemPercent, `Con puntos se paga como mucho el ${LOYALTY_LIMITS.maxRedeemPercent} % del pedido.`),
    marginPercent: z.number().int().min(1).max(95).nullable().optional(),
  })
  // Un punto que valga menos de una diezmilésima no se puede cobrar ni mostrar con sentido.
  .refine((d) => d.valueAmount / d.valuePoints >= 0.0001, { message: "Cada punto tiene que valer al menos 0,0001.", path: ["valueAmount"] });

async function programStats(vendorId) {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const [agg, members, redeemed30, earned30] = await Promise.all([
    prisma.loyaltyAccount.aggregate({ where: { vendorId }, _sum: { balance: true } }),
    prisma.loyaltyAccount.count({ where: { vendorId, balance: { gt: 0 } } }),
    prisma.loyaltyTransaction.aggregate({ where: { account: { vendorId }, type: "REDEEM", createdAt: { gte: since } }, _sum: { points: true }, _count: { _all: true } }),
    prisma.loyaltyTransaction.aggregate({ where: { account: { vendorId }, type: "EARN", createdAt: { gte: since } }, _sum: { points: true } }),
  ]);
  return {
    pointsOutstanding: agg._sum.balance ?? 0,
    membersWithPoints: members,
    redeemedPoints30d: -(redeemed30._sum.points ?? 0),
    ordersWithPoints30d: redeemed30._count._all,
    earnedPoints30d: earned30._sum.points ?? 0,
  };
}

export async function getMyProgram(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const [row, plan, stats, suggestions] = await Promise.all([
    prisma.loyaltyProgram.findUnique({ where: { vendorId: vendor.id } }),
    getPlanConfig(vendor.planType),
    programStats(vendor.id),
    suggestionsFor(vendor),
  ]);
  const program = serializeProgram(row);
  res.json({ program, cost: programCost(program), limits: LOYALTY_LIMITS, configured: !!row, planAllows: plan?.allowLoyalty !== false, currency: vendor.currency ?? "CUP", stats, suggestions });
}

export async function saveMyProgram(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const data = programSchema.parse(req.body);
  const plan = await getPlanConfig(vendor.planType);
  if (data.enabled && plan?.allowLoyalty === false) throw new AppError("Tu plan actual no incluye el programa de fidelidad.", 403);
  // Nunca se guarda un programa que le haga perder dinero a la tienda.
  const costError = programCostError(data);
  if (costError) throw new AppError(costError, 400);
  const fields = { ...data, pointValue: data.valueAmount / data.valuePoints, bonusTiers: [...data.bonusTiers].sort((a, b) => a.minTotal - b.minTotal) };
  const saved = await prisma.loyaltyProgram.upsert({ where: { vendorId: vendor.id }, create: { vendorId: vendor.id, ...fields }, update: fields });
  const program = serializeProgram(saved);
  res.json({ program, cost: programCost(program) });
}

export async function listMyMembers(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const q = String(req.query.q ?? "").trim().slice(0, 80);
  const accounts = await prisma.loyaltyAccount.findMany({
    where: {
      vendorId: vendor.id,
      ...(q ? { user: { OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }] } } : {}),
    },
    include: { user: { select: { id: true, fullName: true, email: true } } },
    orderBy: [{ balance: "desc" }, { updatedAt: "desc" }],
    take: 100,
  });
  res.json({
    members: accounts.map((a) => ({ userId: a.user.id, name: a.user.fullName, email: a.user.email, balance: a.balance, lifetimeEarned: a.lifetimeEarned, lifetimeRedeemed: a.lifetimeRedeemed, updatedAt: a.updatedAt })),
  });
}

// Clientes con cuenta que ya compraron en la tienda y todavía no tienen puntos: para poder regalarles los primeros.
export async function listEligibleCustomers(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const q = String(req.query.q ?? "").trim().slice(0, 80);
  if (q.length < 2) return res.json({ customers: [] });
  const users = await prisma.user.findMany({
    where: {
      role: "CUSTOMER",
      orders: { some: { vendorId: vendor.id } },
      OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }],
    },
    select: { id: true, fullName: true, email: true },
    take: 10,
  });
  res.json({ customers: users.map((u) => ({ userId: u.id, name: u.fullName, email: u.email })) });
}

export async function getMemberHistory(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const account = await prisma.loyaltyAccount.findUnique({ where: { vendorId_userId: { vendorId: vendor.id, userId: req.params.userId } }, select: { id: true } });
  if (!account) return res.json({ transactions: [] });
  const transactions = await prisma.loyaltyTransaction.findMany({ where: { accountId: account.id }, orderBy: { createdAt: "desc" }, take: HISTORY_LIMIT, select: TX_SELECT });
  res.json({ transactions });
}

// Ajuste manual. Solo a clientes que ya compraron en la tienda con su cuenta: así una tienda no puede crear saldos a
// cualquier usuario de la plataforma.
export async function adjustMemberPoints(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { userId, points, note } = z
    .object({
      userId: z.string().min(1).max(40),
      points: z
        .number()
        .int()
        .refine((n) => n !== 0, "Indica cuántos puntos sumar o quitar.")
        .refine((n) => Math.abs(n) <= 1_000_000, "Son demasiados puntos de una vez."),
      note: z.string().trim().min(3, "Escribe el motivo del ajuste.").max(200),
    })
    .parse(req.body);
  const bought = await prisma.order.findFirst({ where: { vendorId: vendor.id, customerId: userId, customer: { role: "CUSTOMER" } }, select: { id: true } });
  if (!bought) throw new AppError("Solo puedes ajustar puntos a clientes que ya te compraron con su cuenta.", 400);
  const balance = await adjustPoints({ vendorId: vendor.id, userId, points, note });
  // El cliente se entera del regalo o de la corrección, con el motivo.
  void notifyPointsAdjusted({ vendorId: vendor.id, userId, points, note }).catch((err) => console.error("[loyalty] aviso de ajuste:", err?.message));
  res.json({ balance });
}
