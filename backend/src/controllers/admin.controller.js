import { mirrorInitialPayment } from "../lib/initialPayment.js";
import { addToBlacklist, normEmail } from "../lib/blacklist.js";
import { assertPhoneFree } from "../lib/phoneUniqueness.js";
import { normalizeUsername } from "../lib/username.js";
import { assertVendorUnique } from "../services/vendorUniqueness.service.js";
import { ratingSummary } from "../lib/ratings.js";
import { z } from "zod";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { emailField } from "../utils/emailField.js";
import { transitionVendorVerification, syncVerificationArchive, withComputedVendorFields } from "../services/vendorVerification.service.js";
import { notifyVerificationEvent } from "../services/verificationNotify.service.js";
import { adminNoticeToVendor } from "../lib/notify.js";
import { cancelStripeSubscription } from "../lib/stripe.js";
import { sendAdminDirectEmail, sendVendorReactivatedEmail } from "../lib/email.js";
import { logActivity } from "../lib/activityLog.js";
import { applyPlanDowngrade, scheduleOrCancelDowngrade } from "../services/planDowngrade.service.js";
import { finalizeUserDeletion } from "../lib/accountDeletion.js";
import { VENDOR_SECTION_KEYS, pruneSectionPermissions, withStaffTypeSections } from "../constants/vendorSections.js";
import { computeVendorHealthScore } from "./vendors.controller.js";
import { rawSalesSeries, salesByCurrency, fillSeriesGaps, bucketKey, salesSeriesSchema, resolveSeriesRange } from "../lib/salesSeries.js";
import {
  recalcVendorProductQuota,
  getAllPlanConfigs,
  getPlanConfig,
  paymentPlanOf,
  quotePlan,
  getDefaultPlanKey,
  getTrialPlanKey,
  getPaidPlanKeys,
  isValidPlanKey,
  planDisplayName,
  isPremiumActive,
  recordPlanChange,
  planAllows,
  PLAN_KEY_PATTERN,
} from "../lib/planConfig.js";
import { orderCurrency, money } from "../lib/orderSummary.js";
import { paginationQuerySchema, pageArgs, pageMeta } from "../lib/pagination.js";
import { vendorZoneWhere, describeVendorZones } from "../lib/vendorZone.js";
import { syncVendorProvinceZone } from "../services/vendorZoneSync.service.js";
import { adminReactivationBillingData, liftBillingSuspension } from "../services/planBilling.service.js";
import { startOfDayInTimezone } from "../lib/timezone.js";
import { getSiteTimezone } from "./settings.controller.js";
import { findMergeCandidates, mergeCustomerIntoVendorAccount, mergeSummary } from "../lib/accountMerge.js";

// --- Dashboard --------------------------------------------------------------

const E164_REGEX = /^\+\d{7,15}$/;
// Bloque 64: mismo ciclo que verification.controller.js — cuánto dura un
// pago CUP confirmado antes de pedir el siguiente.
const PAYMENT_CYCLE_DAYS = 30;

// Bloque 64: verificationStatus ES el estado — ya no hace falta derivarlo de
// isVerified/status por separado (esa desincronía era justo el bug que
// motivó este bloque). Bloque 48: se sube de adentro de listSubscriptions a
// acá para que computeSubscriptionMetrics (usado también por getDashboard)
// pueda reusar el MISMO mapeo, en vez de dos copias.
const SUBSCRIPTION_STATUS_LABEL = {
  VERIFIED: "active",
  PAYMENT_FAILED: "payment_failed",
  SUSPENDED: "suspended",
  REJECTED: "rejected",
};

// Bloque 48: separado de listSubscriptions para que getDashboard pueda pedir
// SOLO verificationStatus (sin los includes de verification/locations que
// esa lista sí necesita) y de todas formas compartir el mismo criterio de
// conteo/MRR — nunca dos copias del cálculo.
// Una tienda en su prueba gratis tiene el plan de prueba completo, pero todavía no paga: se cuenta aparte ("trial") y
// no suma al MRR.
const inTrial = (v) => !!v.trialEndsAt && new Date(v.trialEndsAt) > new Date();

// Tiendas que aparecen en Suscripciones. Los planes ya no son una lista fija: se leen de PlanConfig.
//  - Las de un plan de pago (getPaidPlanKeys: ni el plan por defecto, ni gratis, ni archivado; incluye los "por WhatsApp").
//  - Las que cobra planBilling (billingNoticeStage o billingSuspendedAt): un plan sin insignia o el plan por defecto
//    cuando el admin deja de darlo gratis. Antes quedaban fuera y su cobro no se veía en ningún lado.
//  - Las que perdieron el plan por un cobro fallido o una suspensión: con la regla "plan con insignia <=> VERIFIED" ya
//    están en el plan por defecto, así que filtrar solo por planType las escondería justo cuando hay que revisar su cobro.
async function subscriptionScope() {
  const paidKeys = await getPaidPlanKeys();
  return {
    deletedAt: null,
    OR: [
      { planType: { in: paidKeys } },
      { billingNoticeStage: { not: null } },
      { billingSuspendedAt: { not: null } },
      { verificationStatus: { in: ["PAYMENT_FAILED", "SUSPENDED"] } },
    ],
  };
}

// Campos de la tienda que necesitan subscriptionStatusOf y el MRR (getDashboard pide solo estos).
const SUBSCRIPTION_VENDOR_SELECT = {
  id: true,
  planType: true,
  verificationStatus: true,
  trialEndsAt: true,
  nextPaymentDueDate: true,
  billingNoticeStage: true,
  billingSuspendedAt: true,
};

// Estado de cobro de una tienda. El cobro de planBilling va primero porque lo decide la fecha, no la verificación:
// "billing_suspended" (suspendida por no pagar), "billing_overdue" (pasó su fecha de cobro) y "active" si está al día con
// un plan cobrado. Después, los estados terminales de la verificación. "active" = el plan está pagado y vigente
// (isPremiumActive, o en un plan cobrado por planBilling con su fecha de cobro por delante). Llama antes a
// getDefaultPlanKey() (lo hacen subscriptionScope y computeSubscriptionMetrics) para que isPremiumActive tenga la caché de
// planes cargada.
function subscriptionStatusOf(v) {
  if (v.billingSuspendedAt) return "billing_suspended";
  const due = v.nextPaymentDueDate ? new Date(v.nextPaymentDueDate) : null;
  const now = new Date();
  // Mismo criterio que isBillingOverdue (planBilling.service.js): la etapa sola no basta. Pagar (renovación, pago manual,
  // activación a mano) mueve la fecha pero no la etapa, que se corrige en la siguiente pasada horaria; mientras tanto la
  // tienda ya está al día y no puede salir como "Cobro atrasado".
  if (["due", "after", "suspended"].includes(v.billingNoticeStage) && due && due <= now) return "billing_overdue";
  // Al día con un plan cobrado por planBilling: va antes que la verificación porque una tienda que perdió un plan con
  // insignia hace tiempo (SUSPENDED o PAYMENT_FAILED) y hoy paga al día el plan por defecto cobrado está activa en ese plan.
  if (v.billingNoticeStage && due && due > now) return inTrial(v) ? "trial" : "active";
  const byVerification = SUBSCRIPTION_STATUS_LABEL[v.verificationStatus];
  if (byVerification && byVerification !== "active") return byVerification;
  if (isPremiumActive(v)) return inTrial(v) ? "trial" : "active";
  return "pending_payment";
}

const round2 = (n) => Math.round(n * 100) / 100;
const addMoney = (bucket, currency, amount) => {
  bucket[currency] = round2((bucket[currency] ?? 0) + amount);
};
// Un pago manual de renovación escribe a la vez en VerificationRequest y en SubscriptionPayment (registerManualPayment):
// si las dos filas son de la misma tienda y se confirmaron a menos de 2 minutos, son el mismo dinero.
const SAME_PAYMENT_WINDOW_MS = 2 * 60 * 1000;

// Ingreso mensual de las tiendas que pagan, por moneda y por plan, con lo que pagaron de verdad: su último pago confirmado
// (el más reciente entre SubscriptionPayment y VerificationRequest) dividido entre los meses que cubre. Así entran los
// descuentos por meses, el plan por defecto cuando se cobra y los planes "por WhatsApp" con el monto que registró el
// admin. Nunca se convierte CUP a USD: cada moneda va aparte. Un pago sin monto (activación a mano) no suma.
// Ese último pago solo cuenta si es de su plan actual (un pago sin plan anotado se toma como suyo: las renovaciones viejas
// lo dejaban vacío) y si no hay una activación a mano hacia ese plan posterior al pago. Sin esto, una tienda que pagó
// Premium hace un año y hoy tiene un plan activado a mano, o el plan por defecto cobrado todavía sin pagar, sumaba al
// MRR de su plan actual un dinero que ya no cobra.
async function monthlyRevenueOf(payingVendors) {
  const total = {};
  const byPlan = new Map();
  if (!payingVendors.length) return { total, byPlan };
  const ids = payingVendors.map((v) => v.id);
  const [subs, initials, grants] = await Promise.all([
    prisma.subscriptionPayment.findMany({
      where: { vendorId: { in: ids }, confirmedAt: { not: null } },
      orderBy: { confirmedAt: "desc" },
      distinct: ["vendorId"],
      select: { vendorId: true, amount: true, currency: true, months: true, confirmedAt: true, planType: true },
    }),
    prisma.verificationRequest.findMany({
      where: { vendorId: { in: ids }, paymentConfirmedAt: { not: null } },
      select: { vendorId: true, paymentAmount: true, paymentCurrency: true, paymentMonths: true, paymentConfirmedAt: true, paymentPlanType: true },
    }),
    // Activaciones a mano, de la más nueva a la más vieja (abajo se toma la última hacia el plan actual de cada tienda).
    prisma.vendorPlanChange.findMany({
      where: { vendorId: { in: ids }, reason: "admin_grant" },
      orderBy: { createdAt: "desc" },
      select: { vendorId: true, toPlan: true, createdAt: true },
    }),
  ]);
  const last = new Map(subs.map((p) => [p.vendorId, { at: p.confirmedAt, amount: p.amount, currency: p.currency, months: p.months, planType: p.planType }]));
  for (const p of initials) {
    const cur = last.get(p.vendorId);
    // A igual fecha (el pago manual que escribe en las dos tablas) gana SubscriptionPayment.
    if (!cur || p.paymentConfirmedAt.getTime() > cur.at.getTime() + SAME_PAYMENT_WINDOW_MS) {
      last.set(p.vendorId, { at: p.paymentConfirmedAt, amount: p.paymentAmount, currency: p.paymentCurrency, months: p.paymentMonths, planType: p.paymentPlanType });
    }
  }
  const lastGrantAt = new Map();
  for (const g of grants) {
    const key = `${g.vendorId}:${g.toPlan}`;
    if (!lastGrantAt.has(key)) lastGrantAt.set(key, g.createdAt);
  }
  for (const v of payingVendors) {
    const p = last.get(v.id);
    const amount = Number(p?.amount ?? 0);
    if (!p || !amount || !p.currency) continue;
    if (p.planType && p.planType !== v.planType) continue;
    const grantAt = lastGrantAt.get(`${v.id}:${v.planType}`);
    if (grantAt && grantAt > p.at) continue;
    const monthly = amount / Math.max(1, p.months ?? 1);
    addMoney(total, p.currency, monthly);
    if (!byPlan.has(v.planType)) byPlan.set(v.planType, {});
    addMoney(byPlan.get(v.planType), p.currency, monthly);
  }
  return { total, byPlan };
}

async function computeSubscriptionMetrics(vendors) {
  await getDefaultPlanKey();
  const statuses = vendors.map(subscriptionStatusOf);
  const count = (s) => statuses.filter((x) => x === s).length;
  const { total: mrrByCurrency, byPlan } = await monthlyRevenueOf(vendors.filter((_, i) => statuses[i] === "active"));
  return {
    active: count("active"),
    trial: count("trial"),
    pendingPayment: count("pending_payment"),
    rejected: count("rejected"),
    paymentFailed: count("payment_failed"),
    suspended: count("suspended"),
    billingOverdue: count("billing_overdue"),
    billingSuspended: count("billing_suspended"),
    // Se conserva el nombre de siempre (lo leen el dashboard y Suscripciones), pero ahora es lo cobrado en USD de verdad,
    // no el precio de lista de cada plan. Lo cobrado en CUP va en mrrByCurrency.CUP.
    mrrUsd: mrrByCurrency.USD ?? 0,
    mrrByCurrency,
    mrrByPlan: Object.fromEntries(byPlan),
  };
}

// Pagos confirmados en [from, to), por moneda y por plan, sin contar dos veces el pago manual de renovación (que escribe
// en VerificationRequest y en SubscriptionPayment): una fila de VerificationRequest se descarta si la misma tienda tiene
// un SubscriptionPayment confirmado a menos de 2 minutos. SubscriptionPayment trae también el cobro del plan por defecto
// cuando no es gratis (planBilling), que antes no entraba en ninguna cifra. Mismo criterio que GET /admin/plan-stats.
async function confirmedRevenueBetween(from, to) {
  const [initials, subs] = await Promise.all([
    prisma.verificationRequest.findMany({
      where: { paymentConfirmedAt: { gte: from, lt: to } },
      select: { vendorId: true, paymentAmount: true, paymentCurrency: true, paymentPlanType: true, paymentConfirmedAt: true },
    }),
    // Con margen de 2 minutos a cada lado: el gemelo de un pago del borde del periodo también tiene que verse.
    prisma.subscriptionPayment.findMany({
      where: { confirmedAt: { gte: new Date(from.getTime() - SAME_PAYMENT_WINDOW_MS), lt: new Date(to.getTime() + SAME_PAYMENT_WINDOW_MS) } },
      select: { vendorId: true, amount: true, currency: true, planType: true, confirmedAt: true },
    }),
  ]);
  const payments = [];
  for (const p of subs) {
    if (p.confirmedAt < from || p.confirmedAt >= to) continue;
    payments.push({ planType: paymentPlanOf(p.planType), amount: Number(p.amount ?? 0), currency: p.currency });
  }
  for (const p of initials) {
    const twin = subs.some((s) => s.vendorId === p.vendorId && Math.abs(s.confirmedAt.getTime() - p.paymentConfirmedAt.getTime()) < SAME_PAYMENT_WINDOW_MS);
    if (twin) continue;
    payments.push({ planType: paymentPlanOf(p.paymentPlanType), amount: Number(p.paymentAmount ?? 0), currency: p.paymentCurrency });
  }
  const total = {};
  const byPlan = new Map();
  let count = 0;
  for (const p of payments) {
    if (!p.amount || !p.currency) continue;
    count++;
    addMoney(total, p.currency, p.amount);
    if (!byPlan.has(p.planType)) byPlan.set(p.planType, { revenue: {}, payments: 0 });
    const row = byPlan.get(p.planType);
    addMoney(row.revenue, p.currency, p.amount);
    row.payments++;
  }
  return { total, byPlan, count };
}

// Cuántos días cubre un mes pagado (el mismo PAYMENT_CYCLE_DAYS de arriba), en milisegundos.
const cycleMs = (months) => months * PAYMENT_CYCLE_DAYS * 24 * 60 * 60 * 1000;

// Cambios de plan y VendorPlanChange: transitionVendorVerification y applyPlanDowngrade anotan el cambio en su propia
// transacción (aquí se les pasa `planChangeReason` con el motivo exacto, no se vuelve a llamar recordPlanChange porque
// saldría duplicado). Los cambios que este controlador escribe directo en Vendor lo anotan con recordPlanChange en la misma
// transacción que el cambio.

// Bloque 48: embudo de verificación para el dashboard — NOT_STARTED es la
// única etapa "sin trámite iniciado todavía", nunca se cuenta como problema;
// las 3 últimas (PAYMENT_FAILED/SUSPENDED/REJECTED) son casos terminales/
// especiales, se muestran aparte del flujo principal en el frontend.
const VERIFICATION_FUNNEL_STAGES = [
  "NOT_STARTED",
  "PENDING_DOCS",
  "IN_REVIEW",
  "PENDING_PAYMENT",
  "VERIFIED",
  "PAYMENT_FAILED",
  "SUSPENDED",
  "REJECTED",
  "PLAN_ENDED",
];
const VERIFICATION_STATUS_LABEL = {
  NOT_STARTED: "Sin iniciar",
  PENDING_DOCS: "Documentos subidos",
  IN_REVIEW: "En revisión",
  PENDING_PAYMENT: "Falta el pago",
  VERIFIED: "Verificada",
  PAYMENT_FAILED: "Pago fallido",
  SUSPENDED: "Suspendida",
  REJECTED: "Rechazada",
  // getDashboard lo cambia por "Volvió al plan <nombre del plan por defecto>" (el nombre lo elige el admin).
  PLAN_ENDED: "Volvió al plan por defecto",
};

// Inicio y fin del mes calendario del negocio (zona horaria del sitio), no el
// del servidor: en Cuba el mes empieza a las 00:00 de Cuba, igual que los
// filtros de fecha de Pedidos (adminOrders.controller.js). Se ancla a las
// 12:00 UTC del día 1 para que startOfDayInTimezone lea ese mismo día en
// cualquier zona de América o Europa. Date.UTC(y, 12, 1) pasa solo a enero.
function monthBoundsInTimezone(now, timezone) {
  const [year, month] = new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(now).split("-").map(Number);
  return {
    start: startOfDayInTimezone(new Date(Date.UTC(year, month - 1, 1, 12)), timezone),
    end: startOfDayInTimezone(new Date(Date.UTC(year, month, 1, 12)), timezone),
  };
}

// Fila "Ingresos por plan" del dashboard (forma documentada en planes-spec.md, sección "Dashboard"): por cada plan, sus
// tiendas, las que pagan al día, las que están en prueba, lo cobrado este mes y el ingreso mensual (MRR), las dos cifras
// por moneda sin convertir. Salen todos los planes no archivados (también los ocultos y el plan por defecto) y los
// archivados solo si tienen cobros en el mes. Los nombres vienen de PlanConfig, nunca escritos en el código.
// Las cifras de tiendas (vendors, paying, inTrial) usan el mismo alcance que la lista de Tiendas (listVendors sin filtro de
// estado): sin bloqueadas, suspendidas ni con eliminación pendiente. Cada fila enlaza a /admin/tiendas?plan=CLAVE y antes
// contaba todas las no eliminadas, así que al abrirla se veía un número menor. El dinero (revenue, mrr) no cambia: es lo
// cobrado de verdad, también de las tiendas que después se bloquearon.
const LISTED_VENDOR_SCOPE = { deletedAt: null, isBlocked: false, status: { not: "SUSPENDED" }, adminDeletionRequestedAt: null };

async function buildRevenueByPlan({ monthStart, monthEnd, monthRevenue, subscriptionVendors, subscriptionMetrics }) {
  const activeIds = subscriptionVendors.filter((v) => subscriptionStatusOf(v) === "active").map((v) => v.id);
  const [configs, vendorsByPlan, trialsByPlan, listedPaying] = await Promise.all([
    getAllPlanConfigs({ includeArchived: true }),
    prisma.vendor.groupBy({ by: ["planType"], where: LISTED_VENDOR_SCOPE, _count: { _all: true } }),
    prisma.vendor.groupBy({ by: ["planType"], where: { ...LISTED_VENDOR_SCOPE, trialEndsAt: { gt: new Date() } }, _count: { _all: true } }),
    activeIds.length ? prisma.vendor.findMany({ where: { ...LISTED_VENDOR_SCOPE, id: { in: activeIds } }, select: { planType: true } }) : [],
  ]);
  const vendorCount = new Map(vendorsByPlan.map((r) => [r.planType, r._count._all]));
  const trialCount = new Map(trialsByPlan.map((r) => [r.planType, r._count._all]));
  const payingCount = new Map();
  for (const v of listedPaying) payingCount.set(v.planType, (payingCount.get(v.planType) ?? 0) + 1);
  // Siempre CUP y USD (las dos monedas de cobro), más cualquier otra que aparezca en los datos.
  const currencies = [...new Set(["CUP", "USD", ...Object.keys(monthRevenue.total), ...Object.keys(subscriptionMetrics.mrrByCurrency)])];
  const money = (bucket = {}) => Object.fromEntries(currencies.map((c) => [c, bucket[c] ?? 0]));

  const plans = configs
    .filter((c) => !c.archivedAt || monthRevenue.byPlan.has(c.planType))
    .map((c) => ({
      planType: c.planType,
      displayName: c.displayName,
      archived: !!c.archivedAt,
      isDefault: !!c.isDefault,
      isFree: !!c.isFree,
      contactOnly: !!c.contactOnly,
      vendors: vendorCount.get(c.planType) ?? 0,
      paying: payingCount.get(c.planType) ?? 0,
      inTrial: trialCount.get(c.planType) ?? 0,
      payments: monthRevenue.byPlan.get(c.planType)?.payments ?? 0,
      revenue: money(monthRevenue.byPlan.get(c.planType)?.revenue),
      mrr: money(subscriptionMetrics.mrrByPlan[c.planType]),
    }));
  const sum = (key) => plans.reduce((n, p) => n + p[key], 0);
  return {
    from: monthStart.toISOString(),
    to: monthEnd.toISOString(),
    currencies,
    plans,
    totals: {
      vendors: sum("vendors"),
      paying: sum("paying"),
      inTrial: sum("inTrial"),
      payments: monthRevenue.count,
      revenue: money(monthRevenue.total),
      mrr: money(subscriptionMetrics.mrrByCurrency),
    },
  };
}

