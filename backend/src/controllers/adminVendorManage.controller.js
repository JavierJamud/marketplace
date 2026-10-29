import { checkoutLabel } from "../lib/catalog.js";
import { isSessionIdle } from "../lib/sessionPolicy.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getPlanConfig, getDefaultPlanKey, isPremiumActive, planDisplayName } from "../lib/planConfig.js";
import { getPlanFeatureCatalog, featureValue, planFeatureList } from "../lib/planFeatures.js";
import { describeUserAgent } from "../lib/userAgent.js";
import { getTrialChecklist } from "../services/trialEligibility.service.js";
import { adminReactivationBillingData } from "../services/planBilling.service.js";
import { ticketsForVendor } from "./supportTickets.controller.js";
import { describeVendorZones } from "../lib/vendorZone.js";
// Misma cuenta de provincias que el registro y la propia tienda: antes aquí la clave era otra y uno veía "excede" donde el
// otro no.
import { countVendorProvinces } from "../services/vendorZoneSync.service.js";

// Página "Gestionar" de una tienda en el admin (/admin/tiendas/:id): todo lo de esa tienda en un solo lugar. Reemplaza el
// menú de tres puntos de la lista. Solo lectura; las acciones (editar, plan, bloquear, eliminar) usan las rutas de siempre.
const DAY = 24 * 60 * 60 * 1000;
const DAY_NAMES = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

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
      locations: { include: { province: { select: { id: true, name: true, type: true, countryId: true } }, country: true, municipality: { select: { id: true, name: true } } } },
      registrationCountry: { select: { name: true } },
      legalProvince: { select: { name: true } },
      legalMunicipality: { select: { name: true } },
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

  const [plan, checklist, sessions, trustedDevices, activity, activeProducts, productsInQuota, activeStoreOffers, activeStaff, liveTables, countedCodes, orders30, chatQuestions30, assistantQuestions30, posSales30, errors, usage] = await Promise.all([
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
    // Lo que cuenta el servidor contra cada tope (no el total de filas): productos activos dentro del cupo (placeProductInQuota
    // en lib/planConfig.js) y ofertas encendidas (assertActiveOfferLimit en storeOffers.controller.js). Con el total salía
    // "120 de 50" en una tienda con 70 borradores o productos fuera del cupo.
    prisma.product.count({ where: { vendorId: vendor.id, isActive: true, overQuota: false } }),
    prisma.storeOffer.count({ where: { vendorId: vendor.id, active: true } }),
    // Usuarios, mesas y códigos con el mismo filtro que su tope en el servidor. Con el total de filas (_count) una tienda con 3
    // usuarios desactivados y tope 3 veía "3 de 3" en rojo mientras el servidor le dejaba crear otro.
    // Usuarios activos: assertStaffSlotFree en vendorStaff.controller.js (desactivar libera el cupo).
    prisma.vendorStaff.count({ where: { vendorId: vendor.id, isActive: true } }),
    // Mesas sin eliminar: createTable en tables.controller.js (la eliminada se guarda por su historial con deletedAt).
    prisma.table.count({ where: { vendorId: vendor.id, deletedAt: null } }),
    // Códigos encendidos, sin suspender y sin vencer: countedCodeWhere en discountCodes.controller.js. Se copia el filtro
    // porque esa función no se exporta; si cambia allí, cambia aquí.
    prisma.discountCode.count({
      where: { vendorId: vendor.id, active: true, suspendedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date(now) } }] },
    }),
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
  if (vendor.isRestaurant && liveTables === 0) missing.push("Mesas con QR (es restaurante)");

  // Cada requisito de la prueba gratis (getTrialChecklist) con el dato real con el que la tienda lo completó (o vacío si le
  // falta). Las fotos de identidad nunca se mandan aquí: solo si se subieron y cuándo (se ven en Verificaciones).
  const ver = vendor.verification;
  const zones = describeVendorZones(vendor.locations, { pendingMark: " · municipio por aprobar" });
  const valueFor = {
    companyName: vendor.companyName,
    ownerName: vendor.ownerName,
    whatsapp: vendor.whatsapp,
    email: vendor.email,
    businessCategoryId: vendor.businessCategory?.name ?? null,
    description: short(vendor.description),
    locations: zones.join(" · ") || null,
    companyAddress: vendor.companyAddress,
    registrationCountryId: vendor.registrationCountry?.name ?? vendor.registrationCountryOther ?? null,
    // Municipio y provincia legales juntos ("Segundo Frente, Santiago de Cuba"): antes solo se veía la provincia.
    legalProvinceId: [vendor.legalMunicipality?.name ?? vendor.legalMunicipalityOther, vendor.legalProvince?.name ?? vendor.legalProvinceOther].filter(Boolean).join(", ") || null,
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
    { key: "checkout", label: "Formas de pago en el checkout", done: !!vendor.checkoutPaymentOptions?.length, value: (vendor.checkoutPaymentOptions ?? []).map(checkoutLabel).join(", ") || null },
    // Cómo cobra la tienda a SUS clientes (Transfermóvil, Zelle, efectivo...), elegido en su Configuración. No es el pago de
    // la suscripción: antes se llamaba "Métodos de pago aceptados" y se confundía con eso.
    {
      key: "accepted",
      label: "Formas de cobro a sus clientes",
      hint: "Transfermóvil, Zelle, efectivo… La tienda las elige en Configuración › Métodos de pago.",
      done: !!vendor.acceptedPaymentMethods?.length,
      value: vendor.acceptedPaymentMethods ?? [],
    },
    // Solo las mesas sin eliminar: una eliminada (guardada por su historial) ya no tiene QR que escanear.
    ...(vendor.isRestaurant ? [{ key: "tables", label: "Mesas con QR", done: liveTables > 0, value: liveTables ? `${liveTables} ${liveTables === 1 ? "mesa" : "mesas"}` : null }] : []),
  ];

  // Plan: si paga, si está en la prueba gratis o en un plan gratis, y cuánto usa de cada límite. Nada de claves fijas: lo
  // dice la fila del plan en PlanConfig (un plan creado por el admin se ve igual que los de siempre).
  const isTrial = !!vendor.trialEndsAt && trialDaysLeftOf(vendor, now) > 0;
  const [catalog, lastGrant] = await Promise.all([
    getPlanFeatureCatalog(),
    // Activación a mano vigente: el último cambio hacia su plan actual fue "admin_grant" y no hubo un pago confirmado después.
    prisma.vendorPlanChange.findFirst({ where: { vendorId: vendor.id, toPlan: vendor.planType }, orderBy: { createdAt: "desc" }, select: { reason: true, createdAt: true } }),
    getDefaultPlanKey(), // carga la caché que usa isPremiumActive
  ]);
  const paidAfterGrant =
    lastGrant?.reason === "admin_grant"
      ? (vendor.verification?.paymentConfirmedAt && vendor.verification.paymentConfirmedAt > lastGrant.createdAt) ||
        !!(await prisma.subscriptionPayment.findFirst({ where: { vendorId: vendor.id, confirmedAt: { gt: lastGrant.createdAt } }, select: { id: true } }))
      : false;
  const catalogItem = new Map(catalog.map((f) => [f.key, f]));
  // Límite efectivo: con su interruptor apagado (por ejemplo usuarios sin "Usuarios del equipo") vale 0, no el número guardado.
  // Las ofertas además necesitan códigos de descuento (cada oferta lleva uno) y un plan con insignia (las ofertas son
  // requiresBadge): sin alguna de las dos el servidor no deja crear ni encender ninguna (assertCanPublishStoreOffers en
  // lib/storeOfferVisibility.js), así que el tope que se muestra también es 0.
  const limitOf = (key) => {
    if (!plan) return null;
    if (key === "maxActiveStoreOffers" && (!plan.allowDiscountCodes || !plan.grantsBadge)) return 0;
    return catalogItem.has(key) ? featureValue(plan, catalogItem.get(key)).limit : plan[key] ?? null;
  };
  // Cada fila cuenta lo mismo que el servidor antes de dejar crear otro (ver los conteos del Promise.all de arriba).
  // "Productos dentro del cupo" y no "publicados": el conteo incluye los ocultos de la tienda (hiddenFromStore), que ocupan
  // cupo aunque el cliente no los vea.
  const limitRows = [
    ["Productos dentro del cupo", "maxProducts", productsInQuota],
    ["Provincias donde opera", "maxProvinces", countVendorProvinces(vendor.locations)],
    ["Usuarios activos del sistema", "maxStaffUsers", activeStaff],
    ["Mesas", "maxTables", liveTables],
    ["Códigos de descuento activos", "maxDiscountCodes", countedCodes],
    ["Ofertas de tienda encendidas", "maxActiveStoreOffers", activeStoreOffers],
  ].map(([label, key, used]) => ({ label, used, max: limitOf(key) }));
  // Funciones del plan desde el catálogo (interruptores y personalizadas activas, en su orden), con la etiqueta que eligió
  // el admin. Los topes van arriba, en `limits`.
  // Una función requiresBadge (chat con IA, ofertas...) en un plan sin insignia no se puede usar aunque su interruptor esté
  // encendido (planHasFeature en lib/planConfig.js): sale apagada y con `badgeMissing` para que la pantalla diga por qué.
  const features = plan
    ? planFeatureList(plan, catalog)
        .filter((f) => f.kind !== "limit")
        .map((f) => {
          const badgeMissing = !!f.enabled && !!f.requiresBadge && !plan.grantsBadge;
          return { key: f.key, label: f.label, on: !!f.enabled && !badgeMissing, badgeMissing, custom: f.kind === "custom", requiresBadge: !!f.requiresBadge };
        })
    : [];
  const paidPlanActive = !isTrial && isPremiumActive(vendor);
  const planInfo = {
    // PAID = un plan que no es gratis (también el plan por defecto cuando se cobra y los "por WhatsApp").
    kind: isTrial ? "TRIAL" : plan && !plan.isFree ? "PAID" : "FREE",
    planType: vendor.planType,
    name: plan?.displayName ?? vendor.planType,
    isDefault: !!plan?.isDefault,
    contactOnly: !!plan?.contactOnly,
    grantsBadge: !!plan?.grantsBadge,
    nextPaymentDueDate: vendor.nextPaymentDueDate ?? null,
    // Activo sin fecha de vencimiento (activado a mano "Sin vencimiento", ver grantBusinessPlan en admin.controller.js).
    noExpiry: paidPlanActive && !vendor.nextPaymentDueDate,
    manualGrant: lastGrant?.reason === "admin_grant" && !paidAfterGrant ? { at: lastGrant.createdAt } : null,
    paymentMethod: vendor.verification?.paymentMethod ?? null,
    paymentConfirmedAt: vendor.verification?.paymentConfirmedAt ?? null,
    limits: limitRows,
    features,
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
      businessCategoryId: vendor.businessCategoryId ?? null,
      locations: zones,
      // Zonas tal como están guardadas, para editarlas desde "Editar tienda".
      zoneLocations: vendor.locations.map((l) => ({ id: l.id, provinceId: l.provinceId, municipalityId: l.municipalityId, province: l.province, municipality: l.municipality })),
      planType: vendor.planType,
      planName: plan?.displayName ?? vendor.planType,
      verificationStatus: vendor.verificationStatus,
      isBlocked: vendor.isBlocked,
      blockReason: vendor.blockReason ?? null,
      status: vendor.status,
      // Por qué está suspendida: por falta de pago (billingSuspendedAt, planBilling.service.js) o por inactividad
      // (vendorLifecycle.job.js). Antes la pantalla decía "por inactividad" en los dos casos. `reactivationDueDate` es la
      // fecha de pago que le queda si el admin la reactiva (adminReactivationBillingData: una semana más si ya venció).
      suspension:
        vendor.status === "SUSPENDED"
          ? {
              at: vendor.suspendedAt ?? null,
              reason: vendor.suspensionReason ?? null,
              forBilling: !!vendor.billingSuspendedAt,
              reactivationDueDate: vendor.billingSuspendedAt ? adminReactivationBillingData(vendor).nextPaymentDueDate ?? vendor.nextPaymentDueDate ?? null : null,
            }
          : null,
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
      // Paso al plan por defecto programado por el admin y hasta cuándo tiene su plan de pago hoy (para elegir "al terminar
      // el periodo"). `premiumUntil` conserva su nombre por compatibilidad.
      planDowngradeAt: vendor.planDowngradeAt ?? null,
      planDowngradeReason: vendor.planDowngradeReason ?? null,
      premiumUntil: vendor.trialEndsAt ?? vendor.nextPaymentDueDate ?? null,
      paysWithCard: !!vendor.stripeSubscriptionId,
      // Plan asignado (o pagado) que espera a que la tienda complete su verificación (services/pendingActivation.service.js).
      pendingPlan: vendor.pendingActivation?.planType
        ? {
            name: await planDisplayName(vendor.pendingActivation.planType),
            paused: vendor.pendingActivation.kind === "PAUSED",
            requestedAt: vendor.pendingActivation.requestedAt ?? null,
            reason: vendor.pendingActivation.reason ?? null,
          }
        : null,
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
        // Abierta = todavía sirve. Una sesión sin usar más de 30 minutos ya no se acepta (lib/sessionPolicy.js), aunque nadie la
        // haya cerrado: si el teléfono o la pestaña no volvieron, se quedaba sin revocar y aquí salía "Abierta" durante días.
        active: !s.revokedAt && s.expiresAt > new Date() && !isSessionIdle(s),
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
