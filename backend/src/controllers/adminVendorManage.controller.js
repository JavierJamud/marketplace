import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getPlanConfig } from "../lib/planConfig.js";
import { describeUserAgent } from "../lib/userAgent.js";
import { getTrialChecklist } from "../services/trialEligibility.service.js";

// Página "Gestionar" de una tienda en el admin (/admin/tiendas/:id): todo lo de esa tienda en un solo lugar. Reemplaza el
// menú de tres puntos de la lista. Solo lectura; las acciones (editar, plan, bloquear, eliminar) usan las rutas de siempre.
const DAY = 24 * 60 * 60 * 1000;

export async function getVendorManage(req, res) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true, lastLoginAt: true, createdAt: true } },
      verification: { select: { paymentMethod: true, paymentConfirmedAt: true } },
      locations: { include: { province: true, country: true } },
      category: { select: { name: true } },
      businessCategory: { select: { name: true } },
      staff: { include: { user: { select: { id: true, fullName: true, email: true, lastLoginAt: true } } } },
      loyaltyProgram: { select: { enabled: true } },
      _count: {
        select: {
          products: true,
          schedules: true,
          tables: true,
          discountCodes: true,
          storeOffers: true,
          orders: true,
        },
      },
    },
  });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const userIds = [vendor.userId, ...vendor.staff.map((s) => s.userId)];
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);

  const [plan, checklist, sessions, trustedDevices, activity, activeProducts, orders30, chatQuestions30, assistantQuestions30, posSales30, errors] = await Promise.all([
    getPlanConfig(vendor.planType),
    getTrialChecklist(vendor.id),
    prisma.session.findMany({
      where: { userId: { in: userIds } },
      orderBy: { lastUsedAt: "desc" },
      take: 20,
      select: { id: true, userId: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true },
    }),
    prisma.trustedDevice.count({ where: { userId: { in: userIds }, expiresAt: { gt: new Date() } } }),
    prisma.activityLog.findMany({
      where: { vendorId: vendor.id },
      orderBy: { createdAt: "desc" },
      take: 40,
      select: { id: true, action: true, description: true, actorRole: true, createdAt: true, actor: { select: { fullName: true } } },
    }),
    prisma.product.count({ where: { vendorId: vendor.id, isActive: true, hiddenFromStore: false, overQuota: false } }),
    prisma.order.count({ where: { vendorId: vendor.id, createdAt: { gte: since30 }, status: { not: "CANCELLED" } } }),
    prisma.chatQuestionLog.count({ where: { vendorId: vendor.id, createdAt: { gte: since30 } } }).catch(() => 0),
    prisma.assistantMessage.count({ where: { scope: "VENDOR", vendorId: vendor.id, role: "user", createdAt: { gte: since30 } } }),
    prisma.posSale.count({ where: { vendorId: vendor.id, status: "PAID", paidAt: { gte: since30 } } }),
    // Errores del servidor que vivió alguien de esta tienda y reportes que mandaron ellos mismos.
    prisma.$queryRaw`
      SELECT id, origin::text AS origin, message, resolved, "createdAt", context->>'path' AS path
      FROM "ErrorLog"
      WHERE context->>'userId' = ANY(${userIds}) OR context->'who'->'vendor'->>'id' = ${vendor.id}
      ORDER BY "createdAt" DESC
      LIMIT 20`,
  ]);

  const nameById = new Map([[vendor.userId, `${vendor.user.fullName ?? "Dueño"} (dueño)`], ...vendor.staff.map((s) => [s.userId, s.user.fullName ?? s.user.email])]);

  // Lo que le falta configurar: los requisitos de la prueba gratis y lo que ayuda a vender aunque no sea obligatorio.
  const missing = checklist.filter((c) => !c.done).map((c) => c.label);
  if (vendor._count.schedules === 0) missing.push("Horario de atención");
  if (!(vendor.checkoutPaymentOptions?.length)) missing.push("Formas de pago en el checkout");
  if (!vendor.acceptedPaymentMethods?.length) missing.push("Métodos de pago aceptados");
  if (vendor.isRestaurant && vendor._count.tables === 0) missing.push("Mesas con QR (es restaurante)");

  const trialDaysLeft = vendor.trialEndsAt ? Math.max(0, Math.ceil((new Date(vendor.trialEndsAt).getTime() - now) / DAY)) : null;

  res.json({
    vendor: {
      id: vendor.id,
      companyName: vendor.companyName,
      slug: vendor.slug,
      color: vendor.color,
      logoUrl: vendor.logoUrl,
      email: vendor.email,
      whatsapp: vendor.whatsapp,
      ownerName: vendor.ownerName,
      ownerIdNumber: vendor.ownerIdNumber ?? null,
      companyAddress: vendor.companyAddress ?? null,
      description: vendor.description ?? null,
      category: vendor.businessCategory?.name ?? vendor.category?.name ?? null,
      locations: [...new Set(vendor.locations.map((l) => l.province?.name ?? l.stateOther ?? l.country?.name).filter(Boolean))],
      planType: vendor.planType,
      planName: plan?.displayName ?? vendor.planType,
      verificationStatus: vendor.verificationStatus,
      isBlocked: vendor.isBlocked,
      blockReason: vendor.blockReason ?? null,
      status: vendor.status,
      isRestaurant: vendor.isRestaurant,
      currency: vendor.currency,
      createdAt: vendor.createdAt,
      adminDeletionRequestedAt: vendor.adminDeletionRequestedAt ?? null,
      trial: { startedAt: vendor.trialStartedAt, endsAt: vendor.trialEndsAt, daysLeft: trialDaysLeft, active: !!vendor.trialEndsAt && trialDaysLeft > 0 },
      nextPaymentDueDate: vendor.nextPaymentDueDate ?? null,
    },
    owner: vendor.user,
    payment: vendor.verification ?? null,
    staff: vendor.staff.map((s) => ({ id: s.id, name: s.user.fullName, email: s.user.email, isActive: s.isActive, lastLoginAt: s.user.lastLoginAt, sections: s.allowedSections })),
    counts: { ...vendor._count, activeProducts, orders30, posSales30 },
    missing,
    access: {
      lastLoginAt: vendor.user.lastLoginAt,
      trustedDevices,
      sessions: sessions.map((s) => ({
        id: s.id,
        who: nameById.get(s.userId) ?? "Usuario",
        ...describeUserAgent(s.userAgent),
        createdAt: s.createdAt,
        lastUsedAt: s.lastUsedAt,
        active: !s.revokedAt && s.expiresAt > new Date(),
      })),
    },
    activity: activity.map((a) => ({ id: a.id, action: a.action, description: a.description, who: a.actor?.fullName ?? null, role: a.actorRole, createdAt: a.createdAt })),
    errors: errors.map((e) => ({ ...e, createdAt: e.createdAt })),
    assistant: {
      chatbotAllowedByPlan: plan?.allowAiChatbot !== false,
      hasAiDocument: !!vendor.aiDocument,
      aiDocumentName: vendor.aiDocumentName ?? null,
      chatQuestions30,
      assistantQuestions30,
      loyaltyEnabled: !!vendor.loyaltyProgram?.enabled,
    },
  });
}

// Tiendas registradas en los últimos días, para el panel principal del admin: cuánto les falta para estar listas.
export async function listNewVendors(req, res) {
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  const vendors = await prisma.vendor.findMany({
    where: { createdAt: { gte: new Date(Date.now() - days * DAY) }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, companyName: true, color: true, createdAt: true, planType: true, verificationStatus: true, trialEndsAt: true, isBlocked: true, user: { select: { lastLoginAt: true } } },
  });
  const rows = [];
  for (const v of vendors) {
    const checklist = await getTrialChecklist(v.id);
    rows.push({
      id: v.id,
      companyName: v.companyName,
      color: v.color,
      createdAt: v.createdAt,
      planType: v.planType,
      verificationStatus: v.verificationStatus,
      trialActive: !!v.trialEndsAt && new Date(v.trialEndsAt) > new Date(),
      isBlocked: v.isBlocked,
      lastLoginAt: v.user?.lastLoginAt ?? null,
      done: checklist.filter((c) => c.done).length,
      totalSteps: checklist.length,
    });
  }
  const total = await prisma.vendor.count({ where: { createdAt: { gte: new Date(Date.now() - days * DAY) }, deletedAt: null } });
  res.json({ vendors: rows, total, days });
}