export async function getDashboard(_req, res) {
  const { start: monthStart, end: monthEnd } = monthBoundsInTimezone(new Date(), await getSiteTimezone());

  const dayAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const weekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const monthAgo = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const [
    activeVendors,
    totalCustomers,
    monthSalesRows,
    orderSum,
    tableOrderSum,
    pendingVerifications,
    businessVendors,
    monthSalesByCurrency,
  ] = await Promise.all([
    prisma.vendor.count({ where: { isBlocked: false, status: "ACTIVE", deletedAt: null } }),
    prisma.user.count({ where: { role: "CUSTOMER", deletedAt: null } }),
    // Pedidos y valor del mes con la MISMA consulta de la gráfica de ventas
    // (rawSalesSeries): sin cancelados (Order CANCELLED ni TableOrder con
    // cancelledAt), así las tarjetas "(mes)" y la gráfica hablan de lo mismo.
    // Antes el valor sumaba toda la historia y el ticket promedio la dividía
    // entre los pedidos del mes, por eso crecía cada mes sin motivo.
    rawSalesSeries(null, "month", monthStart, monthEnd),
    // `gmv` sigue siendo el total de toda la historia: el asistente de IA del
    // admin lo lee con ese nombre (assistantTools.js, "ventasTotalesDeTodaLaHistoria").
    prisma.order.aggregate({ _sum: { total: true } }),
    prisma.tableOrder.aggregate({ _sum: { total: true } }),
    prisma.vendor.count({ where: { verificationStatus: { in: ["PENDING_DOCS", "IN_REVIEW"] }, deletedAt: null } }),
    // Tiendas en un plan de pago (todos menos el plan por defecto y los gratis), leídos de PlanConfig.
    getPaidPlanKeys().then((keys) => prisma.vendor.count({ where: { planType: { in: keys }, deletedAt: null } })),
    // Mismo mes y mismo criterio sin cancelados, separado por moneda (salesByCurrency): gmvMonth y aov suman CUP con USD.
    salesByCurrency(null, monthStart, monthEnd),
  ]);

  const gmv = Number(orderSum._sum.total ?? 0) + Number(tableOrderSum._sum.total ?? 0);
  // El mes del negocio puede caer en dos casillas UTC de la consulta (las
  // últimas horas del mes en Cuba ya son el mes siguiente en UTC): se suman todas.
  const gmvMonth = monthSalesRows.reduce((sum, r) => sum + r.total, 0);
  const ordersThisMonthTotal = monthSalesRows.reduce((sum, r) => sum + r.orders, 0);

  // Bloque 47 (pedido explícito — "ingresos por suscripción, desglosados
  // por moneda"): reemplaza el viejo estimado (tiendas Business × precio de
  // lista en CUP, que asumía que TODAS pagan en CUP) por ingresos REALES
  // confirmados este mes — dos fuentes, las mismas que ya usa el resto del
  // ciclo de suscripción: el pago inicial (VerificationRequest.paymentConfirmedAt,
  // primer mes al pasar a Business) y cada renovación propia
  // (SubscriptionPayment.confirmedAt, ver confirmSubscriptionRenewal más
  // abajo). Ambas fuentes ya guardan su propio monto Y moneda declarados
  // (CUP por transferencia, USD por Stripe) — nunca se asume una sola.
  // Ahora sin la doble cuenta del pago manual de renovación (escribe en las dos tablas) y con el cobro del plan por
  // defecto cuando no es gratis: ver confirmedRevenueBetween. El mes es el del negocio (monthStart a monthEnd).
  const monthRevenue = await confirmedRevenueBetween(monthStart, monthEnd);
  const subscriptionRevenueByCurrency = Object.entries(monthRevenue.total)
    .map(([currency, amount]) => ({ currency, amount }))
    .sort((a, b) => b.amount - a.amount);

  // --- Uso de la plataforma (Bloque 12) -------------------------------------
  // "Activo" = la tienda tiene al menos un pedido real (Order o TableOrder)
  // alguna vez — no solo "no bloqueada". Distingue tiendas que ya venden de
  // las que se registraron pero nunca recibieron un pedido.
  const [vendorsWithOrders, vendorsWithTableOrders, totalNonDeletedVendors] = await Promise.all([
    prisma.order.groupBy({ by: ["vendorId"] }),
    prisma.tableOrder.findMany({ select: { table: { select: { vendorId: true } } } }),
    prisma.vendor.count({ where: { deletedAt: null } }),
  ]);
  const activeVendorIds = new Set([
    ...vendorsWithOrders.map((v) => v.vendorId),
    ...vendorsWithTableOrders.map((t) => t.table.vendorId),
  ]);
  const vendorActivity = {
    active: activeVendorIds.size,
    inactive: Math.max(0, totalNonDeletedVendors - activeVendorIds.size),
  };

  const [ordersDay, ordersWeek, ordersMonth, tableOrdersDay, tableOrdersWeek, tableOrdersMonth, vendorsDay, vendorsWeek, vendorsMonth] =
    await Promise.all([
      prisma.order.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.order.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.order.count({ where: { createdAt: { gte: monthAgo } } }),
      prisma.tableOrder.count({ where: { createdAt: { gte: dayAgo } } }),
      prisma.tableOrder.count({ where: { createdAt: { gte: weekAgo } } }),
      prisma.tableOrder.count({ where: { createdAt: { gte: monthAgo } } }),
      prisma.vendor.count({ where: { createdAt: { gte: dayAgo }, deletedAt: null } }),
      prisma.vendor.count({ where: { createdAt: { gte: weekAgo }, deletedAt: null } }),
      prisma.vendor.count({ where: { createdAt: { gte: monthAgo }, deletedAt: null } }),
    ]);
  const ordersByPeriod = { day: ordersDay + tableOrdersDay, week: ordersWeek + tableOrdersWeek, month: ordersMonth + tableOrdersMonth };
  const newVendorsByPeriod = { day: vendorsDay, week: vendorsWeek, month: vendorsMonth };

  // Actividad reciente real: últimas tiendas, verificaciones y pedidos.
  const [recentVendors, recentVerifications, recentOrders] = await Promise.all([
    prisma.vendor.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { locations: { include: { province: true }, take: 1 } } }),
    prisma.verificationRequest.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { vendor: { select: { companyName: true } } } }),
    prisma.order.findMany({ orderBy: { createdAt: "desc" }, take: 5, include: { vendor: { select: { companyName: true } } } }),
  ]);

  const activity = [
    ...recentVendors.map((v) => ({
      emoji: "🏪",
      bg: "#e4f0f0",
      text: `Nueva tienda: "${v.companyName}" (${v.locations[0]?.province?.name ?? "Cuba"})`,
      time: v.createdAt,
    })),
    ...recentVerifications.map((v) => ({
      emoji: "🛡️",
      bg: "#fbeee0",
      text: `Solicitud de verificación de "${v.vendor.companyName}"`,
      time: v.createdAt,
    })),
    ...recentOrders.map((o) => ({
      emoji: "💳",
      bg: "#e0ecfb",
      text: `Pedido ${o.code} en "${o.vendor.companyName}"`,
      time: o.createdAt,
    })),
  ]
    .sort((a, b) => new Date(b.time) - new Date(a.time))
    .slice(0, 6);

  const vendorsByProvinceRaw = await prisma.vendorLocation.groupBy({ by: ["provinceId"], _count: { vendorId: true } });
  const provinces = await prisma.province.findMany({ where: { id: { in: vendorsByProvinceRaw.map((v) => v.provinceId) } } });
  const provinceName = Object.fromEntries(provinces.map((p) => [p.id, p.name]));
  const maxCount = Math.max(1, ...vendorsByProvinceRaw.map((v) => v._count.vendorId));
  const byProvince = vendorsByProvinceRaw
    .map((v) => ({ name: provinceName[v.provinceId] ?? "—", n: v._count.vendorId, pct: `${Math.round((v._count.vendorId / maxCount) * 100)}%` }))
    .sort((a, b) => b.n - a.n)
    .slice(0, 5);

  // Bloque 48 (pedido explícito — "que aproveche el algoritmo que ya tiene
  // la plataforma para tiendas con alto potencial"): ticket promedio real, +
  // MRR/estado de suscripciones (mismo criterio que ya usa
  // listSubscriptions, ver computeSubscriptionMetrics más abajo) + embudo de
  // verificación + un ranking de "alto potencial" que reusa
  // computeVendorHealthScore (vendors.controller.js) — nunca un cálculo
  // nuevo/paralelo de "qué tan bien va una tienda".
  // Valor del mes entre pedidos del mes, los dos sin cancelados.
  const aov = ordersThisMonthTotal > 0 ? gmvMonth / ordersThisMonthTotal : 0;
  // Por moneda, sin convertir: CUP y USD siempre presentes. El ticket promedio de una moneda sin pedidos es null (no hay
  // promedio que mostrar, y 0 se leería como "pedidos de 0"). gmvMonth y aov se conservan para el asistente del admin.
  const gmvMonthByCurrency = Object.fromEntries(Object.entries(monthSalesByCurrency).map(([c, r]) => [c, r.total]));
  const ordersMonthByCurrency = Object.fromEntries(Object.entries(monthSalesByCurrency).map(([c, r]) => [c, r.orders]));
  const aovByCurrency = Object.fromEntries(Object.entries(monthSalesByCurrency).map(([c, r]) => [c, r.orders > 0 ? r.total / r.orders : null]));

  const subscriptionVendors = await prisma.vendor.findMany({ where: await subscriptionScope(), select: SUBSCRIPTION_VENDOR_SELECT });
  const [subscriptionMetrics, verificationFunnelRaw, defaultPlanName] = await Promise.all([
    computeSubscriptionMetrics(subscriptionVendors),
    prisma.vendor.groupBy({ by: ["verificationStatus"], where: { deletedAt: null }, _count: { _all: true } }),
    getDefaultPlanKey().then(planDisplayName),
  ]);
  const funnelCountByStatus = Object.fromEntries(verificationFunnelRaw.map((r) => [r.verificationStatus, r._count._all]));
  const verificationFunnel = VERIFICATION_FUNNEL_STAGES.map((status) => ({
    status,
    label: status === "PLAN_ENDED" ? `Volvió al plan ${defaultPlanName}` : VERIFICATION_STATUS_LABEL[status],
    count: funnelCountByStatus[status] ?? 0,
  }));

  const revenueByPlan = await buildRevenueByPlan({ monthStart, monthEnd, monthRevenue, subscriptionVendors, subscriptionMetrics });

  // "Alto potencial" = salud ≥ 50 (mismo corte verde/amarillo que ya usa el
  // semáforo del propio vendedor, nunca se muestra una tienda "roja") entre
  // las que tuvieron ingresos reales este mes — sin pedidos recientes, no
  // hay "desempeño" que evaluar, así que ni siquiera entran a la carrera.
  const [orderRevenueByVendor, tableOrderRevenueRows] = await Promise.all([
    prisma.order.groupBy({
      by: ["vendorId"],
      where: { createdAt: { gte: monthAgo }, status: { not: "CANCELLED" } },
      _sum: { total: true },
      _count: { _all: true },
    }),
    prisma.tableOrder.findMany({
      where: { createdAt: { gte: monthAgo }, cancelledAt: null },
      select: { total: true, table: { select: { vendorId: true } } },
    }),
  ]);
  const revenueByVendor = new Map();
  for (const r of orderRevenueByVendor) {
    revenueByVendor.set(r.vendorId, { revenue: Number(r._sum.total ?? 0), orders: r._count._all });
  }
  for (const row of tableOrderRevenueRows) {
    const vendorId = row.table.vendorId;
    const cur = revenueByVendor.get(vendorId) ?? { revenue: 0, orders: 0 };
    cur.revenue += Number(row.total);
    cur.orders += 1;
    revenueByVendor.set(vendorId, cur);
  }
  // Tope defensivo: nunca calcular el score de salud (8 queries c/u) para
  // más de 50 tiendas candidatas, aunque la plataforma crezca mucho — se
  // queda con las de más ingresos, que son justo las únicas con chance real
  // de terminar en el top 6 de todas formas.
  const candidateIds = [...revenueByVendor.entries()]
    .sort((a, b) => b[1].revenue - a[1].revenue)
    .slice(0, 50)
    .map(([vendorId]) => vendorId);
  const candidateVendors = candidateIds.length
    ? await prisma.vendor.findMany({
        where: { id: { in: candidateIds }, deletedAt: null, isBlocked: false },
        select: { id: true, companyName: true, slug: true, color: true },
      })
    : [];
  const healthScores = await Promise.all(candidateVendors.map((v) => computeVendorHealthScore(v.id, monthAgo)));
  const topPotentialVendors = candidateVendors
    .map((v, i) => ({
      vendorId: v.id,
      companyName: v.companyName,
      slug: v.slug,
      color: v.color,
      score: healthScores[i].score,
      level: healthScores[i].level,
      recentRevenue: revenueByVendor.get(v.id).revenue,
      recentOrders: revenueByVendor.get(v.id).orders,
    }))
    .filter((v) => v.score >= 50)
    .sort((a, b) => b.recentRevenue - a.recentRevenue)
    .slice(0, 6);

  res.json({
    metrics: {
      activeVendors,
      totalCustomers,
      ordersThisMonth: ordersThisMonthTotal,
      gmv,
      gmvMonth,
      aov,
      gmvMonthByCurrency,
      ordersMonthByCurrency,
      aovByCurrency,
      // `businessVendors` se conserva por compatibilidad; es lo mismo que `paidPlanVendors` (todas las tiendas en un plan
      // de pago, no solo las de Premium).
      businessVendors,
      paidPlanVendors: businessVendors,
      subscriptionRevenueByCurrency,
      mrrUsd: subscriptionMetrics.mrrUsd,
      mrrByCurrency: subscriptionMetrics.mrrByCurrency,
      activeSubscriptions: subscriptionMetrics.active,
    },
    revenueByPlan,
    pendingVerifications,
    activity,
    byProvince,
    vendorActivity,
    ordersByPeriod,
    newVendorsByPeriod,
    verificationFunnel,
    topPotentialVendors,
  });
}

// Bloque 48: misma consulta paramétrica de vendors.controller.js
// (rawSalesSeries/fillSeriesGaps, lib/salesSeries.js), sin vendorId = toda
// la plataforma — reemplaza el bar chart de 3 barras fijas (24h/7d/30d) del
// dashboard por una gráfica única con selector de granularidad + rango,
// mismo patrón ya probado en VendorDashboard.jsx (Bloque 225). Suma una
// tercera serie ("tiendas nuevas") agrupada con el mismo DATE_TRUNC, para
// que ventas/pedidos/crecimiento de tiendas queden en una sola gráfica
// filtrable en vez de en tarjetas sueltas.
export async function getDashboardSalesSeries(req, res) {
  const { granularity, from, to } = salesSeriesSchema.parse(req.query);
  const range = resolveSeriesRange(granularity, from, to);
  if (!range) throw new AppError("Rango de fechas inválido.", 400);
  const { fromDate, toDate } = range;

  const [rawRows, vendorRows] = await Promise.all([
    rawSalesSeries(null, granularity, fromDate, toDate),
    prisma.$queryRaw`
      SELECT DATE_TRUNC(${granularity}, "createdAt") AS bucket, COUNT(*)::int AS count
      FROM "Vendor"
      WHERE "createdAt" >= ${fromDate} AND "createdAt" < ${toDate} AND "deletedAt" IS NULL
      GROUP BY bucket
    `,
  ]);

  const series = fillSeriesGaps(granularity, fromDate, toDate, rawRows);
  const vendorsByKey = new Map(vendorRows.map((r) => [bucketKey(new Date(r.bucket), granularity), Number(r.count)]));
  const seriesWithVendors = series.map((s) => ({ ...s, vendors: vendorsByKey.get(s.key) ?? 0 }));

  const total = series.reduce((sum, s) => sum + s.total, 0);
  const orders = series.reduce((sum, s) => sum + s.orders, 0);
  const vendors = seriesWithVendors.reduce((sum, s) => sum + s.vendors, 0);

  res.json({ granularity, from: fromDate.toISOString(), to: toDate.toISOString(), series: seriesWithVendors, total, orders, vendors });
}

// --- Tiendas -----------------------------------------------------------

// Bloque 76 (pedido explícito): una tienda bloqueada o suspendida
// desaparece de esta lista por completo — vive en "Tiendas suspendidas"
// (listSuspendedVendors) hasta que un admin la desbloquee/reactive, y recién
// ahí vuelve a aparecer acá.
// Bloque 243 (pedido explícito — "mejorar la estructura visual de Tiendas y
// mostrar más datos aprovechando todas las estadísticas y algoritmos"): igual
// que Clientes y Productos, pagina/busca/filtra/ordena en el servidor (antes
// traía TODAS las tiendas sin límite y la búsqueda era del lado del
// navegador), y suma datos reales por fila: productos, pedidos y ventas de los
// últimos 30 días, último acceso y anomalías de ranking pendientes. Todo se
// agrega con consultas agrupadas acotadas a los ids de la página (nunca una
// consulta por fila); el puntaje de salud (8 consultas por tienda) sigue
// siendo bajo demanda en el detalle.
// Quien consume la lista completa (AdminCampaigns, AdminChat,
// AdminSubscriptions) ahora usa `plan`, `provinceId`, `q` y `pageSize` para
// pedir solo lo que necesita (un conteo, 8 sugerencias, 20 opciones).
const DAY_MS_VENDORS = 24 * 60 * 60 * 1000;

const vendorsQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  // La clave de un plan (PlanConfig.planType, también uno creado por el admin) o uno de estos dos grupos:
  // PAID = cualquier plan de pago (lo usan las campañas para "tiendas con plan de pago"); DEFAULT = el plan por defecto.
  // Que la clave exista se comprueba en listVendors (400 si no). "PAID" y "DEFAULT" no chocan con un plan nuevo: las
  // claves generadas empiezan por "PLAN_" (planKeyFromName).
  plan: z.string().trim().regex(PLAN_KEY_PATTERN, "Ese plan no existe.").optional(),
  provinceId: z.string().optional(),
  // Con municipio salen las tiendas de ese municipio y las que atienden toda su provincia (misma regla que los filtros públicos).
  municipalityId: z.string().optional(),
  status: z.enum(["all", "verified", "inprocess", "unverified", "business", "inactive", "flagged", "deletion"]).default("all"),
  sort: z.enum(["recent", "name", "products", "rating", "lastLogin"]).default("recent"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

// `paidKeys` = getPaidPlanKeys(), leído una vez por listVendors (esta función es síncrona y se llama por cada contador).
function vendorStatusWhere(status, paidKeys) {
  const since = new Date(Date.now() - 30 * DAY_MS_VENDORS);
  switch (status) {
    case "verified":
      return { verificationStatus: "VERIFIED" };
    case "inprocess":
      return { verificationStatus: { in: ["PENDING_DOCS", "IN_REVIEW", "PENDING_PAYMENT"] } };
    case "unverified":
      return { verificationStatus: { in: ["NOT_STARTED", "REJECTED", "PAYMENT_FAILED", "PLAN_ENDED"] } };
    case "business":
      // Planes de pago (todos menos el plan por defecto y los gratis), pagados o en prueba.
      return { planType: { in: paidKeys } };
    case "inactive":
      // Mismo criterio de "último acceso" que vendorLifecycle.job.js: la
      // última sesión del dueño, o su fecha de alta si nunca entró.
      return { OR: [{ user: { lastLoginAt: { lt: since } } }, { user: { lastLoginAt: null }, createdAt: { lt: since } }] };
    case "flagged":
      return { rankingAnomalies: { some: { status: "PENDING" } } };
    default:
      return {};
  }
}

function vendorsOrderBy(sort, dir) {
  const map = {
    recent: [{ createdAt: dir }],
    name: [{ companyName: dir }],
    products: [{ products: { _count: dir } }],
    // A igual promedio, primero la que tiene más reseñas.
    rating: [{ rating: dir }, { reviewCount: dir }],
    lastLogin: [{ user: { lastLoginAt: { sort: dir, nulls: "last" } } }],
  };
  return [...map[sort], { id: "asc" }];
}

export async function listVendors(req, res) {
  const query = vendorsQuerySchema.parse(req.query);
  const { q, plan, provinceId, municipalityId, status, sort, dir } = query;
  const zone = vendorZoneWhere({ provinceId, municipalityId: provinceId ? municipalityId : undefined });

  // Las bloqueadas y suspendidas viven aparte (AdminSuspendedVendors).
  // Bloque 272: las de "eliminación pendiente" (bloqueadas a propósito) solo se ven con
  // el filtro "Eliminación pendiente"; no se mezclan con el resto ni con las suspendidas.
  const pendingView = status === "deletion";
  // PAID y DEFAULT no son claves de plan: se traducen una sola vez y los usan la
  // lista y los contadores de los filtros. Si baseScope recibía "PAID" tal cual,
  // la lista entera respondía 500 (el estimado de destinatarios de Campañas,
  // "Tiendas con plan de pago"). Una clave que no existe da 400, no una lista vacía.
  const paidKeys = await getPaidPlanKeys();
  let planWhere;
  if (plan === "PAID") planWhere = { in: paidKeys };
  else if (plan === "DEFAULT") planWhere = await getDefaultPlanKey();
  else if (plan) {
    // Archivados también: sus tiendas ya se movieron, pero un enlace viejo no debe dar error.
    if (!(await isValidPlanKey(plan, { allowArchived: true }))) throw new AppError("Ese plan no existe.", 400);
    planWhere = plan;
  }
  const scope = {
    deletedAt: null,
    ...(pendingView ? { adminDeletionRequestedAt: { not: null } } : { isBlocked: false, status: { not: "SUSPENDED" }, adminDeletionRequestedAt: null }),
    planType: planWhere,
    locations: zone,
  };
  const where = {
    AND: [
      scope,
      vendorStatusWhere(status, paidKeys),
      q
        ? {
            OR: [
              { companyName: { contains: q, mode: "insensitive" } },
              { slug: { contains: q, mode: "insensitive" } },
              { user: { email: { contains: q, mode: "insensitive" } } },
            ],
          }
        : {},
    ],
  };
  const baseScope = { deletedAt: null, isBlocked: false, status: { not: "SUSPENDED" }, adminDeletionRequestedAt: null, planType: planWhere, locations: zone };
  const deletionDays = await getVendorDeletionDays();
  const countFor = (s) => prisma.vendor.count({ where: { AND: [baseScope, vendorStatusWhere(s, paidKeys)] } });
  const countPending = () => prisma.vendor.count({ where: { deletedAt: null, adminDeletionRequestedAt: { not: null } } });

  const [vendors, total, kAll, kVerified, kInProcess, kUnverified, kBusiness, kInactive, kFlagged, kDeletion] = await Promise.all([
    prisma.vendor.findMany({
      where,
      include: {
        locations: { include: { province: true, municipality: true }, take: 30 },
        category: true,
        // El rubro que la tienda elige ahora es businessCategory; category queda para las tiendas viejas.
        businessCategory: { select: { name: true } },
        user: { select: { lastLoginAt: true, email: true } },
        _count: { select: { products: true } },
      },
      orderBy: vendorsOrderBy(sort, dir),
      ...pageArgs(query),
    }),
    prisma.vendor.count({ where }),
    countFor("all"),
    countFor("verified"),
    countFor("inprocess"),
    countFor("unverified"),
    countFor("business"),
    countFor("inactive"),
    countFor("flagged"),
    countPending(),
  ]);

  // Pedidos entregados y ventas de los últimos 30 días + anomalías pendientes,
  // agrupados por tienda para los ids de ESTA página. Order.total va en la
  // moneda única de la tienda (Vendor.currency), así que sumarlo por tienda
  // es un número honesto (a diferencia de sumar tiendas entre sí).
  // Mismo criterio que getVendorStats (el detalle de la tienda): una venta es
  // un pedido ENTREGADO más los pedidos de mesa (restaurantes), así la columna
  // y el modal de estadísticas hablan de lo mismo. Los de mesa cancelados no
  // cuentan. TableOrder no tiene vendorId propio: se agrupa por mesa y se
  // reparte a su tienda.
  const since30 = new Date(Date.now() - 30 * DAY_MS_VENDORS);
  const ids = vendors.map((v) => v.id);
  const [orderSales, tables, anomalies] = ids.length
    ? await Promise.all([
        prisma.order.groupBy({
          by: ["vendorId"],
          where: { vendorId: { in: ids }, status: "DELIVERED", createdAt: { gte: since30 } },
          _count: { _all: true },
          _sum: { total: true },
        }),
        prisma.table.findMany({ where: { vendorId: { in: ids } }, select: { id: true, vendorId: true } }),
        prisma.rankingAnomaly.groupBy({
          by: ["vendorId"],
          where: { vendorId: { in: ids }, status: "PENDING" },
          _count: { _all: true },
        }),
      ])
    : [[], [], []];
  const tableVendor = new Map(tables.map((t) => [t.id, t.vendorId]));
  const tableSales = tables.length
    ? await prisma.tableOrder.groupBy({
        by: ["tableId"],
        where: { tableId: { in: tables.map((t) => t.id) }, createdAt: { gte: since30 }, cancelledAt: null },
        _count: { _all: true },
        _sum: { total: true },
      })
    : [];
  const salesByVendor = new Map(ids.map((id) => [id, { orders30: 0, sales30: 0 }]));
  for (const s of orderSales) {
    const acc = salesByVendor.get(s.vendorId);
    acc.orders30 += s._count._all;
    acc.sales30 += Number(s._sum.total ?? 0);
  }
  for (const s of tableSales) {
    const acc = salesByVendor.get(tableVendor.get(s.tableId));
    if (!acc) continue;
    acc.orders30 += s._count._all;
    acc.sales30 += Number(s._sum.total ?? 0);
  }
  const anomaliesByVendor = new Map(anomalies.map((a) => [a.vendorId, a._count._all]));

  res.json({
    vendors: vendors.map((v) => {
      const s = salesByVendor.get(v.id);
      return withComputedVendorFields({
        ...v,
        productCount: v._count.products,
        // "Segundo Frente (Santiago de Cuba)": dónde presta servicio, con municipio (antes solo la provincia).
        zones: describeVendorZones(v.locations),
        orders30: s.orders30,
        sales30: s.sales30,
        pendingAnomalies: anomaliesByVendor.get(v.id) ?? 0,
        lastLoginAt: v.user?.lastLoginAt ?? null,
        deletionScheduledFor: v.adminDeletionRequestedAt ? new Date(v.adminDeletionRequestedAt.getTime() + deletionDays * 24 * 60 * 60 * 1000) : null,
      });
    }),
    kpis: { all: kAll, verified: kVerified, inprocess: kInProcess, unverified: kUnverified, business: kBusiness, inactive: kInactive, flagged: kFlagged, deletion: kDeletion },
    ...pageMeta(query, total),
  });
}

// Texto opcional de "Editar tienda": vacío o con al menos `min` caracteres (sin contar espacios al principio y al final).
const optionalAdminText = (min, message) =>
  z
    .string()
    .trim()
    .refine((v) => v === "" || v.length >= min, message)
    .optional()
    .nullable();

const updateVendorSchema = z.object({
  isBlocked: z.boolean().optional(),
  // Bloque 75 (pedido explícito): motivo obligatorio al bloquear — el
  // vendedor lo ve en su panel (VendorLayout.jsx) y lo usa para escribirle a
  // soporte con contexto real, en vez de quedar sin ninguna explicación.
  blockReason: z.string().trim().min(5, "Escribe un motivo de al menos 5 caracteres.").optional(),
  // Al bloquear: también a la lista negra (lib/blacklist.js). Sus datos no se pueden volver a usar en ningún registro.
  addToBlacklist: z.boolean().optional(),
  username: z.string().trim().max(40).optional(),
  // planType ya no se edita acá: cambiarlo solo dejaba una tienda en un plan con insignia sin la insignia, o en el plan por
  // defecto con insignia. El plan se cambia con "Activar plan" (grant-business) o la bajada al plan por defecto
  // (downgrade), que mueven plan e insignia juntos y lo anotan en VendorPlanChange.
  // Edición básica desde el admin (Bloque 12) — mismas reglas de forma que
  // el registro del vendedor.
  companyName: z.string().min(2).optional(),
  whatsapp: z.string().regex(E164_REGEX, "El WhatsApp debe incluir código de país (ej. +5355512345).").optional(),
  // "" además de un email válido — el form de edición del admin precarga el
  // campo vacío cuando la tienda no tiene correo cargado (vendor.email es
  // nullable); sin este union, reenviar el form sin tocar el campo falla
  // la validación de .email() con un string vacío.
  email: z.union([z.string().email(), z.literal("")]).optional(),
  // Bloque 165 (pedido explícito — "poder editar datos en tiendas y
  // corregir errores... como cambiar... nombre o descripción o lo que sea
  // que se pueda modificar"): el admin edita estos 4 SIN pasar por el
  // candado de identidad de updateMyVendor (vendors.controller.js) — ese
  // candado es justo para bloquear al VENDEDOR, el admin es la autoridad
  // que ese mismo candado remite a usar ("solicita un cambio desde tu
  // perfil" termina, del lado admin, aprobándose acá o en
  // decideVendorChangeRequest). Nullable — un admin corrigiendo un dato
  // vacío de una tienda vieja (ver Bloque 165 en verification.controller.js)
  // necesita poder mandar el valor real sin que null rompa nada.
  // También "" (como el email de arriba): EditVendorModal manda el formulario entero y precarga "" en los datos que la
  // tienda vieja no tiene, así que sin esto no se podía guardar ni un cambio de color. updateVendor lo guarda como null.
  ownerName: optionalAdminText(2, "El nombre del responsable debe tener al menos 2 caracteres."),
  ownerIdNumber: optionalAdminText(1),
  companyAddress: optionalAdminText(1),
  description: z.string().trim().optional().nullable(),
  // Bloque 222 (pedido explícito — "elimina que los vendedores puedan
  // cambiar el color de su tienda... solo el admin puede cambiar el color"):
  // el sistema lo asigna solo al crear la tienda (ver pickVendorColor,
  // vendors.controller.js); de ahí en más, solo este endpoint lo puede
  // tocar — ya no existe en updateVendorSchema del propio vendedor.
  color: z.string().trim().regex(/^#[0-9a-fA-F]{6}$/, "El color debe ser un código hex válido (ej. #232F3E).").optional(),
  // Rubro de la tienda (categoría de negocio): el admin lo corrige cuando ya no la describe (Categorías > De negocio muestra
  // en qué categorías vende cada tienda).
  businessCategoryId: z.string().trim().optional(),
});

export async function updateVendor(req, res) {
  const { id } = req.params;
  const data = updateVendorSchema.parse(req.body);
  if (data.email === "") data.email = null;
  // Vacío = no cambiar (una tienda vieja puede no tener rubro y el formulario lo manda en blanco).
  if (data.businessCategoryId === "") delete data.businessCategoryId;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  // Datos de identidad vacíos: si la tienda ya no los tenía, no se toca nada (el formulario precarga "" en una tienda
  // vieja). Si los tenía, vaciar el campo los borraría en silencio, y en una tienda verificada son los datos que se
  // revisaron con sus documentos: ahí se rechaza. En una sin verificar el admin sí puede borrar un dato equivocado.
  for (const key of ["ownerName", "ownerIdNumber", "companyAddress"]) {
    if (data[key] !== "" && data[key] !== null) continue;
    if (vendor[key] == null || String(vendor[key]).trim() === "") delete data[key];
    else if (vendor.verificationStatus === "VERIFIED") throw new AppError("No puedes dejar vacío un dato de una tienda verificada.", 400);
    else data[key] = null;
  }
  if (data.businessCategoryId && !(await prisma.businessCategory.findUnique({ where: { id: data.businessCategoryId }, select: { id: true } }))) {
    throw new AppError("Ese tipo de negocio no existe.", 400);
  }

  // Bloque 75 (pedido explícito, bug real reportado en vivo): "Bloquear"
  // dejaba al dueño sin ninguna forma de saber que su tienda estaba
  // bloqueada — el panel de vendedor no chequeaba isBlocked para nada, solo
  // status:"SUSPENDED" (inactividad). En vez de seguir bloqueando el LOGIN
  // en sí (lo que antes hacía esto vía User.isSuspended, y por eso una
  // sesión ya abierta se colaba sin aviso — exactamente el bug reportado),
  // ahora se unifica con el mismo mecanismo que ya usa la suspensión
  // automática: el vendedor puede entrar, pero VendorLayout.jsx lo detiene
  // con una pantalla real explicando el motivo + botón de contacto. Motivo
  // obligatorio al bloquear, se limpia solo al desbloquear.
  if (data.isBlocked === true && !data.blockReason && !vendor.blockReason) {
    throw new AppError("Escribe el motivo del bloqueo.", 400);
  }
  // En eliminación pendiente el bloqueo es parte de la eliminación: desbloquearla aquí la dejaba visible y el cron
  // (jobs/vendorDeletion.job.js) la eliminaba igual al cumplirse el plazo. Para conservarla está Restaurar.
  if (data.isBlocked === false && vendor.adminDeletionRequestedAt) {
    throw new AppError("Esta tienda está en eliminación pendiente: usa Restaurar para conservarla.", 409);
  }
  const changed = (key) => data[key] != null && String(data[key]).trim() !== String(vendor[key] ?? "").trim();
  const newUsername = data.username !== undefined && normalizeUsername(data.username) !== vendor.slug ? normalizeUsername(data.username) : undefined;
  await assertVendorUnique(
    {
      companyName: changed("companyName") ? data.companyName : undefined,
      whatsapp: changed("whatsapp") ? data.whatsapp : undefined,
      email: changed("email") ? data.email : undefined,
      ownerIdNumber: changed("ownerIdNumber") ? data.ownerIdNumber : undefined,
      username: newUsername,
      ownerUserId: vendor.userId,
    },
    vendor.id
  );
  if (data.addToBlacklist && data.isBlocked !== true) throw new AppError("La lista negra se aplica al bloquear la tienda.", 400);
  const vendorData = { ...data };
  delete vendorData.blockReason;
  delete vendorData.addToBlacklist;
  delete vendorData.username;
  if (newUsername) Object.assign(vendorData, { slug: newUsername, previousSlugs: [...new Set([...(vendor.previousSlugs ?? []), vendor.slug])].filter((x) => x !== newUsername) });
  if (data.isBlocked === true) {
    vendorData.blockReason = data.blockReason ?? vendor.blockReason;
    vendorData.blockedAt = vendor.blockedAt ?? new Date();
  }
  if (data.isBlocked === false) {
    vendorData.blockReason = null;
    vendorData.blockedAt = null;
    // Desbloquear una tienda suspendida por avisos de fraude: se detienen sus plazos y lo anterior deja de contar.
    if (vendor.fraudSuspendedAt) Object.assign(vendorData, { fraudSuspendedAt: null, fraudContactDueAt: null, fraudDeleteAt: null, fraudStrikesResetAt: new Date() });
  }

  const updated = await prisma.vendor.update({ where: { id }, data: vendorData });
  // Bloqueada por incumplir las normas y marcada para la lista negra: su correo, teléfonos, documento, nombre y usuario
  // no se pueden volver a usar en otra cuenta ni tienda. Una sola vez por tienda.
  if (data.addToBlacklist) {
    const already = await prisma.blacklistEntry.findFirst({ where: { vendorId: id, removedAt: null }, select: { id: true } });
    if (!already) {
      const owner = await prisma.user.findUnique({ where: { id: vendor.userId } });
      await addToBlacklist({ kind: "VENDOR", user: owner, vendor: updated, reason: vendorData.blockReason, addedById: req.user.id });
    }
  }
  if (data.isBlocked === true && !vendor.isBlocked) await adminNoticeToVendor(id, "Tu tienda fue bloqueada", `Motivo: ${vendorData.blockReason}. Escríbenos desde Mensajes si necesitas ayuda.`);
  else if (data.isBlocked === false && vendor.isBlocked) await adminNoticeToVendor(id, "Tu tienda fue desbloqueada", "Ya está visible otra vez y puedes vender con normalidad.");
  res.json({ vendor: updated });
}

// Zona de servicio de la tienda (provincia y municipios donde presta servicio), editable desde "Editar tienda" del admin.
// Misma regla que usa la propia tienda en Configuración (services/vendorZoneSync.service.js), sin el tope de provincias del
// plan: el admin corrige datos. Nunca deja a la tienda sin ninguna zona, porque sin zona no aparece en los filtros por lugar.
const adminZoneSchema = z.object({
  provinceId: z.string().min(1),
  municipalityIds: z.array(z.string().min(1)).max(2000).nullable(),
});

export async function adminSyncVendorZone(req, res) {
  const { provinceId, municipalityIds } = adminZoneSchema.parse(req.body);
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  if (municipalityIds?.length === 0) {
    const others = await prisma.vendorLocation.count({ where: { vendorId: vendor.id, NOT: { provinceId } } });
    if (others === 0) throw new AppError("La tienda tiene que quedar con al menos una zona. Agrega otra antes de quitar esta.", 400);
  }
  const locations = await syncVendorProvinceZone(vendor, { provinceId, municipalityIds }, { enforcePlan: false });
  const zone = describeVendorZones(locations).join(" · ") || "sin zona";
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: vendor.id,
    action: "admin_update_vendor_zone",
    description: `Un admin cambió la zona de servicio de "${vendor.companyName}": ${zone}`,
    meta: { vendorId: vendor.id, provinceId, municipalityIds },
  });
  await adminNoticeToVendor(vendor.id, "Actualizamos tu zona de servicio", `Ahora apareces en: ${zone}. Puedes revisarla en Configuración.`);
  res.json({ locations, zones: describeVendorZones(locations) });
}

// Bloque 165 (pedido explícito — "poder editar datos en tiendas... como
// cambiar la contraseña y correo... desde el panel de admin"): a diferencia
// del reset propio (auth.controller.js, resetPassword — pide un código
// enviado por correo), acá el admin YA está autenticado y autorizado, así
// que fija la contraseña nueva directo, sin ningún código de por medio —
// mismo hash (bcrypt, 10 rounds) que el resto del sistema.
const resetVendorPasswordSchema = z.object({
  newPassword: z.string().min(8, "La contraseña debe tener al menos 8 caracteres."),
});

// Cierra todas las sesiones abiertas de una cuenta. authenticate (middleware/auth.js) mira la sesión en cada petición, así
// que el token de acceso deja de servir al momento; sin esto seguía sirviendo hasta su hora de vida aunque el admin hubiera
// cambiado la contraseña o el correo, o suspendido al cliente. `forgetDevices` también borra el dispositivo de confianza,
// para que el próximo inicio de sesión vuelva a pedir la verificación (igual que el cambio de contraseña propio en
// auth.controller.js).
async function revokeUserSessions(userId, { forgetDevices = false } = {}) {
  const now = new Date();
  await prisma.$transaction([
    prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
    ...(forgetDevices ? [prisma.trustedDevice.deleteMany({ where: { userId } })] : []),
  ]);
}

export async function resetVendorPassword(req, res) {
  const { id } = req.params;
  const { newPassword } = resetVendorPasswordSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);

  const passwordHash = await bcrypt.hash(newPassword, 10);
  await prisma.user.update({ where: { id: vendor.userId }, data: { passwordHash } });
  await revokeUserSessions(vendor.userId, { forgetDevices: true });

  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: vendor.id,
    action: "admin_reset_vendor_password",
    description: `Un admin restableció la contraseña de "${vendor.companyName}"`,
    meta: { vendorId: vendor.id },
  });
  res.json({ ok: true });
}

// ¿El correo está en la lista negra por otra persona? La propia cuenta sí puede conservar el suyo. Consulta propia en vez de
// findBlacklisted(datos, self): su NOT sobre userId/vendorId deja fuera las filas con esas columnas en null (en SQL,
// NOT (x = a OR NULL) no es verdadero), así que una entrada de cliente (vendorId null) no frenaba el correo de una tienda.
async function emailBlacklistedForOthers(email, userId) {
  return prisma.blacklistEntry.findFirst({
    where: { removedAt: null, email: normEmail(email), OR: [{ userId: null }, { userId: { not: userId } }] },
    select: { id: true },
  });
}

// Bloque 165: correo de LOGIN (User.email, único en toda la plataforma) —
// distinto de Vendor.email (contacto público de la tienda, ya editable
// desde updateVendor de arriba). Nunca se puede repetir un correo ya en uso
// por otra cuenta. emailField ya lo deja sin espacios y en minúsculas.
const updateVendorLoginEmailSchema = z.object({
  email: emailField("Ingresa un correo válido."),
});

export async function updateVendorLoginEmail(req, res) {
  const { id } = req.params;
  const { email } = updateVendorLoginEmailSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id }, include: { user: { select: { email: true } } } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  // El mismo correo: nada que cambiar (y no se cierran sus sesiones por nada).
  const previousEmail = vendor.user?.email ?? null;
  if (previousEmail === email) return res.json({ ok: true });
  const sameAddress = previousEmail?.toLowerCase() === email;

  // Sin distinguir mayúsculas: una cuenta vieja guardada como "Juan@x.com" también cuenta como ocupada.
  const taken = await prisma.user.findFirst({ where: { email: { equals: email, mode: "insensitive" }, id: { not: vendor.userId } } });
  if (taken) throw new AppError("Ese correo ya está en uso por otra cuenta.", 409);
  // Mismo control que al cambiar el correo uno mismo (auth.controller.js): un correo de la lista negra no vuelve a usarse
  // en otra cuenta. La propia tienda sí puede conservar el suyo.
  if (await emailBlacklistedForOthers(email, vendor.userId)) {
    throw new AppError("Ese correo está en la lista negra. Para usarlo, primero quítalo de la lista negra.", 409);
  }

  await prisma.user.update({ where: { id: vendor.userId }, data: { email } });
  // Quien tenía la sesión abierta con el correo anterior tiene que volver a entrar con el nuevo (pasar a minúsculas el
  // mismo correo no cuenta como cambio).
  if (!sameAddress) await revokeUserSessions(vendor.userId, { forgetDevices: true });

  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: vendor.id,
    action: "admin_changed_vendor_login_email",
    description: `Un admin cambió el correo de acceso de "${vendor.companyName}"`,
    meta: { vendorId: vendor.id, previousEmail, newEmail: email },
  });
  res.json({ ok: true });
}

