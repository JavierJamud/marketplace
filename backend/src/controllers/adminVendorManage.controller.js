import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getPlanConfig } from "../lib/planConfig.js";
import { describeUserAgent } from "../lib/userAgent.js";
import { getTrialChecklist } from "../services/trialEligibility.service.js";
import { ticketsForVendor } from "./supportTickets.controller.js";

// Página "Gestionar" de una tienda en el admin (/admin/tiendas/:id): todo lo de esa tienda en un solo lugar. Reemplaza el
// menú de tres puntos de la lista. Solo lectura; las acciones (editar, plan, bloquear, eliminar) usan las rutas de siempre.
const DAY = 24 * 60 * 60 * 1000;
const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];
const CHECKOUT_LABEL = { cod: "Pago contra entrega", online: "Pago en línea con el vendedor", cash: "Efectivo" };

// Horario en una línea legible: "Lun a Vie 09:00-18:00 · Sáb 09:00-13:00 · Dom cerrado". Días seguidos con el mismo
// horario se agrupan.
function scheduleSummary(rows) {
  if (!rows.length) return null;
  const byDay = new Map();
  for (const r of rows) {
    const prev = byDay.get(r.dayOfWeek);
    const range = r.isClosed ? "cerrado" : `${r.opensAt}-${r.closesAt}`;
    byDay.set(r.dayOfWeek, prev && prev !== "cerrado" && range !== "cerrado" ? `${prev}, ${range}` : range);
  }
  const order = [1, 2, 3, 4, 5, 6, 0];
  const groups = [];
  for (const d of order) {
    const text = byDay.get(d) ?? "cerrado";
    const last = groups[groups.length - 1];
    if (last && last.text === text) last.to = d;
    else groups.push({ from: d, to: d, text });
  }
  return groups.map((g) => `${DAY_NAMES[g.from]}${g.to !== g.from ? ` a ${DAY_NAMES[g.to]}` : ""} ${g.text}`).join(" · ");
}

const short = (s, n = 90) => (s && s.length > n ? `${s.slice(0, n).trimEnd()}...` : s);