// Bloque 62/76: pantalla propia (AdminSuspendedVendors.jsx) — junta las 2
// formas en que una tienda queda inhabilitada (bloqueo manual del admin O
// suspensión automática por inactividad), porque para el vendedor el
// resultado es el mismo (tienda oculta, panel bloqueado) y el admin necesita
// verlas juntas para saber qué tiendas requieren su atención. Cada fila trae
// su propio motivo/fecha — la UI (AdminSuspendedVendors.jsx) decide qué
// mostrar y qué acción ofrecer (Desbloquear vs Reactivar) según cuál de los
// 2 campos esté seteado.
export async function listSuspendedVendors(_req, res) {
  const vendors = await prisma.vendor.findMany({
    where: { OR: [{ status: "SUSPENDED" }, { isBlocked: true }], adminDeletionRequestedAt: null, deletedAt: null },
    // select explícito: antes iba la fila completa, con los ids de Stripe de la tienda, a una pantalla que no los usa.
    select: {
      id: true,
      companyName: true,
      slug: true,
      color: true,
      status: true,
      isBlocked: true,
      blockReason: true,
      blockedAt: true,
      suspendedAt: true,
      suspensionReason: true,
      billingSuspendedAt: true,
      nextPaymentDueDate: true,
      locations: { select: { province: { select: { id: true, name: true } } }, take: 1 },
      category: { select: { id: true, name: true } },
      user: { select: { fullName: true, email: true, lastLoginAt: true } },
    },
    orderBy: [{ blockedAt: "desc" }, { suspendedAt: "desc" }],
  });
  res.json({ vendors });
}

const reactivateVendorSchema = z.object({
  reason: z.string().trim().min(5, "Escribe un motivo de al menos 5 caracteres."),
});

// Bloque 62: única forma de sacar a una tienda de SUSPENDED — a diferencia
// de isBlocked (reversible con un clic desde AdminVendors.jsx), acá el
// motivo es obligatorio y queda un VendorStatusLog con byAdminId, porque
// llegar a SUSPENDED nunca fue una decisión de un admin (lo puso el cron
// de inactividad solo) y reactivarla sí lo es.
export async function reactivateVendor(req, res) {
  const { id } = req.params;
  const { reason } = reactivateVendorSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id }, include: { user: true } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  if (vendor.status !== "SUSPENDED") throw new AppError("Esta tienda no está suspendida.", 400);

  const now = new Date();
  const [updated] = await prisma.$transaction([
    prisma.vendor.update({
      where: { id },
      // Suspendida por falta de pago: además de volver a verse, recibe una semana para pagar (adminReactivationBillingData).
      data: { status: "ACTIVE", reactivatedAt: now, reactivationReason: reason, ...adminReactivationBillingData(vendor) },
    }),
    prisma.vendorStatusLog.create({
      data: { vendorId: id, fromStatus: "SUSPENDED", toStatus: "ACTIVE", reason, byAdminId: req.user.id },
    }),
  ]);

  await sendVendorReactivatedEmail({ ...updated, user: vendor.user }, reason);
  await adminNoticeToVendor(id, "Tu tienda fue reactivada", reason);
  res.json({ vendor: updated });
}

// Soft-delete: nunca se borra la fila (pedidos/reseñas históricos necesitan
// vendorId intacto). Se fuerza isBlocked:true para que los ~8 puntos del
// código que ya filtran "vendor.isBlocked:false" la oculten automáticamente
// (público, búsqueda, reseñas, pedidos nuevos) sin tocar cada uno de nuevo.
// La cuenta del dueño no se suspende: puede iniciar sesión, pero VendorLayout.jsx le muestra la pantalla de tienda
// bloqueada con el motivo (el mismo mecanismo que el bloqueo manual, ver updateVendor).
// El bloqueo que la tienda ya tuviera se guarda en preDeletionBlockReason/preDeletionBlockedAt para que Restaurar lo
// devuelva: si no, restaurar desbloqueaba a una tienda bloqueada por normas.
const PENDING_DELETION_BLOCK_PREFIX = "La tienda está en eliminación pendiente";

export async function deleteVendor(req, res) {
  const { id } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  if (vendor.adminDeletionRequestedAt) throw new AppError("Esta tienda ya está en eliminación pendiente.", 409);

  // Bloque 272 (pedido explícito): eliminar NO borra todavía. La tienda queda oculta y
  // bloqueada en "eliminación pendiente" durante `vendorDeletionDays` (30 por defecto); el
  // admin puede restaurarla o eliminarla ya con un código al correo, y si no hace nada el
  // cron (jobs/vendorDeletion.job.js) la elimina al cumplirse el plazo.
  const now = new Date();
  const days = await getVendorDeletionDays();
  await prisma.vendor.update({
    where: { id },
    data: {
      adminDeletionRequestedAt: now,
      adminDeletionRequestedById: req.user.id,
      adminDeletionReminderSentAt: null,
      preDeletionBlockReason: vendor.isBlocked ? vendor.blockReason : null,
      preDeletionBlockedAt: vendor.isBlocked ? (vendor.blockedAt ?? now) : null,
      isBlocked: true,
      blockedAt: now,
      blockReason: `${PENDING_DELETION_BLOCK_PREFIX}: se eliminará definitivamente en ${days} días si no se restaura.`,
    },
  });
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: vendor.id,
    action: "admin_delete_vendor",
    description: `Un admin pasó "${vendor.companyName}" a eliminación pendiente (${days} días)`,
    meta: { vendorId: vendor.id, days, wasBlocked: vendor.isBlocked, previousBlockReason: vendor.isBlocked ? vendor.blockReason : null },
  });
  res.json({ ok: true, scheduledFor: new Date(now.getTime() + days * 24 * 60 * 60 * 1000) });
}

export async function getVendorDeletionDays() {
  const settings = await prisma.siteSettings.findFirst({ select: { vendorDeletionDays: true } });
  return settings?.vendorDeletionDays ?? 30;
}

// Cancela la eliminación pendiente y devuelve la tienda al estado de antes: visible si no estaba bloqueada, o bloqueada
// con su motivo y fecha de entonces. Si mientras tanto la bloquearon con otro motivo (avisos de fraude en lib/moderation.js
// o el admin), ese bloqueo nuevo se conserva: el motivo ya no es el de la eliminación.
export async function restoreVendorDeletion(req, res) {
  const { id } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt || !vendor.adminDeletionRequestedAt) throw new AppError("Esta tienda no está en eliminación pendiente.", 404);
  const reblocked = vendor.isBlocked && !!vendor.blockReason && !vendor.blockReason.startsWith(PENDING_DELETION_BLOCK_PREFIX);
  // Ya no está bloqueada: alguien levantó el bloqueo durante la eliminación pendiente (por ejemplo, Reactivar una tienda
  // suspendida por avisos de fraude, que pone isBlocked en false). Ese bloqueo de antes ya se revisó y se quitó, así que
  // reponerlo con preDeletionBlockReason la volvía a bloquear por un motivo que ya no vale.
  const block = !vendor.isBlocked
    ? { isBlocked: false, blockReason: null, blockedAt: null }
    : reblocked
      ? { isBlocked: true, blockReason: vendor.blockReason, blockedAt: vendor.blockedAt }
      : { isBlocked: !!vendor.preDeletionBlockedAt, blockReason: vendor.preDeletionBlockReason, blockedAt: vendor.preDeletionBlockedAt };
  await prisma.vendor.update({
    where: { id },
    data: {
      adminDeletionRequestedAt: null,
      adminDeletionRequestedById: null,
      adminDeletionReminderSentAt: null,
      preDeletionBlockReason: null,
      preDeletionBlockedAt: null,
      ...block,
    },
  });
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: vendor.id,
    action: "admin_restore_vendor",
    description: block.isBlocked
      ? `Un admin restauró "${vendor.companyName}" de la eliminación pendiente; sigue bloqueada: ${block.blockReason ?? "sin motivo"}`
      : `Un admin restauró "${vendor.companyName}" de la eliminación pendiente`,
    meta: { vendorId: vendor.id, stillBlocked: block.isBlocked },
  });
  res.json({ ok: true, isBlocked: block.isBlocked });
}

// Eliminación DEFINITIVA, sin esperar el plazo. Solo para tiendas que ya están en
// eliminación pendiente, y siempre con el código enviado al correo del admin
// (requireActionCode("DELETE_VENDOR_PERMANENT") en la ruta).
export async function permanentlyDeleteVendor(req, res) {
  const { id } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  if (!vendor.adminDeletionRequestedAt) throw new AppError("Primero elimina la tienda (queda pendiente) y luego podrás eliminarla definitivamente.", 400);
  await finalizeUserDeletion(vendor.userId, { source: "ADMIN", byId: req.user.id, reason: vendor.blockReason ?? null });
  res.status(204).end();
}

// Estadísticas reales de una tienda, todo calculado server-side. "Ventas"
// cuenta pedidos normales DELIVERED + todos los TableOrder (las mesas no
// tienen un estado "cancelado" en el schema, así que cada uno representa una
// venta real cerrada). "Producto más vendido" solo mira OrderItem (pedidos
// normales) — los ítems de TableOrder viven en un campo JSON sin relación,
// no hay forma limpia de agregarlos server-side sin escanear todo a mano.
export async function getVendorStats(req, res) {
  const { id } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const [orderAgg, tableOrderAgg, topItems] = await Promise.all([
    prisma.order.aggregate({ where: { vendorId: id, status: "DELIVERED" }, _sum: { total: true }, _count: true }),
    prisma.tableOrder.aggregate({ where: { table: { vendorId: id } }, _sum: { total: true }, _count: true }),
    prisma.orderItem.groupBy({
      by: ["name"],
      where: { order: { vendorId: id, status: "DELIVERED" } },
      _sum: { quantity: true },
      orderBy: { _sum: { quantity: "desc" } },
      take: 1,
    }),
  ]);

  const salesTotal = Number(orderAgg._sum.total ?? 0) + Number(tableOrderAgg._sum.total ?? 0);
  const orderCount = orderAgg._count + tableOrderAgg._count;

  res.json({
    stats: {
      salesTotal,
      orderCount,
      avgTicket: orderCount > 0 ? salesTotal / orderCount : 0,
      topProduct: topItems[0]?.name ?? null,
      rating: Number(vendor.rating),
      // Calificación real: cantidad y desglose de 5 a 1 estrellas (ver lib/ratings.js).
      reviews: await ratingSummary({ vendorId: vendor.id }),
    },
  });
}

// Auditoría de seguridad: antes el admin solo veía si una tienda "tuvo o no"
// actividad de mesas (booleano agregado en getVendorStats/dashboard), sin
// ninguna forma de ver el CONTENIDO real de un pedido de mesa — para
// investigar un reclamo puntual necesitaba entrar a Prisma Studio. Acá se
// expone el detalle real (ítems, mesa, estado), de solo lectura.
export async function getVendorTableOrders(req, res) {
  const { id } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const tableOrders = await prisma.tableOrder.findMany({
    where: { table: { vendorId: id } },
    include: { table: { select: { tableNumber: true } } },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json({ tableOrders });
}

// --- Usuarios de sistema de un vendedor (Bloque 183, pedido explícito —
// "el administrador general del sistema también puede controlar y
// verificar lo mismo que pueda hacer el vendedor... poder verificar cuáles
// son los usuarios que ha creado ese vendedor, si están activos, podrá
// modificarlos y ver todo el seguimiento de cada uno"): mismas
// capacidades que vendorStaff.controller.js le da al propio dueño, pero
// tomando el vendorId/staffId de la URL en vez de resolverlo desde
// req.user — un admin puede tocar los usuarios de CUALQUIER tienda. -------

function publicStaffAdmin(staff) {
  const { user, vendor, ...rest } = staff;
  return {
    ...rest,
    email: user.email,
    fullName: user.fullName,
    isSuspended: user.isSuspended,
    lastLoginAt: user.lastLoginAt,
    vendorId: vendor.id,
    vendorName: vendor.companyName,
  };
}

export async function listVendorStaff(req, res) {
  const { id: vendorId } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const staff = await prisma.vendorStaff.findMany({
    where: { vendorId },
    include: {
      user: { select: { email: true, fullName: true, isSuspended: true, lastLoginAt: true } },
      vendor: { select: { id: true, companyName: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ staff: staff.map(publicStaffAdmin) });
}

async function findVendorStaffOr404(staffId) {
  const staff = await prisma.vendorStaff.findUnique({
    where: { id: staffId },
    include: {
      user: { select: { id: true, email: true, fullName: true, isSuspended: true, lastLoginAt: true } },
      vendor: { select: { id: true, companyName: true } },
    },
  });
  if (!staff) throw new AppError("Usuario no encontrado.", 404);
  return staff;
}

// Bloque 187 (bug real reportado en vivo — el admin no tenía forma de
// guardar el nivel view/manage que sí existe del lado del vendedor desde
// Bloque 185: `allowedSections` acá seguía siendo `z.array(z.string())`
// suelto en vez del enum, y `sectionPermissions` no existía ni en el
// schema ni en el `data` del update — cualquier intento de mandarlo se
// descartaba en silencio): mismo criterio de paridad que el resto de este
// archivo ("el admin puede controlar y verificar lo mismo que el
// vendedor").
const updateVendorStaffByAdminSchema = z.object({
  fullName: z.string().trim().min(2).optional(),
  email: emailField().optional(),
  // Bloque 200: ya NO exige mínimo 1 — mismo criterio que
  // vendorStaff.controller.js (un usuario sin ninguna sección es válido,
  // solo ve "Mi perfil").
  allowedSections: z.array(z.enum(VENDOR_SECTION_KEYS)).optional(),
  sectionPermissions: z.record(z.enum(VENDOR_SECTION_KEYS), z.enum(["view", "manage"])).optional(),
  isActive: z.boolean().optional(),
  staffType: z.enum(["SALES_AGENT", "WAITER"]).nullable().optional(),
});

export async function updateVendorStaffByAdmin(req, res) {
  const staff = await findVendorStaffOr404(req.params.id);
  const data = updateVendorStaffByAdminSchema.parse(req.body);

  if (data.email) {
    const existing = await prisma.user.findFirst({ where: { email: { equals: data.email, mode: "insensitive" } } });
    if (existing && existing.id !== staff.userId) throw new AppError("Ese correo ya está en uso por otra cuenta.", 409);
  }

  // Bloque 187/200: mismo criterio que updateMyStaff (vendorStaff.controller.js)
  // — si esta llamada cambia allowedSections, sectionPermissions se
  // recalcula contra la lista NUEVA, nunca la vieja; cambiar el tipo agrega
  // sus secciones default (union, nunca reemplazo).
  const sectionsBeforeTypeMerge = data.allowedSections ?? staff.allowedSections;
  const nextSections =
    data.staffType !== undefined ? withStaffTypeSections(sectionsBeforeTypeMerge, data.staffType) : sectionsBeforeTypeMerge;
  const nextPermissions = data.sectionPermissions
    ? { ...(staff.sectionPermissions ?? {}), ...data.sectionPermissions }
    : staff.sectionPermissions;

  const [updatedUser, updatedStaff] = await prisma.$transaction([
    prisma.user.update({
      where: { id: staff.userId },
      data: {
        ...(data.fullName ? { fullName: data.fullName.trim() } : {}),
        ...(data.email ? { email: data.email.trim().toLowerCase() } : {}),
      },
    }),
    prisma.vendorStaff.update({
      where: { id: staff.id },
      data: {
        ...(data.allowedSections || data.staffType !== undefined ? { allowedSections: nextSections } : {}),
        ...(data.isActive != null ? { isActive: data.isActive } : {}),
        ...(data.staffType !== undefined ? { staffType: data.staffType } : {}),
        sectionPermissions: pruneSectionPermissions(nextSections, nextPermissions),
      },
    }),
  ]);

  if (data.isActive === false) {
    await prisma.session.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } });
  }

  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: staff.vendorId,
    action: "admin_updated_vendor_staff",
    description: `Un admin actualizó al usuario "${updatedUser.fullName}" (${updatedUser.email}) de "${staff.vendor.companyName}"`,
    meta: { staffUserId: staff.userId, changes: data },
  });

  res.json({ staff: publicStaffAdmin({ ...updatedStaff, user: updatedUser, vendor: staff.vendor }) });
}

// Bloque 183: mismo criterio que resetMyStaffPassword (vendorStaff.controller.js)
// — nunca una contraseña que el admin escribe por la persona, siempre
// mustSetPassword para que la elija ella misma por el flujo de código.
export async function resetVendorStaffPasswordByAdmin(req, res) {
  const staff = await findVendorStaffOr404(req.params.id);

  const unusablePasswordHash = await bcrypt.hash(randomBytes(32).toString("hex"), 10);
  await prisma.user.update({ where: { id: staff.userId }, data: { passwordHash: unusablePasswordHash, mustSetPassword: true } });
  await prisma.session.updateMany({ where: { userId: staff.userId, revokedAt: null }, data: { revokedAt: new Date() } });

  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: staff.vendorId,
    action: "admin_reset_vendor_staff_password",
    description: `Un admin restableció la contraseña de "${staff.user.fullName}" (${staff.user.email}) de "${staff.vendor.companyName}"`,
    meta: { staffUserId: staff.userId },
  });

  res.json({ ok: true });
}

export async function getVendorStaffActivityByAdmin(req, res) {
  const staff = await findVendorStaffOr404(req.params.id);
  const activity = await prisma.activityLog.findMany({
    where: { actorId: staff.userId },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  res.json({ activity });
}

export async function getVendorStaffSessionsByAdmin(req, res) {
  const staff = await findVendorStaffOr404(req.params.id);
  const sessions = await prisma.session.findMany({
    where: { userId: staff.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
    select: { id: true, userAgent: true, createdAt: true, lastUsedAt: true, expiresAt: true, revokedAt: true },
  });
  res.json({ sessions });
}

// --- Verificaciones KYC + cobro de suscripción (Bloque 16) -----------------

// Bloque 64: la lista es una fila por TIENDA (no por VerificationRequest —
// el estado vive en Vendor.verificationStatus ahora), con los datos de
// documentos/pago anidados. Sin `status` en el query, excluye NOT_STARTED
// (tiendas que nunca iniciaron el trámite no tienen nada que revisar acá).
export async function listVerifications(req, res) {
  const { status } = req.query;
  // Bloque 64: acepta uno o varios valores separados por coma (AdminVerifications.jsx
  // agrupa PENDING_DOCS+IN_REVIEW en una sola pestaña, PAYMENT_FAILED+SUSPENDED en otra).
  const statuses = status ? String(status).toUpperCase().split(",") : null;
  const vendors = await prisma.vendor.findMany({
    // Sin las tiendas eliminadas: una tienda borrada y vuelta a registrar con el mismo nombre salía dos veces (la vieja en
    // Verificadas y la nueva en Pago pendiente), como si una misma tienda tuviera dos estados.
    where: { deletedAt: null, verificationStatus: statuses && !statuses.includes("ALL") ? { in: statuses } : { not: "NOT_STARTED" } },
    include: {
      verification: true,
      // Todas las provincias donde opera (antes solo la primera) y lo demás que la tienda cargó: el admin ve en la
      // solicitud todo lo que envió, sin ir a buscarlo a otro lado.
      locations: { include: { province: true, country: true } },
      businessCategory: { select: { name: true } },
      user: { select: { email: true, phone: true, fullName: true, createdAt: true } },
      _count: { select: { products: true } },
      // Bloque 66: datos legales privados de verificación — solo se exponen
      // acá (panel de admin), nunca en un endpoint público.
      registrationCountry: true,
      legalProvince: true,
      legalMunicipality: true,
      // Bloque 145 (pedido explícito — "24 horas luego de ser aprobada"): el
      // admin también ve cuánto le queda a cada solicitud en Pago pendiente,
      // mismo cálculo real que usa el cron (expireStalePendingPaymentApprovals).
      verificationStatusLogs: { where: { toStatus: "PENDING_PAYMENT" }, orderBy: { at: "desc" }, take: 1 },
    },
    orderBy: { createdAt: "desc" },
  });

  // Bloque 153 (pedido explícito — "debe salir... desde cuándo se
  // verificó"): la transición MÁS RECIENTE a VERIFIED por tienda — consulta
  // aparte porque Prisma no permite 2 filtros distintos sobre la MISMA
  // relación (verificationStatusLogs) dentro de un solo `include`.
  // `distinct` + `orderBy` de más reciente a más viejo da, por vendorId,
  // solo la entrada vigente (si perdió y recuperó la verificación varias
  // veces, esta es la del ciclo actual, no la primera vez de todas).
  const verifiedSinceLogs = await prisma.verificationStatusLog.findMany({
    where: { vendorId: { in: vendors.map((v) => v.id) }, toStatus: "VERIFIED" },
    orderBy: { at: "desc" },
    distinct: ["vendorId"],
  });
  const verifiedSinceByVendor = new Map(verifiedSinceLogs.map((l) => [l.vendorId, l.at]));

  // Monto esperado de cada pago según el plan elegido y su descuento por meses (el mismo cálculo que cobra el servidor).
  const quotes = await Promise.all(
    vendors.map((v) =>
      v.verification?.paymentMonths
        ? quotePlan(v.verification.paymentPlanType, v.verification.paymentMonths, v.verification.paymentCurrency === "USD" ? "CARD" : "CUP_TRANSFER").catch(() => null)
        : null
    )
  );

  const verifications = vendors.map((v, i) => ({
    id: v.verification?.id ?? v.id,
    vendorId: v.id,
    verificationStatus: v.verificationStatus,
    nextPaymentDueDate: v.nextPaymentDueDate,
    // Bloque 153: "desde cuándo se registró" (Vendor.createdAt, siempre
    // real, nunca se pisa) y "desde cuándo está verificada" (la transición
    // vigente a VERIFIED, null si nunca lo estuvo o la perdió) — separado
    // del `createdAt` de más abajo, que es el de la SOLICITUD actual.
    vendorCreatedAt: v.createdAt,
    verifiedSince: verifiedSinceByVendor.get(v.id) ?? null,
    // Bloque 145: solo tiene sentido mientras sigue en PENDING_PAYMENT — una
    // vez que pasa a VERIFIED/REJECTED/etc. el plazo ya no aplica.
    paymentDeadlineAt:
      v.verificationStatus === "PENDING_PAYMENT" && v.verificationStatusLogs[0]
        ? new Date(v.verificationStatusLogs[0].at.getTime() + 24 * 60 * 60 * 1000)
        : null,
    vendor: {
      id: v.id,
      companyName: v.companyName,
      email: v.email,
      // Bloque 145 (pedido explícito — "recopilar más información"): el
      // admin no tenía forma de contactar a la tienda desde esta pantalla
      // sin ir a buscarla a otro lado.
      whatsapp: v.whatsapp,
      color: v.color,
      locations: v.locations,
      description: v.description,
      ownerIdNumber: v.ownerIdNumber,
      companyTaxId: v.companyTaxId,
      registrationCountry: v.registrationCountry?.name ?? v.registrationCountryOther ?? null,
      legalProvince: v.legalProvince?.name ?? v.legalProvinceOther ?? null,
      legalMunicipality: v.legalMunicipality?.name ?? v.legalMunicipalityOther ?? null,
      // Datos legales escritos a mano (no estaban en el catálogo): el admin los revisa con más cuidado.
      legalWrittenByHand: [v.registrationCountryOther && "país", v.legalProvinceOther && "provincia", v.legalMunicipalityOther && "municipio"].filter(Boolean),
      companyAddress: v.companyAddress,
      ownerName: v.ownerName,
      businessCategory: v.businessCategory?.name ?? null,
      operatesIn: [...new Set(v.locations.map((l) => l.province?.name ?? l.stateOther ?? l.country?.name).filter(Boolean))],
      logoUrl: v.logoUrl,
      products: v._count.products,
      accountEmail: v.user?.email ?? null,
      accountPhone: v.user?.phone ?? null,
      accountName: v.user?.fullName ?? null,
    },
    fullName: v.verification?.fullName ?? null,
    idNumber: v.verification?.idNumber ?? null,
    idDocumentType: v.verification?.idDocumentType ?? null,
    selfieUrl: v.verification?.selfieUrl ?? null,
    idPhotoFrontUrl: v.verification?.idPhotoFrontUrl ?? null,
    // Antes no se mandaba y el reverso del documento nunca se veía en la solicitud.
    idPhotoBackUrl: v.verification?.idPhotoBackUrl ?? null,
    selfieVideoUrl: v.verification?.selfieVideoUrl ?? null,
    paymentNote: v.verification?.paymentNote ?? null,
    notes: v.verification?.notes ?? null,
    paymentMethod: v.verification?.paymentMethod ?? null,
    // Bloque 150: cuántos meses eligió pagar y lo que declaró al reclamar el
    // pago — quién pagó, con qué cuenta/teléfono (CUP) o los datos de
    // respaldo si no pudo subir captura (CARD), y el monto que dice haber
    // pagado (lo que el admin compara contra lo esperado antes de confirmar).
    paymentMonths: v.verification?.paymentMonths ?? null,
    paymentCurrency: v.verification?.paymentCurrency ?? null,
    paymentPlanType: v.verification?.paymentMonths ? paymentPlanOf(v.verification.paymentPlanType) : null,
    paymentPlanName: quotes[i]?.config.displayName ?? null,
    discountPercent: quotes[i]?.discountPercent ?? 0,
    expectedAmount: quotes[i]?.total ?? null,
    paymentAmount: v.verification?.paymentAmount ?? null,
    payerName: v.verification?.payerName ?? null,
    payerAccountNumber: v.verification?.payerAccountNumber ?? null,
    payerPhone: v.verification?.payerPhone ?? null,
    payerAddress: v.verification?.payerAddress ?? null,
    payerCountry: v.verification?.payerCountry ?? null,
    payerCardLast4: v.verification?.payerCardLast4 ?? null,
    paymentProofUrl: v.verification?.paymentProofUrl ?? null,
    paymentProofUnavailable: v.verification?.paymentProofUnavailable ?? false,
    paymentClaimedAt: v.verification?.paymentClaimedAt ?? null,
    stripePaidAt: v.verification?.stripePaidAt ?? null,
    paymentConfirmedAt: v.verification?.paymentConfirmedAt ?? null,
    paymentConfirmedById: v.verification?.paymentConfirmedById ?? null,
    stripeCheckoutUrl: v.verification?.stripeCheckoutUrl ?? null,
    stripeCheckoutExpiresAt: v.verification?.stripeCheckoutExpiresAt ?? null,
    createdAt: v.verification?.createdAt ?? v.createdAt,
  }));
  res.json({ verifications });
}

// Bloque 64: acción ligera para que un admin "tome" una solicitud —
// PENDING_DOCS -> IN_REVIEW, sin notificar al vendedor (no es una decisión
// todavía, solo evita que dos admins revisen la misma solicitud a ciegas).
// Mismo :id que updateVerification/confirmCupPayment (VerificationRequest.id).
export async function startVerificationReview(req, res) {
  const { id } = req.params;
  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  if (verification.vendor.verificationStatus !== "PENDING_DOCS") {
    throw new AppError("Esta solicitud no está esperando que se abra para revisión.", 409);
  }
  const updated = await transitionVendorVerification(verification.vendorId, "IN_REVIEW", { actorId: req.user.id, source: "ADMIN_ACTION" });
  res.json({ vendor: updated });
}

const decideVerificationSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().optional(),
});

// Fase 1 (documentos): aprobar NO activa la verificación todavía — solo pasa
// la solicitud a PENDING_PAYMENT. El badge/Plan Business se activan recién
// en la fase 2 (ver confirmSubscriptionPayment más abajo — desde el Bloque
// 150 esa fase es SIEMPRE una confirmación manual del admin, tarjeta o CUP
// por igual). Rechazar sí es definitivo en esta fase. Nunca se puede
// aprobar sin las 2 fotos — submitVerification ya las exige juntas.
export async function updateVerification(req, res) {
  const { id } = req.params;
  const { decision, notes } = decideVerificationSchema.parse(req.body);

  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  if (!["PENDING_DOCS", "IN_REVIEW"].includes(verification.vendor.verificationStatus)) {
    throw new AppError("Esta solicitud ya no está en revisión de documentos.", 409);
  }
  if (decision === "reject" && !notes?.trim()) throw new AppError("Indica el motivo del rechazo.", 400);
  if (decision === "approve" && !(verification.selfieUrl && verification.idPhotoFrontUrl)) {
    throw new AppError("Faltan documentos: no se puede aprobar una solicitud incompleta.", 409);
  }

  await prisma.verificationRequest.update({
    where: { id },
    data: { notes: notes ?? null, reviewedById: req.user.id, reviewedAt: new Date() },
  });
  // Bloque 150: refleja la revisión en la rama de archivo vigente — el
  // rejectedAt (si aplica) ya lo cierra transitionVendorVerification abajo.
  await syncVerificationArchive(verification.vendorId, { reviewedAt: new Date(), reviewedById: req.user.id, notes: notes ?? null });

  const toStatus = decision === "approve" ? "PENDING_PAYMENT" : "REJECTED";
  const updated = await transitionVendorVerification(verification.vendorId, toStatus, {
    reason: notes ?? null,
    actorId: req.user.id,
    source: "ADMIN_ACTION",
    notify: { type: decision === "approve" ? "VERIFICATION_DOCS_APPROVED" : "VERIFICATION_DOCS_REJECTED" },
  });

  res.json({ verification: updated });
}

// Fase 2 (Bloque 150, reescribe confirmCupPayment de antes): ahora cubre
// CARD Y CUP_TRANSFER por igual — "el administrador reciba correctamente el
// documento... y de allí pueda concluir y finalizar la aprobación". Ninguno
// de los 2 métodos se confirma solo: Stripe deja `stripePaidAt` por webhook
// (checkout.session.completed, ver verification.controller.js) pero el
// admin igual revisa el comprobante/datos declarados por el vendedor antes
// de activar — mismo criterio que ya regía para CUP desde el Bloque 16.
// También cubre la RENOVACIÓN (Bloque 64): una tienda en PAYMENT_FAILED/
// SUSPENDED por vencimiento puede volver a VERIFIED acá mismo, sin rehacer
// documentos.
export async function confirmSubscriptionPayment(req, res) {
  const { id } = req.params;
  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  const canConfirm = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED", "PLAN_ENDED"].includes(verification.vendor.verificationStatus);
  if (!canConfirm || !verification.paymentMethod) {
    throw new AppError("Esta solicitud no está esperando confirmación de pago.", 409);
  }
  if (!verification.paymentClaimedAt) {
    throw new AppError("El vendedor todavía no reclamó el pago (\"Ya pagué\") desde su panel.", 409);
  }

  await prisma.verificationRequest.update({
    where: { id },
    data: { paymentConfirmedAt: new Date(), paymentConfirmedById: req.user.id },
  });
  await syncVerificationArchive(verification.vendorId, { paymentConfirmedAt: new Date(), paymentConfirmedById: req.user.id });
  // El primer pago también queda en el historial de pagos (SubscriptionPayment), igual que las renovaciones.
  await mirrorInitialPayment(verification.vendorId);

  // Bloque 150: el ciclo dura tantos días como meses eligió el vendedor
  // (1..24), ya no un mes fijo siempre — mismo criterio para CARD y CUP.
  const months = verification.paymentMonths ?? 1;
  const nextPaymentDueDate = new Date(Date.now() + months * PAYMENT_CYCLE_DAYS * 24 * 60 * 60 * 1000);
  const extraData = { planType: paymentPlanOf(verification.paymentPlanType), nextPaymentDueDate };
  // Bloque 235: si esta tienda venía de un trial gratuito activo, ya está
  // pagando de verdad — limpiar trialEndsAt evita que el cron de
  // vencimiento del trial (trialExpiry.job.js) la baje a Regular más
  // adelante por error, aunque ya sea una suscripción real.
  if (verification.vendor.trialEndsAt) extraData.trialEndsAt = null;
  const updated = await transitionVendorVerification(verification.vendorId, "VERIFIED", {
    actorId: req.user.id,
    source: "ADMIN_ACTION",
    extraData,
    notify: { type: "VERIFICATION_VERIFIED" },
    planChangeReason: "payment_confirmed",
  });
  await recalcVendorProductQuota(verification.vendorId);

  res.json({ verification: updated });
}

// Pago registrado a mano por el admin. Cubre la tienda que pagó por fuera de la plataforma (efectivo, transferencia a otra
// cuenta) o la que el equipo decide activar: el admin elige cuántos meses quedan pagados y el motivo, y la tienda pasa a
// verificada con ese plan hasta esa fecha, sin esperar a que elija un método ni a que pulse "Ya pagué". Queda registrado
// como cualquier pago confirmado: en la solicitud y su archivo (método MANUAL, meses, monto, quién y cuándo), en el
// historial de estados, en la actividad de la tienda y, si era una renovación, en su historial de pagos. La tienda recibe
// el aviso de verificada.
// También sirve para EXTENDER una tienda ya verificada (auditoría, hallazgo 7): un plan "por WhatsApp" no se puede renovar
// en línea (quotePlan lo rechaza), así que el admin registra aquí cada pago. En ese caso la solicitud y su archivo no se
// tocan (guardan el pago inicial) y el pago queda solo en el historial de pagos (SubscriptionPayment).
const manualPaymentSchema = z.object({
  months: z.number().int().min(1).max(24),
  // Cualquier plan de PlanConfig (también uno creado por el admin); que exista y no esté archivado se comprueba abajo.
  planType: z.string().trim().regex(PLAN_KEY_PATTERN, "Ese plan no existe.").optional(),
  reason: z.string().trim().min(5, "Escribe el motivo (por ejemplo: pagó en efectivo en la oficina).").max(500),
  amount: z.number().min(0).max(10_000_000).optional(),
  currency: z.enum(["USD", "CUP"]).optional(),
  reference: z.string().trim().max(120).optional(),
})
  // Un monto sin moneda se anotaba como USD en SubscriptionPayment (y sin moneda en la solicitud): 2500 CUP pasaban a ser
  // 2500 USD en los ingresos y el MRR. Con monto, la moneda es obligatoria.
  .refine((d) => d.amount == null || !!d.currency, { message: "Elige la moneda del monto.", path: ["currency"] });

export async function registerManualPayment(req, res) {
  const { id } = req.params;
  const data = manualPaymentSchema.parse(req.body);
  // Con el correo del dueño: sin él, notifyVerificationEvent (al extender) solo deja la campanita y no manda el correo.
  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: { include: { user: { select: { email: true } } } } } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  const vendor = verification.vendor;
  const status = vendor.verificationStatus;
  const extending = status === "VERIFIED";
  if (!["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED", "PLAN_ENDED", "VERIFIED"].includes(status)) {
    throw new AppError("Solo se puede registrar un pago a una tienda verificada, en pago pendiente, vencida o suspendida.", 409);
  }

  // Al extender, el plan por omisión es el que la tienda ya tiene; si no, el que eligió al pagar.
  const planType = data.planType ?? (extending ? vendor.planType : paymentPlanOf(verification.paymentPlanType));
  if (!(await isValidPlanKey(planType))) throw new AppError("Ese plan no existe o está archivado.", 400);
  const plan = await getPlanConfig(planType);
  if (extending && plan.isDefault) {
    throw new AppError(`El plan ${plan.displayName} es el plan por defecto: para pasar la tienda a ese plan usa la bajada de plan.`, 400);
  }
  // Este pago pasa (o deja) la tienda en VERIFIED, que es la insignia. Un plan sin insignia no va por la verificación: se
  // cobra desde la renovación de Suscripción (planBilling), y por aquí la tienda se quedaba con la insignia sin tenerla.
  if (!plan.grantsBadge) {
    throw new AppError(`El plan ${plan.displayName} no da la insignia: su pago se confirma desde la renovación en Suscripción o con "Activar plan".`, 400);
  }

  const now = new Date();
  const renewal = status !== "PENDING_PAYMENT";
  // Una tienda activada a mano "sin vencimiento" (grantBusinessPlan) no tiene fecha: el pago se anota (historial e
  // ingresos), pero no le pone una fecha que la haría vencer sola. Para darle fecha está "Activar plan" con meses.
  const keepNoExpiry = extending && !vendor.nextPaymentDueDate && !inTrial(vendor);
  // Si todavía le quedaba tiempo pagado, los meses se suman desde ese vencimiento (no se pierden días); si no, desde hoy.
  const due = vendor.nextPaymentDueDate;
  const periodStart = due && due > now ? due : now;
  const periodEnd = new Date(periodStart.getTime() + cycleMs(data.months));
  const note = `${data.reason}${data.reference ? ` · Referencia: ${data.reference}` : ""}`;
  // Al extender con otro plan, Stripe seguiría cobrando el plan viejo con tarjeta y su siguiente cobro pisaría la fecha
  // con su periodo: se cancela, igual que en grantBusinessPlan. Con el mismo plan la tarjeta sigue.
  const dropCard = extending && !!vendor.stripeSubscriptionId && planType !== vendor.planType;
  if (dropCard) await cancelStripeSubscription(vendor.stripeSubscriptionId);

  if (!extending) {
    const paymentData = {
      paymentMethod: "MANUAL",
      paymentMonths: data.months,
      paymentPlanType: planType,
      paymentAmount: data.amount ?? null,
      paymentCurrency: data.currency ?? null,
      paymentClaimedAt: now,
      paymentConfirmedAt: now,
      paymentConfirmedById: req.user.id,
      paymentNote: note,
    };
    await prisma.verificationRequest.update({
      where: { id },
      // Un link de pago con tarjeta que hubiera quedado abierto ya no sirve: se cierra.
      data: { ...paymentData, stripeCheckoutSessionId: null, stripeCheckoutUrl: null, stripeCheckoutExpiresAt: null },
    });
    await syncVerificationArchive(verification.vendorId, paymentData);
  }
  // Primer pago registrado a mano: también al historial. En una renovación lo escribe el bloque de abajo, y si ya hay un pago
  // a menos de 2 minutos mirrorInitialPayment no lo repite.
  if (!extending && !renewal) await mirrorInitialPayment(verification.vendorId);
  if (renewal) {
    await prisma.subscriptionPayment.create({
      data: {
        vendorId: verification.vendorId,
        paymentMethod: "MANUAL",
        months: data.months,
        planType,
        amount: data.amount ?? null,
        // La columna no admite null; sin monto no cuenta en ingresos (el schema exige moneda cuando hay monto).
        currency: data.currency ?? "USD",
        payerName: "Registrado por el equipo",
        claimedAt: now,
        confirmedAt: now,
        confirmedById: req.user.id,
        periodStart,
        periodEnd,
        note,
      },
    });
  }

  const extraData = { planType, nextPaymentDueDate: keepNoExpiry ? null : periodEnd };
  // Mismo cuidado que confirmSubscriptionPayment: si venía de la prueba gratis, ya no la debe bajar el cron de la prueba.
  if (vendor.trialEndsAt) extraData.trialEndsAt = null;
  if (dropCard) Object.assign(extraData, { stripeSubscriptionId: null, cancelAtPeriodEnd: false });
  const months = `${data.months} ${data.months === 1 ? "mes" : "meses"}`;
  const until = periodEnd.toLocaleDateString("es-CU");
  let updated;
  if (extending) {
    // Ya está verificada: no hace falta otra transición (ni otro aviso de "verificada"); se mueve la fecha y, si cambió,
    // el plan. Mismo camino que confirmSubscriptionRenewal.
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.vendor.update({ where: { id: verification.vendorId }, data: extraData });
      await recordPlanChange(tx, { vendorId: verification.vendorId, fromPlan: vendor.planType, toPlan: planType, reason: "payment_confirmed", actorId: req.user.id });
      return row;
    });
    await notifyVerificationEvent({ ...vendor, ...updated }, "SUBSCRIPTION_RENEWAL_CONFIRMED", { notes: keepNoExpiry ? "sin fecha de vencimiento" : `hasta el ${until}` }).catch(() => {});
  } else {
    updated = await transitionVendorVerification(verification.vendorId, "VERIFIED", {
      reason: `Pago registrado a mano por el admin: ${months}, hasta el ${until}. ${note}`,
      actorId: req.user.id,
      source: "ADMIN_ACTION",
      extraData,
      notify: { type: "VERIFICATION_VERIFIED" },
      planChangeReason: "payment_confirmed",
    });
  }
  await recalcVendorProductQuota(verification.vendorId);
  // Si estaba suspendida por no pagar su plan, vuelve a verse y a recibir pedidos al momento.
  await liftBillingSuspension(verification.vendorId, "Pagó su plan");
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: verification.vendorId,
    action: "subscription_manual_payment",
    description: `Registró un pago manual de ${months}${data.amount != null ? ` (${data.amount} ${data.currency ?? ""})`.trimEnd() : ""}, plan ${plan.displayName} ${keepNoExpiry ? "sin vencimiento (se mantiene)" : `hasta el ${until}`}. Motivo: ${note}`,
  });

  // periodEnd es el fin del periodo pagado; con noExpiry la tienda sigue sin fecha de vencimiento.
  res.json({ verification: updated, periodEnd, planName: plan.displayName, noExpiry: keepNoExpiry });
}