export async function getVendorManage(req, res) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: req.params.id },
    include: {
      user: { select: { id: true, fullName: true, email: true, phone: true, lastLoginAt: true, createdAt: true } },
      verification: { select: { paymentMethod: true, paymentConfirmedAt: true, idPhotoFrontUrl: true, selfieUrl: true, createdAt: true, reviewedAt: true } },
      locations: { include: { province: true, country: true } },
      registrationCountry: { select: { name: true } },
      legalProvince: { select: { name: true } },
      schedules: { select: { dayOfWeek: true, opensAt: true, closesAt: true, isClosed: true } },
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
          staff: true,
        },
      },
    },
  });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const userIds = [vendor.userId, ...vendor.staff.map((s) => s.userId)];
  const now = Date.now();
  const since30 = new Date(now - 30 * DAY);

  const [plan, checklist, sessions, trustedDevices, activity, activeProducts, orders30, chatQuestions30, assistantQuestions30, posSales30, errors, usage] = await Promise.all([
    getPlanConfig(vendor.planType),
    getTrialChecklist(vendor.id),
    prisma.session.findMany({
      where: { userId: { in: userIds } },
      orderBy: { lastUsedAt: "desc" },
      // La pantalla las agrupa por dispositivo; 80 alcanza para ver el historial reciente completo.
      take: 80,
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
      SELECT id, origin::text AS origin, message, resolved, "createdAt", context->>'path' AS path, context->>'method' AS method,
        COALESCE(context->>'statusCode', context->'request'->>'status') AS status, context->>'page' AS page,
        context->>'description' AS "userDescription", context->'request'->>'path' AS "requestPath", context->'request'->>'message' AS "requestMessage"
      FROM "ErrorLog"
      WHERE context->>'userId' = ANY(${userIds}) OR context->'who'->'vendor'->>'id' = ${vendor.id}
      ORDER BY "createdAt" DESC
      LIMIT 20`,
    vendorUsage(vendor, since30),
  ]);
  const tickets = await ticketsForVendor(vendor.id);

  const nameById = new Map([[vendor.userId, `${vendor.user.fullName ?? "Dueño"} (dueño)`], ...vendor.staff.map((s) => [s.userId, s.user.fullName ?? s.user.email])]);

  // Lo que le falta configurar: los requisitos de la prueba gratis y lo que ayuda a vender aunque no sea obligatorio.
  const missing = checklist.filter((c) => !c.done).map((c) => c.label);
  if (vendor._count.schedules === 0) missing.push("Horario de atención");
  if (!(vendor.checkoutPaymentOptions?.length)) missing.push("Formas de pago en el checkout");
  if (!vendor.acceptedPaymentMethods?.length) missing.push("Formas de cobro a sus clientes");
  if (vendor.isRestaurant && vendor._count.tables === 0) missing.push("Mesas con QR (es restaurante)");

  // Cada requisito del plan Premium con el dato real con el que la tienda lo completó (o vacío si le falta). Las fotos de
  // identidad nunca se mandan aquí: solo si se subieron y cuándo (se ven en Verificaciones).
  const ver = vendor.verification;
  const valueFor = {
    companyName: vendor.companyName,
    ownerName: vendor.ownerName,
    whatsapp: vendor.whatsapp,
    email: vendor.email,
    businessCategoryId: vendor.businessCategory?.name ?? null,
    description: short(vendor.description),
    locations: [...new Set(vendor.locations.map((l) => l.province?.name ?? l.stateOther ?? l.country?.name).filter(Boolean))].join(", ") || null,
    companyAddress: vendor.companyAddress,
    registrationCountryId: vendor.registrationCountry?.name ?? vendor.registrationCountryOther ?? null,
    legalProvinceId: vendor.legalProvince?.name ?? vendor.legalProvinceOther ?? null,
    idDocument: ver?.idPhotoFrontUrl ? "Foto subida" : null,
    selfie: ver?.selfieUrl ? "Selfie subida" : null,
    logoUrl: vendor.logoUrl ? "Logo cargado" : null,
    hasPublishedProduct: vendor._count.products ? `${vendor._count.products} ${vendor._count.products === 1 ? "producto" : "productos"}` : null,
  };
  const sentAt = ver?.createdAt ?? null;
  const requirements = checklist.map((c) => ({
    key: c.key,
    label: c.label,
    done: c.done,
    value: c.done ? valueFor[c.key] ?? null : null,
    // Fecha en que llegó el dato, cuando se sabe (documento y selfie: el envío de la verificación).
    at: c.done && (c.key === "idDocument" || c.key === "selfie") ? sentAt : null,
  }));
  // Lo que ayuda a vender aunque no lo exija el plan.
  const extras = [
    { key: "schedules", label: "Horario de atención", done: vendor.schedules.length > 0, value: scheduleSummary(vendor.schedules) },
    { key: "checkout", label: "Formas de pago en el checkout", done: !!vendor.checkoutPaymentOptions?.length, value: (vendor.checkoutPaymentOptions ?? []).map((k) => CHECKOUT_LABEL[k] ?? k).join(", ") || null },
    // Cómo cobra la tienda a SUS clientes (Transfermóvil, Zelle, efectivo...), elegido en su Configuración. No es el pago de
    // la suscripción: antes se llamaba "Métodos de pago aceptados" y se confundía con eso.
    {
      key: "accepted",
      label: "Formas de cobro a sus clientes",
      hint: "Transfermóvil, Zelle, efectivo… La tienda las elige en Configuración › Métodos de pago.",
      done: !!vendor.acceptedPaymentMethods?.length,
      value: vendor.acceptedPaymentMethods ?? [],
    },
    ...(vendor.isRestaurant ? [{ key: "tables", label: "Mesas con QR", done: vendor._count.tables > 0, value: vendor._count.tables ? `${vendor._count.tables} mesas` : null }] : []),
  ];

  // Plan: si paga, si está en la prueba gratis o en el plan gratuito, y cuánto usa de cada límite.
  const isTrial = !!vendor.trialEndsAt && trialDaysLeftOf(vendor, now) > 0;
  const limitRows = [
    ["Productos", "maxProducts", vendor._count.products],
    ["Provincias donde opera", "maxProvinces", new Set(vendor.locations.map((l) => l.provinceId ?? l.stateOther ?? l.countryId)).size],
    ["Usuarios del sistema", "maxStaffUsers", vendor._count.staff],
    ["Mesas", "maxTables", vendor._count.tables],
    ["Códigos de descuento", "maxDiscountCodes", vendor._count.discountCodes],
    ["Ofertas de tienda", "maxActiveStoreOffers", vendor._count.storeOffers],
  ].map(([label, key, used]) => ({ label, used, max: plan?.[key] ?? null }));
  const FEATURE_LABELS = {
    allowAiChatbot: "Chat con IA",
    allowPos: "Caja",
    allowQrTables: "Mesas con QR",
    allowStaffUsers: "Usuarios del sistema",
    allowLoyalty: "Programa de puntos",
    allowStoreOffers: "Ofertas de tienda",
    allowDiscountCodes: "Códigos de descuento",
    allowCustomerEmails: "Correos a clientes",
    featuredInHome: "Destacada en la portada",
  };
  const planInfo = {
    kind: isTrial ? "TRIAL" : vendor.planType === "BUSINESS" ? "PAID" : "FREE",
    name: plan?.displayName ?? vendor.planType,
    nextPaymentDueDate: vendor.nextPaymentDueDate ?? null,
    paymentMethod: vendor.verification?.paymentMethod ?? null,
    paymentConfirmedAt: vendor.verification?.paymentConfirmedAt ?? null,
    limits: limitRows,
    features: Object.entries(FEATURE_LABELS).map(([flag, label]) => ({ label, on: !!plan?.[flag] })),
  };

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
      // Regla de envío de la tienda (ver lib/shipping.js): nulo = cada producto define el suyo.
      shipping: {
        mode: vendor.storeShippingMode ?? null,
        local: vendor.storeShippingLocal != null ? Number(vendor.storeShippingLocal) : null,
        other: vendor.storeShippingOther != null ? Number(vendor.storeShippingOther) : null,
        currency: vendor.storeShippingCurrency ?? null,
      },
      createdAt: vendor.createdAt,
      ownerRegisteredAt: vendor.user.createdAt,
      adminDeletionRequestedAt: vendor.adminDeletionRequestedAt ?? null,
      trial: { startedAt: vendor.trialStartedAt, endsAt: vendor.trialEndsAt, daysLeft: trialDaysLeft, active: !!vendor.trialEndsAt && trialDaysLeft > 0 },
      nextPaymentDueDate: vendor.nextPaymentDueDate ?? null,
      // Paso a Regular programado por el admin y hasta cuándo tiene Premium hoy (para elegir "al terminar el periodo").
      planDowngradeAt: vendor.planDowngradeAt ?? null,
      planDowngradeReason: vendor.planDowngradeReason ?? null,
      premiumUntil: vendor.trialEndsAt ?? vendor.nextPaymentDueDate ?? null,
      paysWithCard: !!vendor.stripeSubscriptionId,
    },
    owner: vendor.user,
    payment: vendor.verification ?? null,
    staff: vendor.staff.map((s) => ({ id: s.id, name: s.user.fullName, email: s.user.email, isActive: s.isActive, lastLoginAt: s.user.lastLoginAt, sections: s.allowedSections })),
    counts: { ...vendor._count, activeProducts, orders30, posSales30 },
    missing,
    requirements,
    extras,
    plan: planInfo,
    usage,
    tickets,
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

function trialDaysLeftOf(vendor, now) {
  return vendor.trialEndsAt ? Math.max(0, Math.ceil((new Date(vendor.trialEndsAt).getTime() - now) / DAY)) : 0;
}

// Uso de la plataforma en los últimos 30 días: ventas, días con actividad y lo que más hace en su panel.
async function vendorUsage(vendor, since) {
  const [ordersAgg, posAgg, productsCreated, reviews, activeDaysRows, topActions, lastActivity] = await Promise.all([
    prisma.order.aggregate({ where: { vendorId: vendor.id, createdAt: { gte: since }, status: { not: "CANCELLED" } }, _sum: { total: true }, _count: true }),
    prisma.posSale.aggregate({ where: { vendorId: vendor.id, status: "PAID", paidAt: { gte: since } }, _sum: { total: true }, _count: true }).catch(() => ({ _sum: { total: null }, _count: 0 })),
    prisma.product.count({ where: { vendorId: vendor.id, createdAt: { gte: since } } }),
    prisma.review.count({ where: { vendorId: vendor.id, createdAt: { gte: since } } }).catch(() => 0),
    prisma.$queryRaw`SELECT COUNT(DISTINCT date_trunc('day', "createdAt"))::int AS days FROM "ActivityLog" WHERE "vendorId" = ${vendor.id} AND "createdAt" >= ${since}`,
    prisma.activityLog.groupBy({ by: ["action"], where: { vendorId: vendor.id, createdAt: { gte: since } }, _count: { _all: true }, orderBy: { _count: { action: "desc" } }, take: 5 }),
    prisma.activityLog.findFirst({ where: { vendorId: vendor.id }, orderBy: { createdAt: "desc" }, select: { createdAt: true } }),
  ]);
  return {
    currency: vendor.currency,
    orders: ordersAgg._count,
    ordersTotal: Number(ordersAgg._sum.total ?? 0),
    posSales: posAgg._count,
    posTotal: Number(posAgg._sum.total ?? 0),
    productsCreated,
    reviews,
    activeDays: activeDaysRows[0]?.days ?? 0,
    // La acción se guarda con un nombre interno; para leerla se usa la descripción de su registro más reciente.
    topActions: await Promise.all(
      topActions.map(async (a) => {
        const sample = await prisma.activityLog.findFirst({ where: { vendorId: vendor.id, action: a.action }, orderBy: { createdAt: "desc" }, select: { description: true } });
        return { action: a.action, example: sample?.description ?? a.action, count: a._count._all };
      })
    ),
    lastActivityAt: lastActivity?.createdAt ?? null,
  };
}

// Tiendas registradas en los últimos días, para el panel principal del admin: cuánto les falta para estar listas.
export async function listNewVendors(req, res) {
  const days = Math.min(60, Math.max(1, Number(req.query.days) || 14));
  const vendors = await prisma.vendor.findMany({
    where: { createdAt: { gte: new Date(Date.now() - days * DAY) }, deletedAt: null },
    orderBy: { createdAt: "desc" },
    take: 12,
    select: { id: true, companyName: true, color: true, logoUrl: true, createdAt: true, planType: true, verificationStatus: true, trialEndsAt: true, isBlocked: true, user: { select: { lastLoginAt: true } } },
  });
  const rows = [];
  for (const v of vendors) {
    const checklist = await getTrialChecklist(v.id);
    rows.push({
      id: v.id,
      companyName: v.companyName,
      color: v.color,
      logoUrl: v.logoUrl,
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