// Bloque 151 (pedido explícito — "también se podrá cambiar desde el panel
// de administrador... ver la solicitud de la tienda y cambiarle el método
// de pago o restablecerlo para que él pueda seleccionar otro diferente"):
// limpia el método elegido (y cualquier rastro de pago/reclamo/checkout de
// ESE método) sin tocar el estado de verificación — la tienda sigue en
// PENDING_PAYMENT/PAYMENT_FAILED/SUSPENDED como antes, pero
// `chooseMyPaymentMethod` vuelve a mostrarse en el panel del vendedor
// porque `paymentMethod` queda en null. No rechaza si ya se había
// reclamado o incluso confirmado un pago viejo (eso ya se cerró en
// `paymentConfirmedAt`/`verifiedAt` de la rama de archivo, este reset no
// los toca) — solo limpia lo que hace falta para que el vendedor pueda
// elegir un método distinto desde cero.
export async function resetVerificationPaymentMethod(req, res) {
  const { id } = req.params;
  const verification = await prisma.verificationRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!verification) throw new AppError("Solicitud no encontrada.", 404);
  const canReset = ["PENDING_PAYMENT", "PAYMENT_FAILED", "SUSPENDED", "PLAN_ENDED"].includes(verification.vendor.verificationStatus);
  if (!canReset || !verification.paymentMethod) {
    throw new AppError("Esta solicitud no tiene ningún método de pago elegido para restablecer.", 409);
  }

  const reset = {
    paymentMethod: null,
    paymentMonths: null,
    paymentCurrency: null,
    paymentClaimedAt: null,
    paymentConfirmedAt: null,
    paymentConfirmedById: null,
    paymentProofUrl: null,
    paymentProofUnavailable: false,
    // stripeCheckoutSessionId/Url/ExpiresAt/stripePaymentIntentId: solo
    // existen en VerificationRequest (estado operativo efímero del link de
    // checkout — VerificationArchive nunca los tuvo, solo guarda
    // `stripePaidAt` como hecho archivable), así que se limpian acá pero se
    // excluyen del `archivePatch` de abajo para no romper el sync contra
    // columnas que no existen en ese modelo.
    stripeCheckoutSessionId: null,
    stripeCheckoutUrl: null,
    stripeCheckoutExpiresAt: null,
    stripePaidAt: null,
    stripePaymentIntentId: null,
    payerName: null,
    payerAccountNumber: null,
    payerPhone: null,
    payerAddress: null,
    payerCountry: null,
    payerCardLast4: null,
  };
  const { stripeCheckoutSessionId, stripeCheckoutUrl, stripeCheckoutExpiresAt, stripePaymentIntentId, ...archivePatch } = reset;
  await prisma.verificationRequest.update({ where: { id }, data: reset });
  await syncVerificationArchive(verification.vendorId, archivePatch);
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: verification.vendorId,
    action: "verification_payment_method_reset",
    description: `Restableció el método de pago (antes: ${verification.paymentMethod})`,
  });
  await notifyVerificationEvent(verification.vendor, "VERIFICATION_PAYMENT_METHOD_RESET").catch(() => {});

  res.json({ ok: true });
}

// --- Renovaciones de suscripción (Bloque 153, pedido explícito) ------------
// "Una vez el cliente esté verificado... podrá activar un nuevo mes o
// varios... el admin debe aprobar los demás meses pagos... todo eso irá
// quedando archivado en el historial de esa tienda" — cada renovación es
// una fila propia de SubscriptionPayment (ver verification.controller.js),
// nunca se pisa la anterior; acá solo vive la confirmación del admin.
export async function listPendingSubscriptionPayments(_req, res) {
  const payments = await prisma.subscriptionPayment.findMany({
    where: { confirmedAt: null, claimedAt: { not: null } },
    include: {
      vendor: { select: { id: true, companyName: true, color: true, logoUrl: true, email: true, whatsapp: true } },
      plan: { select: { displayName: true } },
    },
    orderBy: { claimedAt: "asc" },
  });
  // planName: el nombre del plan que paga, desde PlanConfig (null si el pago no trae plan, el caso de los pagos viejos).
  res.json({ payments: payments.map(({ plan, ...p }) => ({ ...p, planName: plan?.displayName ?? null })) });
}

// Bloque 153 (pedido explícito — "quiero que esas cuentas sean bien
// estrictas"): el nuevo vencimiento se calcula desde el vencimiento REAL
// vigente (si todavía no pasó) — nunca desde "ahora", que le regalaría
// días de más a quien ya tenía tiempo pagado por delante, ni desde una
// fecha vencida, que le robaría días a quien renovó tarde. Extiende
// `Vendor.nextPaymentDueDate` (la misma fuente que ya usan el cron de
// vencimiento y el resto del ciclo) — nunca un campo aparte.
export async function confirmSubscriptionRenewal(req, res) {
  const { id } = req.params;
  // Con el correo del dueño: sin él, notifyVerificationEvent solo deja la campanita y no manda el correo de la renovación.
  const payment = await prisma.subscriptionPayment.findUnique({ where: { id }, include: { vendor: { include: { user: { select: { email: true } } } } } });
  if (!payment) throw new AppError("Pago no encontrado.", 404);
  if (payment.confirmedAt) throw new AppError("Este pago ya fue confirmado.", 409);
  if (!payment.claimedAt) throw new AppError('El vendedor todavía no reclamó este pago ("Ya pagué").', 409);

  const now = new Date();
  // Lo pagado empieza cuando se acaba lo que ya tiene: su fecha de pago o, si paga durante la prueba gratis, el final de la
  // prueba (si no, los meses pagados se solapaban con la prueba y se acortaban).
  const periodStart = [payment.vendor.nextPaymentDueDate, payment.vendor.trialEndsAt].filter((d) => d && d > now).sort((a, b) => b - a)[0] ?? now;
  const periodEnd = new Date(periodStart.getTime() + payment.months * PAYMENT_CYCLE_DAYS * 24 * 60 * 60 * 1000);
  // Pagó durante la prueba (sin tarjeta): sale de la prueba ahora y sigue con lo pagado, que ya empieza al final de ella. Así
  // trialExpiry.job.js no la trata como una prueba sin pagar. Con tarjeta, la prueba la sigue gobernando Stripe.
  const endsTrial = !!payment.vendor.trialEndsAt && !payment.vendor.stripeSubscriptionId;

  const updated = await prisma.subscriptionPayment.update({
    where: { id },
    data: { confirmedAt: now, confirmedById: req.user.id, periodStart, periodEnd },
  });
  const planChanged = !!payment.planType && payment.planType !== payment.vendor.planType;
  await prisma.$transaction(async (tx) => {
    await tx.vendor.update({ where: { id: payment.vendorId }, data: { nextPaymentDueDate: periodEnd, ...(endsTrial ? { trialEndsAt: null } : {}), ...(planChanged ? { planType: payment.planType } : {}) } });
    if (planChanged) {
      await recordPlanChange(tx, { vendorId: payment.vendorId, fromPlan: payment.vendor.planType, toPlan: payment.planType, reason: "payment_confirmed", actorId: req.user.id });
    }
  });
  if (planChanged) await recalcVendorProductQuota(payment.vendorId);
  // Si estaba suspendida por no pagar su plan, vuelve a verse y a recibir pedidos al momento.
  await liftBillingSuspension(payment.vendorId, "Pagó su plan");
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: payment.vendorId,
    action: "subscription_renewal_confirmed",
    description: `Confirmó la renovación (${payment.months} ${payment.months === 1 ? "mes" : "meses"}, hasta ${periodEnd.toLocaleDateString("es-CU")})`,
  });
  await notifyVerificationEvent(payment.vendor, "SUBSCRIPTION_RENEWAL_CONFIRMED", {
    notes: `hasta el ${periodEnd.toLocaleDateString("es-CU")}`,
  }).catch(() => {});

  res.json({ payment: updated });
}

// --- Solicitudes de cambio de identidad (Bloque 153, pedido explícito) ----
// "todos los datos de la tienda no se pueden modificar después de estar
// verificadas sin aprobación del admin... si se desea cambiar el nombre o
// el responsable se debe enviar la solicitud al admin para prevenir
// fraudes."
export async function listVendorChangeRequests(req, res) {
  const { status } = req.query;
  const requests = await prisma.vendorChangeRequest.findMany({
    where: { status: status ? String(status).toUpperCase() : "PENDING" },
    include: { vendor: { select: { id: true, companyName: true, color: true, logoUrl: true, email: true, whatsapp: true, verificationStatus: true } } },
    orderBy: { createdAt: "asc" },
  });
  res.json({ requests });
}

const decideChangeRequestSchema = z.object({
  decision: z.enum(["approve", "reject"]),
  notes: z.string().optional(),
});

// Aprobar APLICA los cambios de verdad a Vendor (solo los campos que la
// solicitud trae, nunca pisa los demás) — rechazar solo cierra la
// solicitud con un motivo, la tienda queda tal cual estaba.
export async function decideVendorChangeRequest(req, res) {
  const { id } = req.params;
  const { decision, notes } = decideChangeRequestSchema.parse(req.body);

  const request = await prisma.vendorChangeRequest.findUnique({ where: { id }, include: { vendor: true } });
  if (!request) throw new AppError("Solicitud no encontrada.", 404);
  if (request.status !== "PENDING") throw new AppError("Esta solicitud ya fue resuelta.", 409);
  if (decision === "reject" && !notes?.trim()) throw new AppError("Indica el motivo del rechazo.", 400);

  if (decision === "approve") {
    await assertVendorUnique({ companyName: request.companyName ?? undefined, ownerIdNumber: request.ownerIdNumber ?? undefined }, request.vendorId);
    await prisma.vendor.update({
      where: { id: request.vendorId },
      data: {
        ...(request.companyName ? { companyName: request.companyName } : {}),
        ...(request.ownerName ? { ownerName: request.ownerName } : {}),
        ...(request.ownerIdNumber ? { ownerIdNumber: request.ownerIdNumber } : {}),
        ...(request.companyAddress ? { companyAddress: request.companyAddress } : {}),
      },
    });
  }

  const updated = await prisma.vendorChangeRequest.update({
    where: { id },
    data: { status: decision === "approve" ? "APPROVED" : "REJECTED", adminNotes: notes ?? null, reviewedById: req.user.id, reviewedAt: new Date() },
  });
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: request.vendorId,
    action: decision === "approve" ? "vendor_change_approved" : "vendor_change_rejected",
    description: decision === "approve" ? "Aprobó una solicitud de cambio de datos" : `Rechazó una solicitud de cambio de datos: ${notes}`,
  });
  await notifyVerificationEvent(request.vendor, decision === "approve" ? "VENDOR_CHANGE_REQUEST_APPROVED" : "VENDOR_CHANGE_REQUEST_REJECTED", {
    notes,
  }).catch(() => {});

  res.json({ changeRequest: updated });
}

// --- Suscripciones (Bloque 46, recurrente desde Bloque 64) -----------------
export async function listSubscriptions(_req, res) {
  const [vendors, configs] = await Promise.all([
    subscriptionScope().then((where) =>
      prisma.vendor.findMany({
        where,
        include: {
          verification: true,
          locations: { include: { province: true }, take: 1 },
        },
        orderBy: { createdAt: "desc" },
      })
    ),
    getAllPlanConfigs({ includeArchived: true }),
  ]);
  const planName = new Map(configs.map((c) => [c.planType, c.displayName]));

  const subscriptions = vendors.map((v) => {
    const ver = v.verification;
    const status = subscriptionStatusOf(v);
    return {
      vendorId: v.id,
      companyName: v.companyName,
      slug: v.slug,
      color: v.color,
      province: v.locations?.[0]?.province?.name ?? null,
      planType: v.planType,
      planName: planName.get(v.planType) ?? v.planType,
      status,
      trialEndsAt: inTrial(v) ? v.trialEndsAt : null,
      trialDaysLeft: inTrial(v) ? Math.ceil((new Date(v.trialEndsAt).getTime() - Date.now()) / (24 * 60 * 60 * 1000)) : null,
      nextPaymentDueDate: v.nextPaymentDueDate,
      // Activado a mano "sin vencimiento" (grantBusinessPlan): pagando, sin fecha de cobro ni prueba.
      noExpiry: status === "active" && !v.nextPaymentDueDate,
      // Cobro de planBilling (planes sin insignia y el plan por defecto cuando no es gratis).
      billingNoticeStage: v.billingNoticeStage ?? null,
      billingSuspendedAt: v.billingSuspendedAt ?? null,
      hasStripeSubscription: !!v.stripeSubscriptionId,
      paymentMethod: ver?.paymentMethod ?? null,
      paymentConfirmedAt: ver?.paymentConfirmedAt ?? null,
      stripeCheckoutUrl: ver?.stripeCheckoutUrl ?? null,
      stripeCheckoutExpired: ver?.stripeCheckoutExpiresAt ? ver.stripeCheckoutExpiresAt < new Date() : false,
    };
  });

  // Bloque 48: cálculo de métricas movido a computeSubscriptionMetrics
  // (reusado también por getDashboard) — mismo resultado de antes, ahora en
  // un solo lugar.
  const metrics = await computeSubscriptionMetrics(vendors);
  res.json({ subscriptions, metrics });
}

// Manual — el admin decide revocar (impago, incumplimiento, pedido del
// vendedor, etc.), a diferencia de PAYMENT_FAILED/SUSPENDED que solo los
// disparan Stripe o el cron de vencimiento. Si la tienda pagaba por Stripe,
// cancela la suscripción DE VERDAD ahí también — sin esto Stripe seguiría
// cobrándole al vendedor cada mes por un plan que ya no tiene acá.
const planReasonSchema = z.object({
  reason: z.string().trim().min(5, "Escribe un motivo de al menos 5 caracteres."),
});

// Bloque 52 (pedido explícito — "se debe justificar y poner el motivo de
// esta activación manual"): antes no pedía ningún motivo — ahora, igual que
// reactivateVendor más arriba, queda obligatorio y auditado en
// VerificationStatusLog (reason/actorId/source, ver transitionVendorVerification).
export async function revokeBusinessPlan(req, res) {
  const { id } = req.params;
  const { reason } = planReasonSchema.parse(req.body);
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  // La tienda vuelve al plan por defecto (isDefault), sea cual sea su clave.
  const defaultKey = await getDefaultPlanKey();
  if (vendor.planType === defaultKey) throw new AppError("Esta tienda no tiene un plan de pago activo.", 409);

  // Sin la insignia (un plan cobrado sin verificación, con el cobro atrasado o suspendida por no pagar): no hay verificación
  // que suspender. Pasar por transitionVendorVerification la dejaba en verificationStatus SUSPENDED aunque nunca se hubiera
  // verificado, y después no podía empezar la verificación. applyPlanDowngrade la baja al plan por defecto, cancela Stripe,
  // limpia fechas, recalcula cupo y ofertas, anota el cambio y le avisa. También la saca del ciclo de cobro y levanta la
  // suspensión por falta de pago en el momento (si el plan por defecto se cobra, arranca su propio ciclo).
  if (vendor.verificationStatus !== "VERIFIED") {
    const downgraded = await applyPlanDowngrade(id, { actorId: req.user.id, source: "ADMIN_ACTION", reason, planChangeReason: "admin_revoke" });
    return res.json({ vendor: downgraded });
  }

  if (vendor.stripeSubscriptionId) await cancelStripeSubscription(vendor.stripeSubscriptionId);

  const updated = await transitionVendorVerification(id, "SUSPENDED", {
    reason,
    actorId: req.user.id,
    source: "ADMIN_ACTION",
    extraData: { planType: defaultKey, stripeSubscriptionId: null },
    notify: { type: "VERIFICATION_BUSINESS_REVOKED" },
    planChangeReason: "admin_revoke",
  });
  await recalcVendorProductQuota(id);
  res.json({ vendor: updated });
}

// Pasar una tienda de un plan de pago (pagado o prueba gratis) al plan por defecto: ahora mismo, o al terminar lo que ya
// tiene. También anula un cambio programado. Ver services/planDowngrade.service.js.
const downgradeSchema = z.object({
  when: z.enum(["now", "period_end", "cancel"]),
  reason: z.string().trim().max(300).optional(),
});

export async function downgradeVendorPlan(req, res) {
  const { id } = req.params;
  const { when, reason } = downgradeSchema.parse(req.body);
  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  const defaultKey = await getDefaultPlanKey();
  const defaultName = await planDisplayName(defaultKey);
  if (when !== "cancel") {
    if (vendor.planType === defaultKey) throw new AppError(`Esta tienda ya está en el plan ${defaultName}.`, 409);
    if (!reason || reason.length < 5) throw new AppError("Escribe un motivo de al menos 5 caracteres (lo verá la tienda).", 400);
  }
  if (when === "now") {
    // applyPlanDowngrade anota el cambio en VendorPlanChange ("admin_change").
    const updated = await applyPlanDowngrade(id, { actorId: req.user.id, source: "ADMIN_ACTION", reason });
    logActivity({ actorId: req.user.id, actorRole: "ADMIN", vendorId: id, action: "plan_downgraded_now", description: `Pasó la tienda al plan ${defaultName} de inmediato: ${reason}` });
    return res.json({ vendor: updated });
  }
  // Programado: el cambio lo aplica después la tarea diaria o el aviso de Stripe (applyPlanDowngrade), que lo anota.
  const updated = await scheduleOrCancelDowngrade(vendor, { when, reason });
  if (!updated) throw new AppError("La tienda no tiene una prueba ni un periodo pagado en curso: usa \"Ahora mismo\".", 409);
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: id,
    action: when === "cancel" ? "plan_downgrade_cancelled" : "plan_downgrade_scheduled",
    description:
      when === "cancel"
        ? `Anuló el paso programado al plan ${defaultName}`
        : `Programó el paso al plan ${defaultName} para el ${new Date(updated.planDowngradeAt).toLocaleDateString("es-CU")}: ${reason}`,
  });
  res.json({ vendor: updated });
}

// Bloque 52 (pedido explícito — "podemos activar la suscripción
// manualmente desde el panel de administrador para algunas tiendas... se
// debe justificar y poner el motivo"): única vía para dar un plan de pago SIN
// pasar por el ciclo real de documentos/pago.
// Cuánto dura (auditoría, hallazgo 7: antes vencía siempre a los 30 días, también el Empresarial, que no se puede renovar
// en línea, así que la tienda caía sola al plan por defecto):
//  - `months` (1 a 24): activo hasta esa fecha. Si la tienda ya tenía ese mismo plan con tiempo por delante, se suma
//    desde su vencimiento (igual que un pago); si es otro plan, desde hoy.
//  - `noExpiry: true`: sin fecha de vencimiento (nextPaymentDueDate = null). Los avisos y el vencimiento de
//    verificationPayment.job.js solo miran tiendas con fecha, así que nunca cae sola; se quita con "Quitar plan" o la bajada.
//    Solo en planes con insignia: en uno sin insignia las funciones duran mientras haya tiempo pagado (isPremiumActive).
//  - Un plan "por WhatsApp" (contactOnly) exige elegir una de las dos: se negocia con el equipo y no hay duración obvia.
//    En los demás, sin nada se toma 1 mes (lo de siempre).
// Plan con insignia: pasa a VERIFIED igual que confirmSubscriptionPayment (insignia y funciones dependen de ese estado).
// Plan sin insignia: solo cambia plan y fecha, como el cobro de planBilling (no hay verificación de por medio); si ese plan
// se cobra, la fecha queda como su próxima fecha de cobro para que la pasada de planBilling no la reemplace. Solo se
// activa a mano si se cobra (si no, nada lo haría vencer) y si la tienda no está VERIFIED (se quedaría con la insignia).
// La marca de "activación a mano" es la fila de VendorPlanChange con reason "admin_grant" (la lee /admin/plan-stats).
const grantPlanSchema = z.object({
  reason: z.string().trim().min(5, "Escribe un motivo de al menos 5 caracteres."),
  planType: z.string().trim().regex(PLAN_KEY_PATTERN, "Ese plan no existe.").optional(),
  months: z.number().int().min(1, "Elige de 1 a 24 meses.").max(24, "Elige de 1 a 24 meses.").optional(),
  noExpiry: z.boolean().optional(),
});

export async function grantBusinessPlan(req, res) {
  const { id } = req.params;
  const data = grantPlanSchema.parse(req.body ?? {});
  // Sin plan indicado: el plan de prueba (isTrialPlan), el que se daba siempre antes.
  const planType = data.planType ?? (await getTrialPlanKey());
  if (!(await isValidPlanKey(planType))) throw new AppError("Ese plan no existe o está archivado.", 400);
  const plan = await getPlanConfig(planType);
  const name = plan.displayName;
  if (plan.isDefault) {
    throw new AppError(`El plan ${name} es el plan por defecto: para pasar la tienda a ese plan usa la bajada de plan.`, 400);
  }
  const noExpiry = data.noExpiry === true;
  if (noExpiry && data.months) throw new AppError('Elige cuántos meses o "Sin vencimiento", no las dos cosas.', 400);
  if (plan.contactOnly && !noExpiry && !data.months) {
    throw new AppError(`El plan ${name} se contrata con el equipo: elige cuántos meses dura o "Sin vencimiento".`, 400);
  }
  if (noExpiry && !plan.grantsBadge) {
    throw new AppError(`El plan ${name} no da la insignia: sus funciones duran mientras tenga tiempo pagado. Elige cuántos meses.`, 400);
  }
  const billed = !plan.isFree && !plan.contactOnly && !plan.grantsBadge;
  // Un plan sin insignia que tampoco se cobra (por WhatsApp sin insignia, o uno gratis que no es el por defecto) no tiene
  // quién lo haga vencer: verificationPayment.job solo mira tiendas VERIFIED y planBilling solo los planes cobrados, y
  // assertPlanAllows mira el plan, no la fecha. La tienda se quedaría con sus funciones para siempre.
  if (!plan.grantsBadge && !billed) {
    throw new AppError(`El plan ${name} no se puede activar a mano: no da la insignia ni se cobra, así que no vencería nunca.`, 400);
  }
  const months = data.months ?? 1;

  const vendor = await prisma.vendor.findUnique({ where: { id } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  // La insignia es VERIFIED. Un plan sin insignia no pasa por la verificación, así que la tienda se quedaría con la insignia
  // del plan anterior. No se cambia el estado aquí: transitionVendorVerification, al salir de VERIFIED, pone el plan por
  // defecto, y saltarse esa función dejaría sin historial ni aviso el cambio. Primero se quita el plan actual.
  if (!plan.grantsBadge && vendor.verificationStatus === "VERIFIED") {
    throw new AppError(`Esta tienda tiene la insignia de su plan actual y el plan ${name} no la da. Quítale antes el plan actual y luego activa ${name}.`, 409);
  }
  await getDefaultPlanKey(); // carga la caché que usa isPremiumActive
  const samePlanActive = vendor.planType === planType && isPremiumActive(vendor);
  if (samePlanActive && noExpiry && !vendor.nextPaymentDueDate && !inTrial(vendor)) {
    throw new AppError(`Esta tienda ya tiene el plan ${name} activo, sin vencimiento.`, 409);
  }

  const now = new Date();
  const due = vendor.nextPaymentDueDate;
  const periodStart = samePlanActive && due && due > now ? due : now;
  const periodEnd = noExpiry ? null : new Date(periodStart.getTime() + cycleMs(months));
  // Si la tienda pagaba otro plan con tarjeta (o si ya no va a tener fecha), Stripe seguiría cobrándole: se cancela, igual
  // que al quitar el plan. Con el mismo plan y fecha, la tarjeta sigue (la activación solo le suma tiempo).
  const dropCard = !!vendor.stripeSubscriptionId && (vendor.planType !== planType || noExpiry);
  if (dropCard) await cancelStripeSubscription(vendor.stripeSubscriptionId);

  const grantData = {
    planType,
    nextPaymentDueDate: periodEnd,
    // Bloque 235: mismo guardrail que confirmSubscriptionPayment. Si venía de un trial gratuito, esto ya lo reemplaza
    // por un plan real, no debe quedar un trialEndsAt viejo que el cron de vencimiento procese después.
    ...(vendor.trialEndsAt ? { trialEndsAt: null } : {}),
    // Un paso al plan por defecto programado deja de tener sentido.
    planDowngradeAt: null,
    planDowngradeReason: null,
    ...(dropCard ? { stripeSubscriptionId: null, cancelAtPeriodEnd: false } : {}),
    // Cobro de planBilling: en un plan cobrado, la fecha elegida es su próxima fecha de cobro (con "start" la pasada
    // horaria no la reemplaza por la del día de registro); en cualquier otro, la tienda sale del cobro.
    ...(billed ? { billingNoticeStage: "start", billingNoticeDue: periodEnd } : { billingNoticeStage: null, billingNoticeDue: null }),
  };

  let updated;
  if (plan.grantsBadge) {
    updated = await transitionVendorVerification(id, "VERIFIED", {
      reason: data.reason,
      actorId: req.user.id,
      source: "ADMIN_ACTION",
      extraData: grantData,
      notify: { type: "VERIFICATION_BUSINESS_GRANTED" },
      planChangeReason: "admin_grant",
    });
  } else {
    updated = await prisma.$transaction(async (tx) => {
      const row = await tx.vendor.update({ where: { id }, data: grantData });
      await recordPlanChange(tx, { vendorId: id, fromPlan: vendor.planType, toPlan: planType, reason: "admin_grant", actorId: req.user.id });
      return row;
    });
    const until = periodEnd.toLocaleDateString("es-CU", { day: "numeric", month: "long", year: "numeric" });
    await adminNoticeToVendor(id, `Tu tienda tiene el plan ${name}`, `El equipo activó el plan ${name} en tu tienda hasta el ${until}. Motivo: ${data.reason}.`).catch(() => {});
  }
  await recalcVendorProductQuota(id);
  // Si estaba suspendida por no pagar el plan anterior, la activación lo resuelve.
  await liftBillingSuspension(id, `El equipo activó el plan ${name}`);
  const length = noExpiry ? "sin vencimiento" : `por ${months} ${months === 1 ? "mes" : "meses"}, hasta el ${periodEnd.toLocaleDateString("es-CU")}`;
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: id,
    action: "business_plan_granted_manually",
    description: `Activó el plan ${name} a mano, ${length}. Motivo: ${data.reason}`,
  });
  res.json({ vendor: updated, planName: name, periodEnd, noExpiry });
}

// --- Clientes ------------------------------------------------------------

// Bloque 242 (pedido explícito — "la tabla de clientes más moderna y compacta,
// que no se haga extensa cuando sean miles"): antes traía TODOS los clientes
// al navegador y filtraba allá. Ahora pagina, busca, filtra y ordena en el
// servidor (contrato común en lib/pagination.js). `status` también lo usa
// AdminCampaigns con pageSize=1 solo para leer el `total` (cuántos
// destinatarios tendría una campaña) en vez de bajarse la lista entera.
const DAY_MS_CUSTOMERS = 24 * 60 * 60 * 1000;

const customersQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  provinceId: z.string().optional(),
  status: z.enum(["all", "active", "suspended", "new", "recent", "buyers", "nobuyers", "reporters"]).default("all"),
  sort: z.enum(["recent", "orders", "lastLogin", "name"]).default("recent"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

function customerStatusWhere(status) {
  const since = new Date(Date.now() - 30 * DAY_MS_CUSTOMERS);
  switch (status) {
    case "active":
      return { isSuspended: false };
    case "suspended":
      return { isSuspended: true };
    case "new":
      return { createdAt: { gte: since } };
    case "recent":
      return { lastLoginAt: { gte: since } };
    case "buyers":
      return { orders: { some: {} } };
    case "nobuyers":
      return { orders: { none: {} } };
    case "reporters":
      return { reportsMade: { some: {} } };
    default:
      return {};
  }
}

function customersOrderBy(sort, dir) {
  const map = {
    recent: [{ createdAt: dir }],
    orders: [{ orders: { _count: dir } }],
    // Quien nunca entró (lastLoginAt null) va siempre al final, sin importar
    // la dirección — "último acceso más reciente" no debe abrir con cuentas
    // que jamás iniciaron sesión.
    lastLogin: [{ lastLoginAt: { sort: dir, nulls: "last" } }],
    name: [{ fullName: dir }],
  };
  return [...map[sort], { id: "asc" }];
}

export async function listCustomers(req, res) {
  const query = customersQuerySchema.parse(req.query);
  const { q, provinceId, status, sort, dir } = query;

  const scope = { role: "CUSTOMER", deletedAt: null, provinceId: provinceId || undefined };
  const where = {
    ...scope,
    ...customerStatusWhere(status),
    ...(q
      ? {
          OR: [
            { fullName: { contains: q, mode: "insensitive" } },
            { email: { contains: q, mode: "insensitive" } },
            { phone: { contains: q } },
          ],
        }
      : {}),
  };

  // Feature B (pedido explícito): "cliente de alto riesgo" es DERIVADO —
  // cuántos reportes de fraude hizo (reportsMade), sin campo booleano
  // nuevo que pueda desincronizarse. No filtra por status del reporte
  // (un reporte descartado también cuenta para el patrón de uso, es
  // información para el admin, no una acusación).
  const [customers, total, kAll, kRecent, kNew, kBuyers, kNoBuyers, kReporters, kSuspended] = await Promise.all([
    prisma.user.findMany({
      where,
      include: {
        province: true,
        registrationCountry: { select: { name: true } },
        _count: { select: { orders: true, reportsMade: true } },
      },
      orderBy: customersOrderBy(sort, dir),
      ...pageArgs(query),
    }),
    prisma.user.count({ where }),
    prisma.user.count({ where: scope }),
    prisma.user.count({ where: { ...scope, ...customerStatusWhere("recent") } }),
    prisma.user.count({ where: { ...scope, ...customerStatusWhere("new") } }),
    prisma.user.count({ where: { ...scope, ...customerStatusWhere("buyers") } }),
    prisma.user.count({ where: { ...scope, ...customerStatusWhere("nobuyers") } }),
    prisma.user.count({ where: { ...scope, ...customerStatusWhere("reporters") } }),
    prisma.user.count({ where: { ...scope, ...customerStatusWhere("suspended") } }),
  ]);

  // Fecha del último pedido de cada cliente de ESTA página, en una sola
  // consulta agrupada (nunca una por fila).
  const lastOrders = customers.length
    ? await prisma.order.groupBy({
        by: ["customerId"],
        where: { customerId: { in: customers.map((c) => c.id) } },
        _max: { createdAt: true },
      })
    : [];
  const lastOrderByCustomer = new Map(lastOrders.map((o) => [o.customerId, o._max.createdAt]));

  res.json({
    customers: customers.map((c) => ({
      id: c.id,
      fullName: c.fullName,
      email: c.email,
      phone: c.phone,
      province: c.province?.name ?? null,
      country: c.registrationCountry?.name ?? c.registrationCountryOther ?? null,
      orderCount: c._count.orders,
      lastOrderAt: lastOrderByCustomer.get(c.id) ?? null,
      reportsMadeCount: c._count.reportsMade,
      isSuspended: c.isSuspended,
      createdAt: c.createdAt,
      lastLoginAt: c.lastLoginAt,
    })),
    kpis: { all: kAll, recent: kRecent, new: kNew, buyers: kBuyers, nobuyers: kNoBuyers, reporters: kReporters, suspended: kSuspended },
    ...pageMeta(query, total),
  });
}

const updateCustomerSchema = z.object({
  isSuspended: z.boolean().optional(),
  // Al suspender por incumplir las normas: también a la lista negra, con el motivo (lib/blacklist.js).
  addToBlacklist: z.boolean().optional(),
  blacklistReason: z.string().trim().min(5, "Escribe un motivo de al menos 5 caracteres.").max(500).optional(),
  fullName: z.string().min(2).optional(),
  // Normalizado: lo que se guarde acá es el correo con el que el cliente inicia sesión.
  email: emailField().optional(),
  phone: z.string().min(8).optional(),
});

export async function updateCustomer(req, res) {
  const { id } = req.params;
  const { addToBlacklist: blacklist, blacklistReason, ...data } = updateCustomerSchema.parse(req.body);

  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "CUSTOMER" || user.deletedAt) throw new AppError("Cliente no encontrado.", 404);
  if (blacklist && data.isSuspended !== true) throw new AppError("La lista negra se aplica al suspender al cliente.", 400);
  if (blacklist && !blacklistReason) throw new AppError("Escribe el motivo para la lista negra.", 400);
  if (data.phone && data.phone !== user.phone) await assertPhoneFree(data.phone, { userId: id, scope: "customer" });

  const emailChanged = !!data.email && data.email !== user.email?.toLowerCase();
  if (emailChanged) {
    const existing = await prisma.user.findFirst({ where: { email: { equals: data.email, mode: "insensitive" } } });
    if (existing && existing.id !== id) throw new AppError("Ese correo ya está en uso por otra cuenta.", 409);
    // Igual que el correo de acceso de una tienda (updateVendorLoginEmail): uno de la lista negra no pasa a otra cuenta.
    if (await emailBlacklistedForOthers(data.email, id)) {
      throw new AppError("Ese correo está en la lista negra. Para usarlo, primero quítalo de la lista negra.", 409);
    }
  }

  // Reactivar a un cliente bloqueado por avisos de fraude: se detiene el plazo y lo anterior deja de contar.
  const fraudReset = data.isSuspended === false && user.fraudBlockedAt ? { fraudBlockedAt: null, fraudClaimDueAt: null, fraudStrikesResetAt: new Date() } : {};
  const updated = await prisma.user.update({ where: { id }, data: { ...data, ...fraudReset } });
  const suspending = data.isSuspended === true;
  // isSuspended solo se mira al renovar la sesión: sin cerrarlas, el cliente suspendido seguía usando la API con su token
  // de acceso hasta una hora (lo mismo que hace lib/moderation.js al bloquear por avisos). Con el correo cambiado, quien
  // tenía la sesión abierta con el anterior vuelve a entrar con el nuevo.
  if (suspending || emailChanged) await revokeUserSessions(id, { forgetDevices: emailChanged });
  if (blacklist) {
    const already = await prisma.blacklistEntry.findFirst({ where: { userId: id, removedAt: null }, select: { id: true } });
    if (!already) await addToBlacklist({ kind: "CUSTOMER", user: updated, reason: blacklistReason, addedById: req.user.id });
  }
  if (data.isSuspended !== undefined && data.isSuspended !== user.isSuspended) {
    const who = user.fullName ?? user.email;
    logActivity({
      actorId: req.user.id,
      actorRole: "ADMIN",
      action: data.isSuspended ? "admin_suspend_customer" : "admin_reactivate_customer",
      description: data.isSuspended ? `Un admin suspendió al cliente "${who}"${blacklist ? " y lo agregó a la lista negra" : ""}` : `Un admin reactivó al cliente "${who}"`,
      meta: { customerId: id, blacklist: !!blacklist, reason: blacklistReason ?? null },
    });
  }
  res.json({ customer: { id: updated.id, fullName: updated.fullName, email: updated.email, phone: updated.phone, isSuspended: updated.isSuspended } });
}

// Soft-delete: la fila de User se conserva (pedidos históricos guardan
// customerId real) pero isSuspended:true bloquea el login (ver
// auth.controller.js) y deletedAt la saca de listCustomers.
export async function deleteCustomer(req, res) {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id } });
  if (!user || user.role !== "CUSTOMER") throw new AppError("Cliente no encontrado.", 404);

  await finalizeUserDeletion(id, { source: "ADMIN", byId: req.user.id });
  res.status(204).end();
}

// "Unir con su tienda": un cliente que antes abrió su tienda con otra cuenta. Primero se muestran las cuentas de tienda que
// parecen suyas (mismo teléfono, nombre o correo parecido) o las que el admin busque, y lo que se va a mover.
export async function getCustomerMergeInfo(req, res) {
  const { id } = req.params;
  const user = await prisma.user.findUnique({ where: { id }, select: { id: true, role: true, deletedAt: true } });
  if (!user || user.role !== "CUSTOMER" || user.deletedAt) throw new AppError("Cliente no encontrado.", 404);
  const q = z.string().trim().max(120).optional().parse(req.query.q);
  const select = { id: true, fullName: true, email: true, phone: true, vendor: { select: { id: true, companyName: true, slug: true, whatsapp: true } } };
  const [suggested, found, summary] = await Promise.all([
    findMergeCandidates(id),
    q && q.length >= 2
      ? prisma.user.findMany({
          where: {
            role: "VENDOR",
            deletedAt: null,
            vendor: { is: { deletedAt: null } },
            OR: [{ email: { contains: q, mode: "insensitive" } }, { fullName: { contains: q, mode: "insensitive" } }, { vendor: { is: { companyName: { contains: q, mode: "insensitive" } } } }],
          },
          select,
          take: 8,
        })
      : [],
    mergeSummary(id),
  ]);
  res.json({ suggested, found, summary });
}

export async function mergeCustomer(req, res) {
  const { targetUserId } = z.object({ targetUserId: z.string().min(1) }).parse(req.body);
  const result = await mergeCustomerIntoVendorAccount(req.params.id, targetUserId, { byId: req.user.id });
  res.json(result);
}

// --- Chat vendedor <-> admin (Bloque 15) ------------------------------------
// Un solo hilo por tienda: no hay entidad "Conversation" separada, ver nota
// en schema.prisma. Esta lista sirve tanto para responder hilos iniciados
// por el vendedor como para que el admin le escriba primero a cualquiera —
// mismo camino de UI para ambos casos, sin duplicar un sistema aparte.
//
// canRead: si la tienda puede ver el chat. Del lado de la tienda (requireApprovedVendor, vendors.controller.js) hace falta
// estar VERIFIED y un plan con allowAdminChat; sin eso el mensaje del admin se guardaba y nadie lo leía. Los planes que lo
// traen se leen de PlanConfig (planAllows solo con la clave mira el interruptor y la insignia del plan), nunca una lista fija.
async function adminChatPlanKeys() {
  const configs = await getAllPlanConfigs({ includeArchived: true });
  const allowed = await Promise.all(configs.map((c) => planAllows(c.planType, "allowAdminChat")));
  return configs.filter((_, i) => allowed[i]).map((c) => c.planType);
}
const canReadAdminChat = (vendor, chatKeys) => vendor.verificationStatus === "VERIFIED" && chatKeys.includes(vendor.planType);

// La lista se pide cada 5 segundos: antes traía todas las tiendas de la plataforma. Ahora solo las que tienen conversación
// y las que pueden leer el chat (a las demás no tiene sentido escribirles primero). Con ?q= (2 letras o más) busca por
// nombre entre todas, para abrir el hilo de cualquier tienda.
export async function listConversations(req, res) {
  const q = String(req.query?.q ?? "").trim();
  const chatKeys = await adminChatPlanKeys();
  const where =
    q.length >= 2
      ? { deletedAt: null, companyName: { contains: q, mode: "insensitive" } }
      : {
          deletedAt: null,
          OR: [{ messages: { some: {} } }, { verificationStatus: "VERIFIED", planType: { in: chatKeys } }],
        };
  const vendors = await prisma.vendor.findMany({
    where,
    select: {
      id: true,
      companyName: true,
      verificationStatus: true,
      planType: true,
      messages: { orderBy: { createdAt: "desc" }, take: 1 },
      _count: { select: { messages: { where: { senderRole: "VENDOR", readAt: null } } } },
    },
    // Con orden fijo: sin él, con más de 30 coincidencias cada sondeo de 5 s podía traer un grupo distinto y la tienda
    // buscada aparecía y desaparecía de la lista.
    ...(q.length >= 2 ? { take: 30, orderBy: [{ companyName: "asc" }, { id: "asc" }] } : {}),
  });

  const conversations = vendors
    .map((v) => ({
      vendorId: v.id,
      companyName: v.companyName,
      isVerified: v.verificationStatus === "VERIFIED",
      canRead: canReadAdminChat(v, chatKeys),
      lastMessage: v.messages[0] ?? null,
      unreadCount: v._count.messages,
    }))
    // Tiendas con conversación primero (más reciente arriba), después el
    // resto sin ordenar por actividad (nunca escribieron ni les escribieron).
    .sort((a, b) => {
      if (!a.lastMessage && !b.lastMessage) return a.companyName.localeCompare(b.companyName);
      if (!a.lastMessage) return 1;
      if (!b.lastMessage) return -1;
      return new Date(b.lastMessage.createdAt) - new Date(a.lastMessage.createdAt);
    });

  res.json({ conversations });
}

export async function getConversation(req, res) {
  const { vendorId } = req.params;
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, companyName: true, verificationStatus: true, planType: true } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const [messages, chatKeys] = await Promise.all([
    prisma.vendorMessage.findMany({ where: { vendorId }, orderBy: { createdAt: "asc" } }),
    adminChatPlanKeys(),
  ]);
  res.json({ vendor: { ...vendor, isVerified: vendor.verificationStatus === "VERIFIED", canRead: canReadAdminChat(vendor, chatKeys) }, messages });
}

const adminSendMessageSchema = z.object({ body: z.string().trim().min(1).max(2000) });

export async function sendConversationMessage(req, res) {
  const { vendorId } = req.params;
  const { body } = adminSendMessageSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, deletedAt: true, verificationStatus: true, planType: true } });
  if (!vendor || vendor.deletedAt) throw new AppError("Tienda no encontrada.", 404);
  // Un mensaje que la tienda no puede abrir no le llega a nadie: mejor decirlo que guardarlo en silencio.
  if (!canReadAdminChat(vendor, await adminChatPlanKeys())) {
    throw new AppError("Esta tienda no puede ver el chat con su plan actual. Escríbele por correo.", 409);
  }

  const message = await prisma.vendorMessage.create({
    data: { vendorId, senderRole: "ADMIN", senderId: req.user.id, body },
  });
  res.status(201).json({ message });
}

// Se llama cuando el admin efectivamente abre el hilo de esa tienda (no al
// recibir en el backend) — marca como leídos los mensajes que mandó el
// vendedor.
export async function markConversationRead(req, res) {
  const { vendorId } = req.params;
  await prisma.vendorMessage.updateMany({
    where: { vendorId, senderRole: "VENDOR", readAt: null },
    data: { readAt: new Date() },
  });
  res.status(204).end();
}

// --- Correo directo (Bloque 47) --------------------------------------------
// Distinto de AdminCampaigns.jsx (envío masivo segmentado, no se toca): esto
// es un correo puntual a UN destinatario elegido a mano.

const sendEmailSchema = z.object({
  recipientType: z.enum(["customer", "vendor"]),
  recipientId: z.string().min(1),
  // Mismos topes que el correo de una tienda a su cliente (manualEmailSchema en orders.controller.js).
  subject: z.string().trim().min(2).max(150, "El asunto puede tener hasta 150 caracteres."),
  message: z.string().trim().min(2).max(5000, "El mensaje puede tener hasta 5000 caracteres."),
});

export async function sendAdminEmail(req, res) {
  const { recipientType, recipientId, subject, message } = sendEmailSchema.parse(req.body);

  let to, recipientName, vendorId;
  if (recipientType === "customer") {
    const user = await prisma.user.findUnique({ where: { id: recipientId } });
    if (!user || user.role !== "CUSTOMER") throw new AppError("Cliente no encontrado.", 404);
    if (!user.email) throw new AppError("Este cliente no tiene un correo cargado.", 400);
    to = user.email;
    recipientName = user.fullName ?? null;
  } else {
    const vendor = await prisma.vendor.findUnique({ where: { id: recipientId } });
    if (!vendor) throw new AppError("Tienda no encontrada.", 404);
    if (!vendor.email) throw new AppError("Esta tienda no tiene un correo cargado.", 400);
    to = vendor.email;
    recipientName = vendor.companyName;
    vendorId = vendor.id;
  }

  const result = await sendAdminDirectEmail({ to, subject, message, recipientName, vendorId });
  if (!result.ok) throw new AppError("No se pudo enviar el correo. Revisa la integración de Resend.", 502, { detail: result.error });

  res.json({ ok: true });
}

// --- Búsqueda + notificaciones (Bloque 47) ----------------------------------

export async function adminSearch(req, res) {
  const q = String(req.query.q ?? "").trim();
  if (q.length < 2) return res.json({ vendors: [], customers: [], orders: [] });

  const [vendors, customers, orders] = await Promise.all([
    prisma.vendor.findMany({
      where: { deletedAt: null, companyName: { contains: q, mode: "insensitive" } },
      select: { id: true, companyName: true },
      take: 8,
    }),
    prisma.user.findMany({
      where: {
        role: "CUSTOMER",
        deletedAt: null,
        OR: [{ fullName: { contains: q, mode: "insensitive" } }, { email: { contains: q, mode: "insensitive" } }],
      },
      select: { id: true, fullName: true, email: true },
      take: 8,
    }),
    prisma.order.findMany({
      // Por cualquier parte del código: "MFX3K2" encuentra "Z-MFX3K2AB" aunque no se escriba el "Z-".
      where: { code: { contains: q.toUpperCase() } },
      select: { id: true, code: true, vendorId: true, vendor: { select: { companyName: true } } },
      orderBy: { createdAt: "desc" },
      take: 8,
    }),
  ]);

  res.json({
    // Cada resultado lleva a su ficha: la tienda, el cliente ya buscado y el pedido abierto dentro de su tienda
    // (antes los tres llevaban a la lista general y había que volver a buscar).
    vendors: vendors.map((v) => ({ id: v.id, label: v.companyName, to: `/admin/tiendas/${v.id}` })),
    customers: customers.map((c) => ({ id: c.id, label: c.fullName ?? c.email, to: `/admin/clientes?q=${encodeURIComponent(c.email)}` })),
    orders: orders.map((o) => ({ id: o.id, label: `${o.code} · ${o.vendor.companyName}`, to: `/admin/tiendas/${o.vendorId}?tab=pedidos&pedido=${o.id}` })),
  });
}

// Agregación en vivo (ver decisión D del bloque) — sin tabla de
// notificaciones propia ni estado de "leído" persistente: reusa las mismas
// queries que ya alimentan cada sección (Verificaciones/Sugerencias/Errores/
// Mensajes), solo junta el conteo y los últimos items acá.
// Bloque 231 (pedido explícito — "cuando un cliente envía un pedido se
// debe notificar en tiempo real en el panel de admin"): mismas 2 horas de
// ventana que basta para que la campanita se sienta "en vivo" sin acumular
// pedidos viejos ya vistos hace rato — un pedido no es algo que el admin
// tenga que "resolver" como el resto de esta lista, pero igual entra acá
// (mismo criterio que sugerencias/errores de abajo, que tampoco son
// estrictamente "acción pendiente").
const RECENT_ORDERS_WINDOW_MS = 2 * 60 * 60 * 1000;

// Casos que los clientes le contaron al asistente (problemas con un pedido o con la web) y que quedaron para el admin.
export async function listSupportCases(_req, res) {
  const cases = await prisma.supportCase.findMany({
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
    take: 100,
    include: { vendor: { select: { companyName: true, slug: true } } },
  });
  res.json({ cases });
}

export async function resolveSupportCase(req, res) {
  const updated = await prisma.supportCase.update({ where: { id: req.params.id }, data: { status: "RESOLVED", resolvedAt: new Date() } }).catch(() => null);
  if (!updated) throw new AppError("Caso no encontrado.", 404);
  res.json({ case: updated });
}

// Sección › subsección de cada tipo de aviso de la campanita (por el prefijo de su id) y, si corresponde, la pestaña exacta.
const NOTICE_WHERE = [
  ["new-vendor-", "Tiendas"],
  ["trial-accepted-", "Tiendas › Prueba gratis"],
  ["trial-", "Suscripciones › Prueba gratis"],
  ["support-", "Casos de soporte"],
  ["verification-", "Verificaciones › Documentos pendientes", "/admin/verificaciones?tab=docs"],
  ["message-", "Mensajes"],
  ["payment-", "Verificaciones › Pago pendiente", "/admin/verificaciones?tab=pago"],
  ["renewal-", "Verificaciones › Renovaciones", "/admin/verificaciones?tab=renovaciones"],
  ["change-", "Verificaciones › Cambios de datos", "/admin/verificaciones?tab=cambios"],
  ["report-", "Comentarios › Reportados"],
  ["fraud-", "Reportes de fraude › Pendientes"],
  ["ticket-", "Errores › Tickets de las tiendas"],
  ["order-", "Tiendas › Pedidos nuevos"],
];

// Contadores por sección y por pestaña para las marcas del menú lateral y de cada pestaña: así el admin ve si lo pendiente
// está en la sección o en una de sus subsecciones.
export async function getSectionCounts(_req, res) {
  const alive = { deletedAt: null };
  const [docs, pago, cobro, renovaciones, cambios, mensajes, comentarios, casos, sugerencias, erroresSistema, tickets] = await Promise.all([
    prisma.vendor.count({ where: { ...alive, verificationStatus: { in: ["PENDING_DOCS", "IN_REVIEW"] } } }),
    prisma.vendor.count({ where: { ...alive, verificationStatus: "PENDING_PAYMENT" } }),
    prisma.vendor.count({ where: { ...alive, verificationStatus: { in: ["PAYMENT_FAILED", "SUSPENDED"] } } }),
    prisma.subscriptionPayment.count({ where: { confirmedAt: null, claimedAt: { not: null } } }),
    prisma.vendorChangeRequest.count({ where: { status: "PENDING" } }),
    prisma.vendorMessage.count({ where: { senderRole: "VENDOR", readAt: null } }),
    prisma.review.count({ where: { reportStatus: "REPORTED" } }),
    prisma.supportCase.count({ where: { status: "OPEN", vendorId: null } }),
    prisma.suggestion.count({ where: { status: "NEW" } }),
    prisma.errorLog.count({ where: { resolved: false } }),
    prisma.supportTicket.count({ where: { status: { in: ["NEW", "IN_REVIEW"] } } }),
  ]);
  res.json({
    verificaciones: { total: docs + pago + renovaciones + cambios, tabs: { docs, pago, cobro, renovaciones, cambios } },
    mensajes: { total: mensajes },
    comentarios: { total: comentarios },
    casosSoporte: { total: casos },
    sugerencias: { total: sugerencias },
    errores: { total: erroresSistema + tickets, tabs: { sistema: erroresSistema, tickets } },
  });
}

export async function listAdminNotifications(_req, res) {
  const DAY = 24 * 60 * 60 * 1000;
  const [pendingVerifications, newSuggestions, unresolvedErrors, vendorsWithUnread, paymentClaims, reportedReviews, pendingFraudReports, recentOrders, openSupportCases, newVendors, newTrials, acceptedTrials, newTickets, renewalClaims, changeRequests] = await Promise.all([
    prisma.vendor.findMany({
      where: { verificationStatus: { in: ["PENDING_DOCS", "IN_REVIEW"] }, deletedAt: null },
      select: { id: true, companyName: true, createdAt: true },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.suggestion.count({ where: { status: "NEW" } }),
    prisma.errorLog.count({ where: { resolved: false } }),
    prisma.vendor.findMany({
      where: { messages: { some: { senderRole: "VENDOR", readAt: null } } },
      select: { id: true, companyName: true, _count: { select: { messages: { where: { senderRole: "VENDOR", readAt: null } } } } },
      take: 5,
    }),
    // Bloque 70 (pedido explícito): pago CUP reclamado ("Ya pagué") sin
    // confirmar todavía por un admin — antes invisible en la campanita.
    prisma.vendor.findMany({
      where: { verification: { paymentClaimedAt: { not: null }, paymentConfirmedById: null }, deletedAt: null },
      select: { id: true, companyName: true, verification: { select: { paymentClaimedAt: true } } },
      take: 5,
    }),
    // Bloque 70 (pedido explícito): comentario reportado esperando que el
    // admin decida mantener/suspender — antes invisible en la campanita.
    prisma.review.findMany({
      where: { reportStatus: "REPORTED" },
      select: { id: true, reportedAt: true, vendor: { select: { companyName: true } } },
      take: 5,
    }),
    // Feature B (pedido explícito): "el admin debe poder ver, desde su
    // panel, una alerta con el producto/tienda reportado" — mismo criterio
    // que reportedReviews de arriba (sin tabla de notificaciones propia,
    // agregación en vivo).
    prisma.report.findMany({
      where: { status: "PENDING" },
      select: {
        id: true,
        createdAt: true,
        product: { select: { name: true } },
        vendor: { select: { companyName: true } },
        customerListing: { select: { name: true } },
      },
      take: 5,
    }),
    prisma.order.findMany({
      where: { createdAt: { gte: new Date(Date.now() - RECENT_ORDERS_WINDOW_MS) } },
      // items y vendor.currency: para mostrar el total en la moneda del pedido (orderCurrency), no siempre en CUP.
      select: {
        id: true,
        code: true,
        total: true,
        vendorId: true,
        createdAt: true,
        items: { select: { currency: true }, take: 1 },
        vendor: { select: { companyName: true, currency: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
    prisma.supportCase.findMany({ where: { status: "OPEN", vendorId: null }, select: { id: true, name: true, kind: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    // Tiendas registradas en las últimas 48 h (antes solo llegaba el aviso push, no quedaban en la campana).
    prisma.vendor.findMany({ where: { createdAt: { gte: new Date(Date.now() - 2 * DAY) }, deletedAt: null }, select: { id: true, companyName: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    // Pruebas gratis de 30 días activadas en las últimas 48 h (la prueba vence a los 30 días de activarse).
    prisma.vendor.findMany({ where: { trialEndsAt: { gte: new Date(Date.now() + 28 * DAY) }, deletedAt: null }, select: { id: true, companyName: true, trialEndsAt: true }, take: 5 }),
    // Tiendas que aceptaron la prueba en las últimas 48 h y todavía no completaron los requisitos para que se active.
    // Sin las que ya están en Premium: ahí aceptar la oferta no cambia nada y el aviso confunde.
    prisma.vendor.findMany({ where: { trialStartedAt: { gte: new Date(Date.now() - 2 * DAY) }, trialEndsAt: null, deletedAt: null, verificationStatus: { not: "VERIFIED" } }, select: { id: true, companyName: true, trialStartedAt: true }, orderBy: { trialStartedAt: "desc" }, take: 5 }),
    // Reportes de problemas (tickets) que el admin todavía no abrió.
    prisma.supportTicket.findMany({ where: { status: "NEW" }, select: { id: true, number: true, section: true, pagePath: true, reporterName: true, createdAt: true }, orderBy: { createdAt: "desc" }, take: 5 }),
    // Renovaciones que la tienda marcó como pagadas ("Ya pagué") y esperan confirmación: el mismo criterio que la pestaña
    // Renovaciones (getSectionCounts y listPendingSubscriptionPayments). Antes la campanita no las avisaba.
    prisma.subscriptionPayment.findMany({
      where: { confirmedAt: null, claimedAt: { not: null } },
      select: { id: true, claimedAt: true, vendor: { select: { companyName: true } } },
      orderBy: { claimedAt: "desc" },
      take: 5,
    }),
    // Cambios de datos que pidió una tienda (nombre, responsable, dirección) esperando la decisión del admin.
    prisma.vendorChangeRequest.findMany({
      where: { status: "PENDING" },
      select: { id: true, createdAt: true, vendor: { select: { companyName: true } } },
      orderBy: { createdAt: "desc" },
      take: 5,
    }),
  ]);

  const items = [
    ...newVendors.map((v) => ({
      id: `new-vendor-${v.id}`,
      text: `Tienda nueva registrada: ${v.companyName}`,
      to: `/admin/tiendas/${v.id}`,
      createdAt: v.createdAt,
    })),
    ...acceptedTrials.map((v) => ({
      id: `trial-accepted-${v.id}`,
      text: `Aceptó la prueba gratis (completando requisitos): ${v.companyName}`,
      to: `/admin/tiendas/${v.id}`,
      createdAt: v.trialStartedAt,
    })),
    ...newTrials.map((v) => ({
      id: `trial-${v.id}`,
      text: `Prueba gratis activada: ${v.companyName}`,
      to: `/admin/tiendas/${v.id}`,
      createdAt: new Date(new Date(v.trialEndsAt).getTime() - 30 * DAY),
    })),
    ...openSupportCases.map((c) => ({
      id: `support-${c.id}`,
      text: `${c.kind === "ORDER" ? "Problema con un pedido" : "Problema con la web"}: ${c.name}`,
      to: "/admin/casos-soporte",
      createdAt: c.createdAt,
    })),
    ...pendingVerifications.map((v) => ({
      id: `verification-${v.id}`,
      text: `Verificación pendiente: ${v.companyName}`,
      to: "/admin/verificaciones",
      createdAt: v.createdAt,
    })),
    ...vendorsWithUnread.map((v) => ({
      id: `message-${v.id}`,
      text: `${v._count.messages} mensaje(s) sin leer de ${v.companyName}`,
      to: `/admin/mensajes/${v.id}`,
      createdAt: null,
    })),
    ...paymentClaims.map((v) => ({
      id: `payment-${v.id}`,
      text: `Pago reclamado sin confirmar: ${v.companyName}`,
      to: "/admin/verificaciones",
      createdAt: v.verification?.paymentClaimedAt ?? null,
    })),
    ...renewalClaims.map((p) => ({
      id: `renewal-${p.id}`,
      text: `Renovación pagada sin confirmar: ${p.vendor.companyName}`,
      to: "/admin/verificaciones?tab=renovaciones",
      createdAt: p.claimedAt,
    })),
    ...changeRequests.map((r) => ({
      id: `change-${r.id}`,
      text: `Cambio de datos por revisar: ${r.vendor.companyName}`,
      to: "/admin/verificaciones?tab=cambios",
      createdAt: r.createdAt,
    })),
    ...reportedReviews.map((r) => ({
      id: `report-${r.id}`,
      text: `Comentario reportado${r.vendor ? ` · ${r.vendor.companyName}` : ""}`,
      to: `/admin/comentarios?review=${r.id}`,
      createdAt: r.reportedAt,
    })),
    ...pendingFraudReports.map((r) => ({
      id: `fraud-${r.id}`,
      text: `Reporte de fraude: ${r.product?.name ?? r.vendor?.companyName ?? r.customerListing?.name ?? "objetivo eliminado"}`,
      to: `/admin/reportes-fraude?report=${r.id}`,
      createdAt: r.createdAt,
    })),
    ...newTickets.map((t) => ({
      id: `ticket-${t.id}`,
      text: `Reporte de problema T-${String(t.number).padStart(5, "0")}: ${t.section ?? t.pagePath}${t.reporterName ? ` (${t.reporterName})` : ""}`,
      to: `/admin/errores?tab=tickets&ticket=${t.id}`,
      createdAt: t.createdAt,
    })),
    // Bloque 231 (pedido explícito): visibilidad en tiempo real de pedidos nuevos. Lleva al pedido abierto dentro de su
    // tienda, igual que el buscador (adminSearch). El total va en la moneda del pedido: una tienda en USD salía en "CUP".
    ...recentOrders.map((o) => ({
      id: `order-${o.id}`,
      text: `Pedido nuevo ${o.code} · ${o.vendor.companyName} (${money(o.total, orderCurrency({ items: o.items, currency: o.vendor.currency }))})`,
      to: `/admin/tiendas/${o.vendorId}?tab=pedidos&pedido=${o.id}`,
      createdAt: o.createdAt,
    })),
  ].sort((a, b) => new Date(b.createdAt ?? 0) - new Date(a.createdAt ?? 0));

  // Cada aviso dice en qué sección (y subsección, si la tiene) está, y lleva directo a esa pestaña.
  for (const item of items) {
    const hit = NOTICE_WHERE.find(([prefix]) => item.id.startsWith(prefix));
    if (!hit) continue;
    item.where = hit[1];
    if (hit[2]) item.to = hit[2];
  }

  if (newSuggestions > 0) {
    items.push({ id: "suggestions", where: "Sugerencias", text: `${newSuggestions} sugerencia(s) nueva(s)`, to: "/admin/sugerencias", createdAt: null });
  }
  if (unresolvedErrors > 0) {
    items.push({ id: "errors", where: "Errores › Errores del sistema", text: `${unresolvedErrors} error(es) sin resolver`, to: "/admin/errores", createdAt: null });
  }

  const total =
    pendingVerifications.length +
    newSuggestions +
    unresolvedErrors +
    vendorsWithUnread.reduce((sum, v) => sum + v._count.messages, 0) +
    paymentClaims.length +
    reportedReviews.length +
    pendingFraudReports.length +
    openSupportCases.length +
    renewalClaims.length +
    changeRequests.length +
    newTickets.length +
    recentOrders.length +
    newVendors.length +
    newTrials.length +
    acceptedTrials.length;

  res.json({ items: items.slice(0, 12), total });
}

// --- Historial de actividad (Bloque 70, pedido explícito) -------------------
// "una sección dedicada a todas las acciones de vendedores y de clientes...
// para tener un récord de todo lo que hacen en sus paneles" — lista cruda
// (listActivityLog) + agregación de uso por vendedor/cliente para el gráfico
// de "quién más usa la plataforma" (getActivityStats). Alimentado por
// logActivity() (lib/activityLog.js), llamado best-effort desde cada acción
// relevante ya instrumentada en los controllers de vendedor/cliente.

export async function listActivityLog(req, res) {
  const { role, vendorId, action } = req.query;
  const logs = await prisma.activityLog.findMany({
    where: {
      actorRole: role === "VENDOR" || role === "CUSTOMER" ? role : undefined,
      vendorId: vendorId ? String(vendorId) : undefined,
      action: action ? String(action) : undefined,
    },
    include: {
      actor: { select: { fullName: true, email: true } },
      vendor: { select: { companyName: true, slug: true } },
    },
    orderBy: { createdAt: "desc" },
    take: 150,
  });
  res.json({ logs });
}

const ACTIVITY_PERIODS = {
  day: 24 * 60 * 60 * 1000,
  week: 7 * 24 * 60 * 60 * 1000,
  month: 30 * 24 * 60 * 60 * 1000,
};

// Mismo criterio que "Tiendas por provincia" en getDashboard: `pct` viene ya
// calculado server-side (contra el máximo del propio grupo) para que el
// frontend solo dibuje una barra con ese ancho, sin lógica propia.
export async function getActivityStats(req, res) {
  const period = ACTIVITY_PERIODS[req.query.period] ? req.query.period : "day";
  const since = new Date(Date.now() - ACTIVITY_PERIODS[period]);

  const [topVendorGroups, topCustomerGroups, totalActions] = await Promise.all([
    prisma.activityLog.groupBy({
      by: ["vendorId"],
      // Bloque 183: incluye acciones de usuarios de sistema (VENDOR_STAFF)
      // del negocio, no solo del dueño — "cuánto se mueve este vendedor"
      // tiene que contar toda la actividad de su panel, sin importar quién
      // de su equipo la hizo.
      where: { actorRole: { in: ["VENDOR", "VENDOR_STAFF"] }, vendorId: { not: null }, createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { vendorId: "desc" } },
      take: 10,
    }),
    prisma.activityLog.groupBy({
      by: ["actorId"],
      where: { actorRole: "CUSTOMER", createdAt: { gte: since } },
      _count: { _all: true },
      orderBy: { _count: { actorId: "desc" } },
      take: 10,
    }),
    prisma.activityLog.count({ where: { createdAt: { gte: since } } }),
  ]);

  const [vendors, customers] = await Promise.all([
    prisma.vendor.findMany({
      where: { id: { in: topVendorGroups.map((g) => g.vendorId) } },
      select: { id: true, companyName: true, slug: true },
    }),
    prisma.user.findMany({
      where: { id: { in: topCustomerGroups.map((g) => g.actorId) } },
      select: { id: true, fullName: true, email: true },
    }),
  ]);
  const vendorById = Object.fromEntries(vendors.map((v) => [v.id, v]));
  const customerById = Object.fromEntries(customers.map((c) => [c.id, c]));

  const maxVendorCount = Math.max(1, ...topVendorGroups.map((g) => g._count._all));
  const maxCustomerCount = Math.max(1, ...topCustomerGroups.map((g) => g._count._all));

  res.json({
    period,
    totalActions,
    topVendors: topVendorGroups.map((g) => ({
      vendorId: g.vendorId,
      companyName: vendorById[g.vendorId]?.companyName ?? "Tienda eliminada",
      slug: vendorById[g.vendorId]?.slug ?? null,
      count: g._count._all,
      pct: `${Math.round((g._count._all / maxVendorCount) * 100)}%`,
    })),
    topCustomers: topCustomerGroups.map((g) => ({
      customerId: g.actorId,
      name: customerById[g.actorId]?.fullName ?? customerById[g.actorId]?.email ?? "Cliente eliminado",
      count: g._count._all,
      pct: `${Math.round((g._count._all / maxCustomerCount) * 100)}%`,
    })),
  });
}
