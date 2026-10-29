import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { clearPublicCache } from "../middleware/publicCache.js";
import {
  getAllPlanConfigs,
  invalidatePlanConfigCache,
  recalcVendorProductQuota,
  buildPlanIncludes,
  normalizeMonthDiscounts,
  paymentPlanOf,
  planKeyFromName,
  recordPlanChange,
  isPaidConfig,
  PLAN_KEY_PATTERN,
} from "../lib/planConfig.js";
import {
  FEATURE_REGISTRY,
  FEATURE_GROUPS,
  getPlanFeatureCatalog,
  invalidatePlanFeatureCatalogCache,
  featureKeyFromLabel,
  planFeatureList,
  customFeaturesOf,
} from "../lib/planFeatures.js";
import { recalcStoreOffersForPlan } from "../lib/storeOfferVisibility.js";
import { setCardSubscriptionCancelAtPeriodEnd } from "../lib/stripe.js";
import { applyPlanDowngrade } from "../services/planDowngrade.service.js";
import { notifyVendor } from "../lib/notify.js";
import { runWithContext, requestContext } from "../lib/requestContext.js";
import { logActivity } from "../lib/activityLog.js";
import { startOfDayInTimezone } from "../lib/timezone.js";
// settings.controller.js importa este archivo (applyPlanUpdate): el ciclo es seguro porque getSiteTimezone es una función
// declarada y solo se llama dentro de las rutas, nunca al cargar el módulo.
import { getSiteTimezone } from "./settings.controller.js";

// API del admin para los planes (Configuración > Planes y pagos): crear, editar, archivar con plan destino, restaurar,
// ver el impacto de un cambio antes de guardarlo, el catálogo de funciones y las estadísticas por plan. El contrato está en
// el documento de planes dinámicos: la clave de un plan es PlanConfig.planType, nunca cambia, y un plan nunca se borra (la
// clave foránea lo impide mientras tenga tiendas, pagos o historial): se archiva moviendo antes sus tiendas a otro plan.
// La ruta vieja PATCH /admin/plan-configs (settings.controller.js) usa la misma validación y los mismos efectos de aquí
// (applyPlanUpdate), así las dos pantallas nunca aplican reglas distintas.

const DAY_MS = 24 * 60 * 60 * 1000;
const round2 = (n) => Math.round(n * 100) / 100;
const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

// Después de escribir en PlanConfig o PlanFeature: las cachés de 5 s y la caché pública (/settings/plans) se vacían para que
// el cambio se vea al instante en la página de planes y en el panel de las tiendas.
function afterPlanWrite({ catalog = false } = {}) {
  invalidatePlanConfigCache();
  if (catalog) invalidatePlanFeatureCatalogCache();
  clearPublicCache();
}

function keyFromParam(raw) {
  const key = String(raw ?? "");
  if (!PLAN_KEY_PATTERN.test(key)) throw new AppError("Plan no encontrado.", 404);
  return key;
}

// Un plan "cobrado sin verificación" (planBilling.service.js): ni gratis, ni por WhatsApp, ni con insignia. Sus tiendas
// entran al ciclo de avisos de cobro mensual.
const billedWithoutBadge = (c) => !!c && !c.isFree && !c.contactOnly && !c.grantsBadge;

// P2003 (clave foránea) al escribir un plan = una clave de plan que no existe: es un dato mal puesto, no un fallo del servidor.
// P2002 (clave única) = otro guardado ganó la carrera: la misma clave de plan al crear, o el plan por defecto / de prueba
// (índices únicos parciales) movido a la vez desde otra pestaña.
function mapPrismaError(err) {
  if (err?.code === "P2003") return new AppError("Ese plan no existe.", 400);
  if (err?.code === "P2002") return new AppError("Otro cambio de planes se guardó a la vez. Recarga y prueba de nuevo.", 409);
  return err;
}

// Una tienda que ya pagó tiempo (nextPaymentDueDate en el futuro) y entra a un plan cobrado sin verificación conserva ese
// tiempo: se la marca como ya dentro del ciclo de cobro (etapa "start") para que runPlanBilling no la trate como nueva, que
// le pisaría la fecha con la de su día de registro (paso 2 de planBilling.service.js) y le cobraría antes de tiempo lo que
// ya pagó por verificación o con tarjeta. El paso 3 la sigue con su fecha real (aviso 7 días antes, el día del cobro...).
// Se corre dentro de la misma transacción que pone el plan en cobro: la pasada horaria nunca ve el plan cobrado con esas
// tiendas todavía sin marcar. Las bloqueadas quedan fuera, igual que en el paso 2.
function keepPaidTimeWhere(planType) {
  return { planType, deletedAt: null, isBlocked: false, billingNoticeStage: null, nextPaymentDueDate: { gt: new Date() } };
}
const KEEP_PAID_TIME_DATA = { billingNoticeStage: "start", billingNoticeDue: null };

// Funciones del plan que se guardan en la tienda y el servidor no vuelve a comprobar al leer: el botón de WhatsApp
// (orderDestination, que leen pedidos y productos tal cual) y el perfil privado (isPrivate, que solo se recorta al editar el
// perfil). Si el plan deja de incluirlas, las tiendas que las usaban vuelven a lo básico. Las tiendas de un socio quedan
// fuera del perfil privado: su isPrivate lo decide el socio (listInMarketplace), no el plan.
const whatsappOnWhere = (planType, extra = {}) => ({ planType, orderDestination: { not: "PANEL" }, ...extra });
const privateOnWhere = (planType, extra = {}) => ({ planType, isPrivate: true, partnerId: null, ...extra });

// --- Validación de un cambio de plan --------------------------------------------------------------------------------------
// Los campos de siempre (los que editaba PlanConfigCard) más las banderas de papel (isDefault, isTrialPlan), los valores de
// las funciones del catálogo y las personalizadas. Todo opcional: cada pantalla manda solo lo que edita.
const discountSchema = z.object({
  months: z.number().int().min(2, "Los descuentos van de 2 a 24 meses.").max(24, "Los descuentos van de 2 a 24 meses."),
  cup: z.number().int().min(0).max(90, "El descuento admite hasta 90 %."),
  usd: z.number().int().min(0).max(90, "El descuento admite hasta 90 %."),
});

// Beneficios en texto libre: con tope de líneas y de largo, porque se muestran tal cual en la página de planes.
const textFeaturesSchema = z
  .array(z.string().trim().min(1, "Hay un beneficio vacío.").max(80, "Cada beneficio admite hasta 80 caracteres."))
  .max(12, "Hasta 12 beneficios por plan.");

// Valores de las funciones del catálogo: { clave: { enabled?, limit? } }. Un tope con interruptor (usuarios, mesas, códigos,
// ofertas, correos) admite las dos cosas en la misma entrada, como se muestra en la pantalla (casilla + "Hasta").
const featureValueMapSchema = z.record(
  z.string(),
  z.object({
    enabled: z.boolean().optional(),
    limit: z.number().int("El tope tiene que ser un número entero.").min(0, "El tope no puede ser negativo.").max(1_000_000).nullable().optional(),
  })
);

// Las columnas de límites e interruptores salen del registro de funciones, así una función nueva del registro se puede
// editar sin tocar este esquema. allowPanelOrders se acepta por compatibilidad con la pantalla vieja y se descarta.
const registryColumns = Object.fromEntries(
  Object.values(FEATURE_REGISTRY).map((f) => [
    f.column,
    f.kind === "limit" ? z.number().int().min(0).max(1_000_000).optional().nullable() : z.boolean().optional(),
  ])
);

export const planPatchSchema = z.object({
  ...registryColumns,
  displayName: z.string().trim().min(1, "Escribe el nombre del plan.").max(40, "El nombre admite hasta 40 caracteres.").optional(),
  tagline: z.string().trim().max(90, "La frase admite hasta 90 caracteres.").optional().nullable(),
  sortOrder: z.number().int().min(0).max(999).optional(),
  priceCup: z.number().int().min(0).max(10_000_000).optional(),
  priceUsd: z.number().min(0).max(100_000).optional(),
  listPriceCup: z.number().int().min(0).max(10_000_000).optional().nullable(),
  listPriceUsd: z.number().min(0).max(100_000).optional().nullable(),
  isFree: z.boolean().optional(),
  contactOnly: z.boolean().optional(),
  highlighted: z.boolean().optional(),
  grantsBadge: z.boolean().optional(),
  isPublic: z.boolean().optional(),
  monthDiscounts: z
    .array(discountSchema)
    .max(6, "Hasta 6 descuentos por plan.")
    .refine((a) => new Set(a.map((d) => d.months)).size === a.length, "Hay dos descuentos para la misma cantidad de meses.")
    .optional(),
  // Arreglo = beneficios en texto libre (como siempre). Objeto = valores de las funciones del catálogo (contrato nuevo). Se
  // validan en buildPlanPatch según la forma que llegue.
  features: z.unknown().optional(),
  featureValues: featureValueMapSchema.optional(),
  customFeatures: z.record(z.string(), z.boolean()).optional(),
  isDefault: z.boolean().optional(),
  isTrialPlan: z.boolean().optional(),
  // Confirmaciones explícitas de los cambios con efectos sobre tiendas reales (ver applyPlanUpdate).
  confirmBadgeImpact: z.boolean().optional(),
  confirmBillingImpact: z.boolean().optional(),
});

// Arma el `data` que se guarda y el plan como quedaría (`next`) a partir del plan actual y lo pedido. Lanza 400/409 con el
// motivo en español si la combinación no es válida. No escribe nada (lo usa también la vista previa).
async function buildPlanPatch(before, input) {
  const { features, featureValues, customFeatures, isDefault, isTrialPlan, confirmBadgeImpact, confirmBillingImpact, ...rest } = input;
  const data = { ...rest };
  // Ya no se usa: todo pedido entra al panel en cualquier plan (ver FEATURE_REGISTRY.allowPanelOrders).
  delete data.allowPanelOrders;

  let valueMap = featureValues ? { ...featureValues } : null;
  if (features !== undefined) {
    if (Array.isArray(features)) data.features = textFeaturesSchema.parse(features);
    else valueMap = { ...featureValueMapSchema.parse(features), ...(valueMap ?? {}) };
  }

  if (data.monthDiscounts) data.monthDiscounts = normalizeMonthDiscounts(data.monthDiscounts);

  const catalog = valueMap || customFeatures ? await getPlanFeatureCatalog() : [];
  const catalogByKey = new Map(catalog.map((f) => [f.key, f]));

  if (valueMap) {
    for (const [key, value] of Object.entries(valueMap)) {
      const reg = FEATURE_REGISTRY[key];
      const entry = catalogByKey.get(key);
      if (!reg || !entry?.isActive || reg.isActive === false) {
        throw new AppError(`La función "${key}" no existe o no se puede cambiar desde aquí.`, 400);
      }
      if (reg.kind === "flag") {
        if (typeof value.enabled !== "boolean") throw new AppError(`Indica si "${entry.label}" va incluida o no.`, 400);
        data[reg.column] = value.enabled;
        continue;
      }
      if (value.limit !== undefined) data[reg.column] = value.limit;
      // El interruptor del par (casilla "Incluida") viaja en la misma fila que su tope.
      if (typeof value.enabled === "boolean" && reg.governedBy) data[FEATURE_REGISTRY[reg.governedBy].column] = value.enabled;
      if (value.limit === undefined && !(typeof value.enabled === "boolean" && reg.governedBy)) {
        throw new AppError(`Escribe el tope de "${entry.label}" (vacío = sin tope).`, 400);
      }
    }
  }

  if (customFeatures) {
    const merged = { ...customFeaturesOf(before) };
    for (const [key, on] of Object.entries(customFeatures)) {
      const entry = catalogByKey.get(key);
      if (!entry || entry.kind !== "custom" || !entry.isActive) {
        throw new AppError(`La función personalizada "${key}" no existe o está apagada.`, 400);
      }
      if (on) merged[key] = true;
      else delete merged[key];
    }
    data.customFeatures = merged;
  }

  // Las banderas de papel solo se encienden: se apagan al encenderlas en otro plan (siempre tiene que haber un plan por
  // defecto, y apagarla sin elegir otro dejaría el registro de tiendas sin plan).
  if (isDefault === false && before.isDefault) throw new AppError("Elige otro plan como plan por defecto.", 400);
  if (isTrialPlan === false && before.isTrialPlan) throw new AppError("Elige otro plan para la prueba gratis.", 400);
  const setDefault = isDefault === true && !before.isDefault;
  const setTrial = isTrialPlan === true && !before.isTrialPlan;

  // Un plan oculto o "por WhatsApp" no puede quedar como el destacado: si el destacado se oculta, deja de serlo solo.
  const willHide = data.isPublic === false || data.contactOnly === true;
  if (before.highlighted && data.highlighted === undefined && willHide) data.highlighted = false;

  const next = { ...before, ...data, isDefault: before.isDefault || setDefault, isTrialPlan: before.isTrialPlan || setTrial };
  await validateNext(before, next);
  return { data, next, setDefault, setTrial, confirm: { badge: confirmBadgeImpact === true, billing: confirmBillingImpact === true } };
}

// Reglas que tiene que cumplir el plan tal como quedaría (no solo lo que cambió).
async function validateNext(before, next) {
  if (next.isFree && next.contactOnly) {
    throw new AppError("Un plan no puede ser gratis y por WhatsApp a la vez: elige una de las dos.", 400);
  }
  // Un plan que se cobra necesita precio en las dos monedas (la tienda paga con tarjeta en USD o por transferencia en CUP).
  if (!next.isFree && !next.contactOnly && (!(next.priceCup > 0) || !(next.priceUsd > 0))) {
    throw new AppError("Para cobrar este plan escribe su precio en CUP y en USD, o márcalo como gratis o por WhatsApp.", 400);
  }
  // El plan por defecto nunca lleva la insignia, sea gratis o cobrado: es el de las tiendas nuevas (sin verificar) y el de
  // bajada (applyPlanDowngrade deja la tienda en PLAN_ENDED, sin insignia). Con insignia, reconcilePlanVerification
  // "bajaría" a las tiendas sin verificar al mismo plan, un ciclo sin salida, e isPremiumActive lo ignora siempre.
  if (next.isDefault && next.grantsBadge) {
    throw new AppError("El plan por defecto no puede dar la insignia de verificada: es el de las tiendas nuevas y el de las que dejan de pagar.", 400);
  }
  if (next.isDefault && next.contactOnly) throw new AppError("El plan por defecto no puede contratarse solo por WhatsApp: es el de las tiendas nuevas.", 400);
  if (next.isDefault && !next.isPublic) throw new AppError("El plan por defecto tiene que ser público: es el de las tiendas nuevas.", 400);
  if (next.isTrialPlan && (next.isFree || next.contactOnly)) {
    throw new AppError("El plan de la prueba gratis tiene que ser un plan que se pague en línea (ni gratis ni por WhatsApp).", 400);
  }
  if (next.highlighted && (!next.isPublic || next.contactOnly)) {
    throw new AppError("Solo un plan público que se pague en línea o gratis puede ser el destacado.", 400);
  }
  if (next.displayName !== before.displayName) await assertNameFree(next.displayName, before.planType);
}

// Dos planes vigentes con el mismo nombre confunden a las tiendas y al admin (los archivados no cuentan).
async function assertNameFree(name, exceptKey = null) {
  const norm = (s) => String(s).trim().toLocaleLowerCase("es");
  const plans = await prisma.planConfig.findMany({ where: { archivedAt: null }, select: { planType: true, displayName: true } });
  if (plans.some((p) => p.planType !== exceptKey && norm(p.displayName) === norm(name))) {
    throw new AppError(`Ya hay un plan llamado "${String(name).trim()}". Usa otro nombre.`, 409);
  }
}

// --- Impacto de un cambio (vista previa y confirmaciones) -----------------------------------------------------------------
const capOf = (c, flagCol, col) => (flagCol && !c[flagCol] ? 0 : c[col] ?? null);
const offersCap = (c) => (c.allowStoreOffers && c.allowDiscountCodes ? c.maxActiveStoreOffers ?? null : 0);
const sumExcess = (groups, max, field = "_count") => groups.reduce((s, g) => s + Math.max(0, (g[field]?._all ?? 0) - max), 0);

// Lo que pasaría con las tiendas del plan `before` si quedara como `next` (o si se archiva moviéndolas a `moveTo`, en cuyo
// caso `next` es el plan destino). Cada cifra cuenta solo lo que cambia por esta acción; `messages` las explica en frases
// para el modal de confirmación. No escribe nada.
async function computeImpact(before, next, { moveTo = null, setDefault = false, setTrial = false } = {}) {
  const archive = !!moveTo;
  const now = new Date();
  const vendors = await prisma.vendor.findMany({
    where: { planType: before.planType, deletedAt: null },
    select: {
      id: true,
      verificationStatus: true,
      trialEndsAt: true,
      nextPaymentDueDate: true,
      stripeSubscriptionId: true,
      billingNoticeStage: true,
      isBlocked: true,
      orderDestination: true,
      isPrivate: true,
      partnerId: true,
    },
  });
  const paidAhead = (v) => !!v.nextPaymentDueDate && new Date(v.nextPaymentDueDate) > now;
  const inRunningTrial = (v) => !!v.trialEndsAt && new Date(v.trialEndsAt) > now;
  const ids = vendors.map((v) => v.id);
  const impact = {
    plan: before.planType,
    vendors: ids.length,
    productsHidden: 0,
    staffWithoutAccess: 0,
    staffOverLimit: 0,
    tablesDisabled: 0,
    tablesOverLimit: 0,
    storeOffersTurnedOff: 0,
    discountCodesBlocked: 0,
    cardSubscriptionsOldPrice: 0,
    cardSubscriptionsCancelled: 0,
    vendorsToBill: 0,
    paidTimeKept: 0,
    paymentDatesCleared: 0,
    verifiedWithoutDueDate: 0,
    manualRenewals: 0,
    whatsappOrdersTurnedOff: 0,
    privateStoresMadePublic: 0,
    vendorsLosingBadge: 0,
    vendorsToDefault: 0,
    trialsEnded: 0,
    badgeChange: archive ? null : next.grantsBadge === before.grantsBadge ? null : next.grantsBadge ? "on" : "off",
    moveTo: moveTo?.planType ?? null,
    messages: [],
  };
  const msg = impact.messages;
  const defaultPlan = await prisma.planConfig.findFirst({ where: { isDefault: true, archivedAt: null }, select: { planType: true, displayName: true } });
  const defaultName = defaultPlan?.displayName ?? "por defecto";
  const name = archive ? moveTo.displayName : next.displayName;

  if (ids.length) {
    if (archive) msg.push(`${ids.length === 1 ? "Su tienda pasará" : `Sus ${ids.length} tiendas pasarán`} al plan ${moveTo.displayName}.`);
    else msg.push(`Esto afecta a ${plural(ids.length, "tienda", "tiendas")}.`);

    // Productos visibles: cada tienda conserva a la vista solo hasta el nuevo tope (rankForQuota decide cuáles).
    const newMax = next.maxProducts ?? null;
    if (newMax !== null && (archive || newMax !== (before.maxProducts ?? null))) {
      const groups = await prisma.product.groupBy({ by: ["vendorId"], where: { vendorId: { in: ids }, isActive: true, overQuota: false }, _count: { _all: true } });
      impact.productsHidden = sumExcess(groups, newMax);
    }

    // Personal: sin el interruptor nadie del equipo entra al panel; con un tope menor entran solo los activos más antiguos
    // hasta el tope y el resto queda en pausa (assertStaffPlan en requireVendorAccess.js). Solo cuentan los activos.
    if (before.allowStaffUsers && !next.allowStaffUsers) {
      impact.staffWithoutAccess = await prisma.vendorStaff.count({ where: { vendorId: { in: ids }, isActive: true } });
    } else if (next.allowStaffUsers && next.maxStaffUsers != null && (archive || capOf(before, "allowStaffUsers", "maxStaffUsers") !== capOf(next, "allowStaffUsers", "maxStaffUsers"))) {
      const groups = await prisma.vendorStaff.groupBy({ by: ["vendorId"], where: { vendorId: { in: ids }, isActive: true }, _count: { _all: true } });
      impact.staffOverLimit = sumExcess(groups, next.maxStaffUsers);
    }

    // Mesas con QR: lo mismo que el personal.
    if (before.allowQrTables && !next.allowQrTables) {
      impact.tablesDisabled = await prisma.table.count({ where: { vendorId: { in: ids }, deletedAt: null } });
    } else if (next.allowQrTables && next.maxTables != null && (archive || capOf(before, "allowQrTables", "maxTables") !== capOf(next, "allowQrTables", "maxTables"))) {
      const groups = await prisma.table.groupBy({ by: ["vendorId"], where: { vendorId: { in: ids }, deletedAt: null }, _count: { _all: true } });
      impact.tablesOverLimit = sumExcess(groups, next.maxTables);
    }

    // Ofertas de tienda: lo que apagaría recalcStoreOffersForPlan con los valores nuevos (las más viejas primero).
    const newOffers = offersCap(next);
    if (newOffers !== null && (archive || newOffers !== offersCap(before))) {
      const groups = await prisma.storeOffer.groupBy({ by: ["vendorId"], where: { vendorId: { in: ids }, active: true }, _count: { _all: true } });
      impact.storeOffersTurnedOff = sumExcess(groups, newOffers);
    }

    if (before.allowDiscountCodes && !next.allowDiscountCodes) {
      impact.discountCodesBlocked = await prisma.discountCode.count({ where: { vendorId: { in: ids }, active: true } });
    }

    // Tarjeta: al archivar se dejan de renovar todas (la suscripción de Stripe lleva el plan archivado y su precio); al pasar a
    // gratis o por WhatsApp también. Si solo cambia el precio en USD, Stripe sigue cobrando el precio con que se creó.
    const withCard = vendors.filter((v) => v.stripeSubscriptionId).length;
    if (archive || (isPaidConfig(before) && !isPaidConfig(next))) impact.cardSubscriptionsCancelled = withCard;
    else if (isPaidConfig(next) && Number(next.priceUsd) !== Number(before.priceUsd)) impact.cardSubscriptionsOldPrice = withCard;

    // Cobro: tiendas que empiezan a pagar algo que hoy no pagan. Las que ya tienen tiempo pagado lo conservan (ver
    // keepPaidTimeWhere): al archivar hacia el plan por defecto también, porque se les devuelve la fecha tras la baja.
    if (billedWithoutBadge(next) && !billedWithoutBadge(before)) {
      const entering = vendors.filter((v) => !v.isBlocked && !v.billingNoticeStage);
      impact.vendorsToBill = entering.length;
      impact.paidTimeKept = entering.filter(paidAhead).length;
    } else if (!archive && next.grantsBadge && isPaidConfig(next) && !isPaidConfig(before)) {
      // Solo pagan en su renovación las verificadas con fecha de pago; las que no la tienen (activadas a mano, o de cuando
      // el plan era gratis) no tienen renovación que les cobre.
      const verified = vendors.filter((v) => v.verificationStatus === "VERIFIED");
      impact.vendorsToBill = verified.filter((v) => v.nextPaymentDueDate).length;
      impact.verifiedWithoutDueDate = verified.length - impact.vendorsToBill;
    }

    // Pasa a gratis: las tiendas verificadas no tienen nada que renovar, así que se les quita la fecha de pago (si no,
    // verificationPayment.job.js las daría por impagas al llegar esa fecha y las bajaría al plan por defecto). Las que
    // están en su prueba gratis se dejan como están.
    if (!archive && !before.isFree && next.isFree) {
      impact.paymentDatesCleared = vendors.filter((v) => v.verificationStatus === "VERIFIED" && v.nextPaymentDueDate && !inRunningTrial(v)).length;
    }
    // Pasa a WhatsApp: sus renovaciones ya no se pagan en línea; el equipo registra cada pago a mano, como en cualquier
    // plan por WhatsApp.
    if (!archive && isPaidConfig(before) && next.contactOnly) {
      impact.manualRenewals = vendors.filter((v) => v.verificationStatus === "VERIFIED" && paidAhead(v)).length;
    }

    // Funciones guardadas en la tienda (ver whatsappOnWhere / privateOnWhere).
    if ((archive || before.allowWhatsappOrders) && !next.allowWhatsappOrders) {
      impact.whatsappOrdersTurnedOff = vendors.filter((v) => v.orderDestination && v.orderDestination !== "PANEL").length;
    }
    if ((archive || before.allowPublicProfile) && !next.allowPublicProfile) {
      impact.privateStoresMadePublic = vendors.filter((v) => v.isPrivate && !v.partnerId).length;
    }

    // Insignia.
    if ((archive || before.grantsBadge) && !next.grantsBadge) {
      impact.vendorsLosingBadge = vendors.filter((v) => v.verificationStatus === "VERIFIED").length;
    }
    // Un plan con insignia sin estar verificada no tiene sus funciones: reconcilePlanVerification (revisión diaria) pasa esas
    // tiendas al plan por defecto, salvo las que están en su prueba gratis.
    if (next.grantsBadge && !next.isDefault && (archive || !before.grantsBadge)) {
      impact.vendorsToDefault = vendors.filter((v) => v.verificationStatus !== "VERIFIED" && !v.trialEndsAt).length;
    }
    // Al archivar hacia el plan por defecto se aplica la baja de plan completa (applyPlanDowngrade): termina la prueba gratis.
    if (archive && moveTo.isDefault) impact.trialsEnded = vendors.filter((v) => v.trialEndsAt && v.trialEndsAt > now).length;

    const n = impact;
    if (n.productsHidden) msg.push(`${plural(n.productsHidden, "producto quedará oculto", "productos quedarán ocultos")} al público. Las tiendas los siguen viendo en su panel como "Fuera del cupo".`);
    if (n.staffWithoutAccess) msg.push(`${plural(n.staffWithoutAccess, "usuario activo del equipo dejará", "usuarios activos del equipo dejarán")} de poder entrar al panel de su tienda.`);
    if (n.staffOverLimit) msg.push(`${plural(n.staffOverLimit, "usuario activo del equipo pasa", "usuarios activos del equipo pasan")} del nuevo tope: quedan en pausa (no entran al panel) hasta que la tienda desactive a alguien o cambie de plan.`);
    if (n.tablesDisabled) msg.push(`${plural(n.tablesDisabled, "mesa con QR dejará", "mesas con QR dejarán")} de aceptar pedidos.`);
    if (n.tablesOverLimit) msg.push(`${plural(n.tablesOverLimit, "mesa pasa", "mesas pasan")} del nuevo tope: siguen funcionando, pero esas tiendas no podrán crear más.`);
    if (n.storeOffersTurnedOff) msg.push(`${plural(n.storeOffersTurnedOff, "oferta de tienda encendida se apagará", "ofertas de tienda encendidas se apagarán")} (las más viejas primero).`);
    if (n.discountCodesBlocked) msg.push(`${plural(n.discountCodesBlocked, "código de descuento activo dejará", "códigos de descuento activos dejarán")} de aplicarse en el carrito. Se conservan por si el plan los vuelve a incluir.`);
    if (n.cardSubscriptionsOldPrice) msg.push(`${plural(n.cardSubscriptionsOldPrice, "tienda paga", "tiendas pagan")} con tarjeta: Stripe les sigue cobrando el precio anterior hasta que cambien de suscripción.`);
    if (n.cardSubscriptionsCancelled) {
      const subs = plural(n.cardSubscriptionsCancelled, "suscripción con tarjeta dejará", "suscripciones con tarjeta dejarán");
      msg.push(
        archive && moveTo.isDefault
          ? // Hacia el plan por defecto la baja es inmediata (applyPlanDowngrade): el plan anterior termina hoy.
            `${subs} de renovarse y su plan termina hoy: pasan al plan ${moveTo.displayName} y no se les vuelve a cobrar el plan anterior.`
          : archive
            ? `${subs} de renovarse. Cuando venza lo que ya pagaron, esas tiendas pagan el plan ${moveTo.displayName} desde Suscripción.`
            : `${subs} de renovarse: no se les volverá a cobrar este plan.`
      );
    }
    if (n.vendorsToBill) {
      if (billedWithoutBadge(next)) {
        const fresh = n.vendorsToBill - n.paidTimeKept;
        if (fresh) msg.push(`${plural(fresh, "tienda entrará", "tiendas entrarán")} al cobro mensual del plan ${name}: reciben el aviso con su fecha de cobro, contada desde su día de registro.`);
        if (n.paidTimeKept) {
          msg.push(`${plural(n.paidTimeKept, "tienda ya tiene", "tiendas ya tienen")} tiempo pagado: se respeta, y su primer cobro del plan ${name} llega cuando se acabe, con el aviso 7 días antes.`);
        }
      } else {
        msg.push(`${plural(n.vendorsToBill, "tienda verificada pagará", "tiendas verificadas pagarán")} el precio del plan en su próxima renovación.`);
      }
    }
    if (n.verifiedWithoutDueDate) {
      msg.push(`${plural(n.verifiedWithoutDueDate, "tienda verificada no tiene", "tiendas verificadas no tienen")} fecha de pago: siguen con el plan sin cobro hasta que el equipo registre su pago.`);
    }
    if (n.paymentDatesCleared) {
      msg.push(`${plural(n.paymentDatesCleared, "tienda verificada deja", "tiendas verificadas dejan")} de tener fecha de pago: conservan la insignia y el plan sin vencimiento mientras sea gratis.`);
    }
    if (n.manualRenewals) {
      msg.push(`${plural(n.manualRenewals, "tienda verificada tiene", "tiendas verificadas tienen")} tiempo pagado. Cuando se les acabe, el equipo registra su pago a mano; si nadie lo registra, bajan al plan ${defaultName} como cualquier pago vencido.`);
    }
    if (n.whatsappOrdersTurnedOff) {
      msg.push(`${plural(n.whatsappOrdersTurnedOff, "tienda deja", "tiendas dejan")} de ofrecer el botón de WhatsApp: sus pedidos entran solo por el panel.`);
    }
    if (n.privateStoresMadePublic) {
      msg.push(
        n.privateStoresMadePublic === 1
          ? "1 tienda privada pasa a ser pública: vuelve a salir en búsquedas y listados."
          : `${n.privateStoresMadePublic} tiendas privadas pasan a ser públicas: vuelven a salir en búsquedas y listados.`
      );
    }
    if (n.vendorsLosingBadge) {
      msg.push(
        archive && moveTo.isDefault
          ? `${plural(n.vendorsLosingBadge, "tienda perderá", "tiendas perderán")} la insignia de verificada. Conservan sus documentos aprobados para volver a un plan con insignia.`
          : `${plural(n.vendorsLosingBadge, "tienda verificada conserva", "tiendas verificadas conservan")} hoy su insignia, aunque el plan ${name} no la da. Las tiendas nuevas del plan no la tendrán.`
      );
    }
    if (n.vendorsToDefault) msg.push(`${plural(n.vendorsToDefault, "tienda sin verificar pasará", "tiendas sin verificar pasarán")} al plan ${defaultName} en la revisión diaria, porque el plan ${name} exige la insignia.`);
    if (n.trialsEnded) msg.push(`${plural(n.trialsEnded, "tienda termina", "tiendas terminan")} su prueba gratis en este momento.`);
  } else {
    msg.push(archive ? "Ninguna tienda usa este plan: se archiva sin mover tiendas." : "Ninguna tienda usa este plan ahora.");
  }

  // Lo que cambia para todo el plan aunque hoy no tenga tiendas.
  if (impact.badgeChange === "off") {
    const catalog = await getPlanFeatureCatalog();
    const needBadge = planFeatureList(next, catalog).filter((f) => f.requiresBadge && f.enabled).map((f) => f.label);
    msg.push(
      `El plan dejará de dar la insignia de verificada: se cobrará cada mes sin pasar por la verificación de documentos.` +
        (needBadge.length ? ` Estas funciones exigen la insignia y no funcionarán en tiendas sin verificar: ${needBadge.join(", ")}.` : "")
    );
  } else if (impact.badgeChange === "on") {
    msg.push("El plan dará la insignia de verificada: para usarlo, cada tienda tendrá que verificar sus documentos y pagar en la verificación.");
  }
  if (!archive && isPaidConfig(before) && !isPaidConfig(next)) {
    msg.push(next.isFree ? "El plan pasará a ser gratis: nadie lo paga mientras siga así." : "El plan pasará a contratarse por WhatsApp: no se podrá pagar en línea ni renovar desde Suscripción.");
  }
  if (setDefault) msg.push(`Las tiendas nuevas se registrarán en el plan ${name} y las que dejen de pagar bajarán a él.`);
  if (setTrial) msg.push(`La prueba gratis pasará a darse en el plan ${name}. Las pruebas que ya corren siguen igual.`);
  return impact;
}

// --- Stripe ---------------------------------------------------------------------------------------------------------------
// Deja de renovar la suscripción con tarjeta de una tienda y la desvincula. Primero Stripe y después la base: si Stripe
// falla, la tienda queda como estaba (el admin lo ve en la respuesta) en vez de quedar una suscripción cobrando sin dueño.
// Se desvincula a propósito: cuando Stripe la termine al final del periodo, su aviso (customer.subscription.deleted) ya no
// encuentra la tienda y no la baja al plan por defecto, y una renovación nunca la devuelve al plan anterior (la suscripción
// lleva ese plan en sus datos). Solo se cuenta como hecho si la tienda seguía con esa misma suscripción.
async function stopCardRenewal(vendor) {
  try {
    await setCardSubscriptionCancelAtPeriodEnd(vendor.stripeSubscriptionId, true);
  } catch (err) {
    console.error(`[planes] no se pudo detener la renovación con tarjeta de ${vendor.id}:`, err?.message);
    return false;
  }
  await prisma.vendor.updateMany({ where: { id: vendor.id, stripeSubscriptionId: vendor.stripeSubscriptionId }, data: { stripeSubscriptionId: null, cancelAtPeriodEnd: false } });
  return true;
}

async function stopCardRenewalsForPlan(planType) {
  const withCard = await prisma.vendor.findMany({ where: { planType, deletedAt: null, stripeSubscriptionId: { not: null } }, select: { id: true, companyName: true, stripeSubscriptionId: true } });
  const failed = [];
  for (const v of withCard) if (!(await stopCardRenewal(v))) failed.push(v.companyName);
  return { stopped: withCard.length - failed.length, failed };
}

function stripeSummary({ stopped, failed }) {
  if (!stopped && !failed.length) return null;
  return {
    stopped,
    failed,
    message: failed.length
      ? `No se pudo detener la renovación con tarjeta de ${failed.length === 1 ? "esta tienda" : "estas tiendas"}: ${failed.join(", ")}. Revísalo en Stripe o prueba de nuevo.`
      : null,
  };
}

// --- Estadísticas por plan ------------------------------------------------------------------------------------------------
const emptyMoney = () => ({ CUP: 0, USD: 0 });
const addMoney = (obj, currency, amount) => {
  const cur = String(currency || "").toUpperCase();
  if (!cur || !(amount > 0)) return false;
  obj[cur] = round2((obj[cur] ?? 0) + amount);
  return true;
};

function emptyStats(config) {
  return {
    planType: config.planType,
    displayName: config.displayName,
    archived: !!config.archivedAt,
    vendors: 0,
    upToDate: 0,
    inTrial: 0,
    overdue: 0,
    suspendedForPayment: 0,
    manualGrants: 0,
    newInPeriod: 0,
    leftInPeriod: 0,
    revenue: emptyMoney(),
    mrr: emptyMoney(),
    arpu: { CUP: null, USD: null },
    payingByCurrency: { CUP: 0, USD: 0 },
  };
}

const arpuOf = (mrr, paying) => Object.fromEntries(Object.keys(mrr).map((cur) => [cur, paying[cur] ? round2(mrr[cur] / paying[cur]) : null]));

// Cifras de cada plan entre `from` y `to` (ver el contrato: definiciones de cada número). Todo sobre tiendas no eliminadas,
// salvo los ingresos del periodo: son dinero recibido, así que cuentan también los pagos de tiendas eliminadas después
// (el mismo criterio que confirmedRevenueBetween del dashboard, para que las dos pantallas den la misma cifra).
// Nunca se convierte CUP a USD ni al revés: cada moneda va por separado.
// `onlyPlanType`: solo las cifras de las tiendas de ese plan y sin las del periodo (lo que necesita la fila de un plan en
// las respuestas de escritura), para no recalcular todos los planes en cada guardado.
async function computePlanStats(from, to, { onlyPlanType = null } = {}) {
  const now = new Date();
  const configs = await getAllPlanConfigs({ includeArchived: true });
  const configBy = new Map(configs.map((c) => [c.planType, c]));
  const stats = new Map(configs.map((c) => [c.planType, emptyStats(c)]));
  const statsOf = (key) => {
    if (!stats.has(key)) stats.set(key, emptyStats({ planType: key, displayName: key, archivedAt: null }));
    return stats.get(key);
  };

  // Las consultas por tienda filtran por la relación (vendor: {...}) y no con vendorId: { in: ids }: con miles de tiendas
  // esa lista de ids pasa del tope de parámetros de Postgres.
  const vendorScope = { deletedAt: null, ...(onlyPlanType ? { planType: onlyPlanType } : {}) };
  const vendors = await prisma.vendor.findMany({
    where: vendorScope,
    select: { id: true, planType: true, status: true, trialEndsAt: true, verificationStatus: true, nextPaymentDueDate: true, billingNoticeStage: true, billingSuspendedAt: true },
  });

  const none = Promise.resolve([]);
  const [lastChanges, lastSubPayments, verifPayments, periodSubs, periodVerifs, periodChanges, firstChange] = await Promise.all([
    prisma.vendorPlanChange.findMany({ where: { vendor: vendorScope }, orderBy: { createdAt: "desc" }, distinct: ["vendorId"], select: { vendorId: true, reason: true, toPlan: true, createdAt: true } }),
    prisma.subscriptionPayment.findMany({ where: { vendor: vendorScope, confirmedAt: { not: null } }, orderBy: { confirmedAt: "desc" }, distinct: ["vendorId"], select: { vendorId: true, confirmedAt: true, amount: true, months: true, currency: true } }),
    // El pago de verificación más reciente de cada tienda (sin orden, Postgres devolvía uno cualquiera de sus pagos).
    prisma.verificationRequest.findMany({ where: { vendor: vendorScope, paymentConfirmedAt: { not: null } }, orderBy: { paymentConfirmedAt: "desc" }, distinct: ["vendorId"], select: { vendorId: true, paymentConfirmedAt: true, paymentAmount: true, paymentMonths: true, paymentCurrency: true } }),
    onlyPlanType ? none : prisma.subscriptionPayment.findMany({ where: { confirmedAt: { gte: from, lte: to } }, select: { vendorId: true, planType: true, amount: true, currency: true, confirmedAt: true } }),
    onlyPlanType ? none : prisma.verificationRequest.findMany({ where: { paymentConfirmedAt: { gte: from, lte: to } }, select: { vendorId: true, paymentPlanType: true, paymentAmount: true, paymentCurrency: true, paymentConfirmedAt: true } }),
    onlyPlanType ? none : prisma.vendorPlanChange.findMany({ where: { createdAt: { gte: from, lte: to }, vendor: { deletedAt: null } }, select: { fromPlan: true, toPlan: true } }),
    onlyPlanType ? Promise.resolve(null) : prisma.vendorPlanChange.findFirst({ orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
  ]);
  const lastChangeBy = new Map(lastChanges.map((c) => [c.vendorId, c]));
  const lastSubBy = new Map(lastSubPayments.map((p) => [p.vendorId, p]));
  const verifBy = new Map(verifPayments.map((p) => [p.vendorId, p]));
  const TWO_MIN = 2 * 60 * 1000;

  for (const v of vendors) {
    const c = configBy.get(v.planType);
    const s = statsOf(v.planType);
    s.vendors++;
    const inTrial = !!v.trialEndsAt && v.trialEndsAt > now;
    if (inTrial) s.inTrial++;
    if (v.billingNoticeStage === "due" || v.billingNoticeStage === "after") s.overdue++;
    if (v.billingSuspendedAt || v.verificationStatus === "PAYMENT_FAILED" || v.verificationStatus === "SUSPENDED") s.suspendedForPayment++;

    // Al día: en un plan gratis, toda tienda no suspendida; en uno por WhatsApp, también las que el equipo activó sin fecha
    // de vencimiento; en los demás, con tiempo pagado (y verificada si el plan da la insignia).
    let upToDate = false;
    if (!inTrial && c) {
      const due = v.nextPaymentDueDate ? new Date(v.nextPaymentDueDate) : null;
      const verifiedOk = v.verificationStatus === "VERIFIED" || !c.grantsBadge;
      if (c.isFree) upToDate = v.status !== "SUSPENDED" && !v.billingSuspendedAt;
      else if (c.contactOnly) upToDate = verifiedOk && (!due || due > now);
      else upToDate = verifiedOk && !!due && due > now;
    }
    if (upToDate) s.upToDate++;

    const lastSub = lastSubBy.get(v.id);
    const verif = verifBy.get(v.id);
    // Activada a mano: su último cambio de plan fue un regalo del admin y no pagó nada después.
    const change = lastChangeBy.get(v.id);
    if (change && change.reason === "admin_grant" && change.toPlan === v.planType) {
      const paidAfter = (lastSub && lastSub.confirmedAt > change.createdAt) || (verif && verif.paymentConfirmedAt > change.createdAt);
      if (!paidAfter) s.manualGrants++;
    }

    // Ingreso mensual: el último pago confirmado de cada tienda al día de un plan que no es gratis, repartido por sus meses.
    // El mismo criterio que monthlyRevenueOf del dashboard: el más reciente de las dos tablas (a menos de 2 minutos gana
    // SubscriptionPayment, es el mismo pago manual anotado en las dos); un pago sin monto (activación a mano) no suma.
    if (upToDate && c && !c.isFree) {
      const fromSub = lastSub ? { at: lastSub.confirmedAt, amount: Number(lastSub.amount ?? 0), months: lastSub.months, currency: lastSub.currency } : null;
      const fromVerif = verif ? { at: verif.paymentConfirmedAt, amount: Number(verif.paymentAmount ?? 0), months: verif.paymentMonths, currency: verif.paymentCurrency } : null;
      const last = fromSub && (!fromVerif || fromVerif.at.getTime() <= fromSub.at.getTime() + TWO_MIN) ? fromSub : fromVerif;
      if (last && last.amount && addMoney(s.mrr, last.currency, last.amount / Math.max(1, last.months ?? 1))) {
        const cur = String(last.currency).toUpperCase();
        s.payingByCurrency[cur] = (s.payingByCurrency[cur] ?? 0) + 1;
      }
    }
  }

  // Ingresos del periodo sin doble cuenta: el pago manual de una renovación se anota en las dos tablas casi a la vez, así
  // que un pago de verificación con un SubscriptionPayment de la misma tienda a menos de 2 minutos ya está contado.
  const verifVendorIds = [...new Set(periodVerifs.map((p) => p.vendorId))];
  const nearSubs = verifVendorIds.length
    ? await prisma.subscriptionPayment.findMany({
        where: { vendorId: { in: verifVendorIds }, confirmedAt: { gte: new Date(from.getTime() - TWO_MIN), lte: new Date(to.getTime() + TWO_MIN) } },
        select: { vendorId: true, confirmedAt: true },
      })
    : [];
  for (const p of periodSubs) addMoney(statsOf(paymentPlanOf(p.planType)).revenue, p.currency, Number(p.amount ?? 0));
  for (const p of periodVerifs) {
    const twin = nearSubs.some((sp) => sp.vendorId === p.vendorId && Math.abs(sp.confirmedAt - p.paymentConfirmedAt) < TWO_MIN);
    if (!twin) addMoney(statsOf(paymentPlanOf(p.paymentPlanType)).revenue, p.paymentCurrency, Number(p.paymentAmount ?? 0));
  }
  for (const ch of periodChanges) {
    statsOf(ch.toPlan).newInPeriod++;
    if (ch.fromPlan) statsOf(ch.fromPlan).leftInPeriod++;
  }

  const plans = [];
  for (const s of stats.values()) {
    s.arpu = arpuOf(s.mrr, s.payingByCurrency);
    const hasData = s.vendors || s.newInPeriod || s.leftInPeriod || Object.values(s.revenue).some((x) => x > 0);
    // Los archivados solo salen si tienen algo en el periodo (tiendas, movimientos o ingresos).
    if (!s.archived || hasData) plans.push(s);
  }
  const order = new Map(configs.map((c, i) => [c.planType, i]));
  plans.sort((a, b) => (order.get(a.planType) ?? 999) - (order.get(b.planType) ?? 999));

  const totals = { vendors: 0, upToDate: 0, inTrial: 0, overdue: 0, suspendedForPayment: 0, manualGrants: 0, newInPeriod: 0, leftInPeriod: 0, revenue: emptyMoney(), mrr: emptyMoney(), payingByCurrency: { CUP: 0, USD: 0 } };
  for (const s of plans) {
    for (const k of ["vendors", "upToDate", "inTrial", "overdue", "suspendedForPayment", "manualGrants", "newInPeriod", "leftInPeriod"]) totals[k] += s[k];
    for (const [cur, x] of Object.entries(s.revenue)) addMoney(totals.revenue, cur, x);
    for (const [cur, x] of Object.entries(s.mrr)) addMoney(totals.mrr, cur, x);
    for (const [cur, x] of Object.entries(s.payingByCurrency)) totals.payingByCurrency[cur] = (totals.payingByCurrency[cur] ?? 0) + x;
  }
  totals.arpu = arpuOf(totals.mrr, totals.payingByCurrency);
  // No hay historial de cambios de plan antes de los planes dinámicos: la pantalla dice "desde" esta fecha en altas y bajas.
  return { from: from.toISOString(), to: to.toISOString(), historySince: firstChange?.createdAt?.toISOString() ?? null, plans, totals };
}

// Los días del periodo son los del negocio (zona horaria del sitio, la misma del dashboard y de Pedidos), no los de UTC: en
// Cuba un pago de las 20:00 a las 23:59 es de ese día, no del siguiente. `from` = 00:00 de su día en esa zona; `to` = el
// último milisegundo de su día (justo antes de las 00:00 del día siguiente), así `lte: to` incluye todo el día.
// Se ancla a las 12:00 UTC del día, como monthBoundsInTimezone (admin.controller.js): sirve para cualquier zona de UTC-11
// a UTC+11.
const ymdParts = (s) => s.split("-").map(Number);
function dayStartInTz([y, m, d], tz, plusDays = 0) {
  return startOfDayInTimezone(new Date(Date.UTC(y, m - 1, d + plusDays, 12)), tz);
}
function rangeInTz(fromParts, toParts, tz) {
  return { from: dayStartInTz(fromParts, tz), to: new Date(dayStartInTz(toParts, tz, 1).getTime() - 1) };
}
const todayParts = (tz) => ymdParts(new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(new Date()));

// Últimos 30 días (hoy incluido) hasta el final de hoy en la zona del sitio, lo mismo que GET /admin/plan-stats sin fechas.
async function defaultRange() {
  const tz = await getSiteTimezone();
  const today = todayParts(tz);
  const [y, m, d] = today;
  return rangeInTz([y, m, d - 29], today, tz);
}

// --- Fila completa de un plan (GET y respuestas de escritura) --------------------------------------------------------------
function planRow(config, catalog, stats) {
  return {
    ...config,
    monthDiscounts: normalizeMonthDiscounts(config.monthDiscounts),
    customFeatures: customFeaturesOf(config),
    featureValues: planFeatureList(config, catalog).map(({ key, kind, enabled, limit }) => ({ key, kind, enabled, limit })),
    includes: buildPlanIncludes(config),
    stats: stats
      ? { vendors: stats.vendors, payingUpToDate: stats.upToDate, inTrial: stats.inTrial, mrr: stats.mrr }
      : { vendors: 0, payingUpToDate: 0, inTrial: 0, mrr: emptyMoney() },
  };
}

async function fullPlanRow(planType) {
  const config = await prisma.planConfig.findUnique({ where: { planType } });
  if (!config) return null;
  // La fila solo usa las cifras de sus tiendas (no las del periodo): se calculan solo para este plan.
  const { from, to } = await defaultRange();
  const [catalog, stats] = await Promise.all([getPlanFeatureCatalog(), computePlanStats(from, to, { onlyPlanType: planType })]);
  return planRow(config, catalog, stats.plans.find((s) => s.planType === planType));
}

// --- Rutas: planes --------------------------------------------------------------------------------------------------------

// GET /admin/plans[?archived=1]
export async function listPlans(req, res) {
  const withArchived = req.query.archived === "1" || req.query.archived === "true";
  const { from, to } = await defaultRange();
  const [rows, catalog, stats] = await Promise.all([
    prisma.planConfig.findMany({ orderBy: [{ sortOrder: "asc" }, { planType: "asc" }] }),
    getPlanFeatureCatalog(),
    computePlanStats(from, to),
  ]);
  const statsBy = new Map(stats.plans.map((s) => [s.planType, s]));
  const visible = rows.filter((r) => withArchived || !r.archivedAt);
  res.json({ plans: visible.map((r) => planRow(r, catalog, statsBy.get(r.planType))), archivedCount: rows.filter((r) => r.archivedAt).length });
}

const createSchema = z.object({
  displayName: z.string().trim().min(1, "Escribe el nombre del plan.").max(40, "El nombre admite hasta 40 caracteres."),
  copyFrom: z.string().regex(PLAN_KEY_PATTERN, "El plan de origen no existe.").optional().nullable(),
});

// Columnas que no se copian del plan de origen: identidad, papel y estado propio del plan nuevo.
const NOT_COPIED = new Set(["id", "planType", "displayName", "isPublic", "highlighted", "isDefault", "isTrialPlan", "archivedAt", "createdAt", "updatedAt"]);

// POST /admin/plans: nace oculto, como copia de otro plan (por defecto, del plan por defecto: así nunca nace con todo
// encendido e ilimitado, que son los valores por defecto del esquema). El admin lo revisa y lo publica después.
export async function createPlan(req, res) {
  const { displayName, copyFrom } = createSchema.parse(req.body ?? {});
  await assertNameFree(displayName);
  const source = copyFrom
    ? await prisma.planConfig.findUnique({ where: { planType: copyFrom } })
    : await prisma.planConfig.findFirst({ where: { isDefault: true, archivedAt: null } });
  if (!source) throw new AppError("El plan de origen no existe.", 400);
  invalidatePlanConfigCache(); // la clave nueva se compara contra la lista más reciente
  const planType = await planKeyFromName(displayName);
  const max = await prisma.planConfig.aggregate({ _max: { sortOrder: true } });
  const copied = Object.fromEntries(Object.entries(source).filter(([k]) => !NOT_COPIED.has(k)));
  let created;
  try {
    created = await prisma.planConfig.create({
      data: {
        ...copied,
        monthDiscounts: source.monthDiscounts ?? [],
        customFeatures: customFeaturesOf(source),
        planType,
        displayName,
        isPublic: false,
        highlighted: false,
        isDefault: false,
        isTrialPlan: false,
        sortOrder: (max._max.sortOrder ?? 0) + 1,
      },
    });
  } catch (err) {
    throw mapPrismaError(err);
  }
  afterPlanWrite();
  logActivity({ actorId: req.user?.id ?? null, actorRole: "ADMIN", action: "PLAN_CREATE", description: `Creó el plan ${displayName} (copia de ${source.displayName}).`, meta: { planType, copyFrom: source.planType } });
  res.status(201).json({ plan: await fullPlanRow(created.planType) });
}

// Guarda un cambio de plan y aplica sus efectos sobre las tiendas. Lo usan PATCH /admin/plans/:key y la ruta vieja PATCH
// /admin/plan-configs. Los cambios con efectos sobre el cobro o la insignia de tiendas reales piden confirmación explícita:
// sin ella responde 409 con el impacto (el mismo de la vista previa) para que la pantalla lo muestre y vuelva a mandar el
// cambio con la confirmación.
//  - grantsBadge: confirmBadgeImpact (cambia el cobro, la verificación y las funciones que exigen insignia).
//  - pasar a gratis o por WhatsApp un plan con tiendas: confirmBillingImpact (deja de renovar sus tarjetas).
export async function applyPlanUpdate(planType, input, { actorId = null } = {}) {
  const before = await prisma.planConfig.findUnique({ where: { planType } });
  if (!before) throw new AppError("Plan no encontrado.", 404);
  if (before.archivedAt) throw new AppError("Este plan está archivado. Restáuralo antes de editarlo.", 409);
  const { data, next, setDefault, setTrial, confirm } = await buildPlanPatch(before, input);

  const badgeChanged = next.grantsBadge !== before.grantsBadge;
  const becomesUnpaid = isPaidConfig(before) && !isPaidConfig(next);
  const vendorCount = await prisma.vendor.count({ where: { planType, deletedAt: null } });
  const confirmFields = [];
  if (badgeChanged && !confirm.badge) confirmFields.push("confirmBadgeImpact");
  if (becomesUnpaid && vendorCount > 0 && !confirm.billing) confirmFields.push("confirmBillingImpact");
  if (confirmFields.length) {
    const impact = await computeImpact(before, next, { setDefault, setTrial });
    throw new AppError("Este cambio afecta a las tiendas del plan. Revisa el impacto y confírmalo para guardarlo.", 409, {
      code: "PLAN_IMPACT_CONFIRM_REQUIRED",
      confirmFields,
      impact,
    });
  }

  let updated;
  try {
    updated = await prisma.$transaction(async (tx) => {
      // Un solo plan destacado ("el más elegido") a la vez.
      if (data.highlighted === true) await tx.planConfig.updateMany({ where: { planType: { not: planType } }, data: { highlighted: false } });
      // Las banderas de papel se mueven apagando primero la del plan que la tenía: los índices únicos parciales de la base
      // no dejan que haya dos a la vez ni por un instante.
      if (setDefault) await tx.planConfig.updateMany({ where: { isDefault: true, planType: { not: planType } }, data: { isDefault: false } });
      if (setTrial) await tx.planConfig.updateMany({ where: { isTrialPlan: true, planType: { not: planType } }, data: { isTrialPlan: false } });
      const row = await tx.planConfig.update({ where: { planType }, data: { ...data, ...(setDefault ? { isDefault: true } : {}), ...(setTrial ? { isTrialPlan: true } : {}) } });
      // Entra al cobro sin verificación: las tiendas con tiempo pagado lo conservan (ver keepPaidTimeWhere).
      if (billedWithoutBadge(row) && !billedWithoutBadge(before)) {
        await tx.vendor.updateMany({ where: keepPaidTimeWhere(planType), data: KEEP_PAID_TIME_DATA });
      }
      // Pasa a gratis: sin nada que renovar, la fecha de pago de las verificadas solo serviría para que
      // verificationPayment.job.js las diera por impagas y las bajara al plan por defecto. Siguen VERIFIED (isPremiumActive
      // no mira la fecha). Las que están en su prueba gratis se dejan: su fecha la resuelve trialExpiry.job.js.
      if (row.isFree && !before.isFree) {
        const now = new Date();
        await tx.vendor.updateMany({
          where: { planType, verificationStatus: "VERIFIED", nextPaymentDueDate: { not: null }, OR: [{ trialEndsAt: null }, { trialEndsAt: { lte: now } }] },
          data: { nextPaymentDueDate: null, cancelAtPeriodEnd: false },
        });
      }
      return row;
    });
  } catch (err) {
    throw mapPrismaError(err);
  }
  afterPlanWrite();

  // Cobro sin verificación (planBilling.service.js): si el plan acaba de entrar, sus tiendas reciben el primer aviso ya; si
  // acaba de salir, una pasada completa les quita el cobro pendiente y levanta la suspensión por falta de pago.
  const wasBilled = billedWithoutBadge(before);
  const isBilled = billedWithoutBadge(updated);
  if (wasBilled !== isBilled) {
    const billing = await import("../services/planBilling.service.js");
    const run = isBilled ? billing.startBillingForFreePlan(planType) : billing.runPlanBilling();
    void run.catch((err) => console.error("[planes] no se pudo actualizar el cobro del plan:", err?.message));
  }
  // allowPanelOrders ya no se usa: solo allowWhatsappOrders decide si las tiendas del plan pueden ofrecer el botón de
  // WhatsApp; si se apaga, las que lo tenían pasan a solo panel.
  if (data.allowWhatsappOrders === false) {
    await prisma.vendor.updateMany({ where: whatsappOnWhere(planType), data: { orderDestination: "PANEL" } });
  }
  // Lo mismo con el perfil privado: si el plan ya no lo incluye, sus tiendas privadas vuelven a ser públicas (antes solo se
  // recortaba cuando la tienda guardaba su perfil, y hasta entonces seguía oculta).
  if (data.allowPublicProfile === false) {
    await prisma.vendor.updateMany({ where: privateOnWhere(planType), data: { isPrivate: false } });
  }
  // Al cambiar el cupo de productos se recalcula qué productos quedan a la vista en TODAS las tiendas del plan.
  if ("maxProducts" in data && (data.maxProducts ?? null) !== (before.maxProducts ?? null)) {
    const vendorIds = await prisma.vendor.findMany({ where: { planType }, select: { id: true } });
    for (const { id } of vendorIds) await recalcVendorProductQuota(id);
  }
  // Ofertas de tienda: si el plan deja de incluirlas (o los códigos que necesitan) o baja su tope, se apagan las que sobran.
  if (["allowStoreOffers", "allowDiscountCodes", "maxActiveStoreOffers"].some((k) => k in data)) {
    await recalcStoreOffersForPlan(planType);
  }
  // Gratis o por WhatsApp: sus tiendas no tienen nada que pagar en línea, así que sus tarjetas dejan de renovarse.
  const stripe = becomesUnpaid ? stripeSummary(await stopCardRenewalsForPlan(planType)) : null;

  const changed = Object.keys(data).filter((k) => JSON.stringify(data[k]) !== JSON.stringify(before[k]));
  if (setDefault) changed.push("isDefault");
  if (setTrial) changed.push("isTrialPlan");
  if (changed.length) {
    logActivity({
      actorId,
      actorRole: "ADMIN",
      action: "PLAN_CONFIG_UPDATE",
      description: `Cambió el plan ${updated.displayName}: ${changed.join(", ")}.`,
      meta: { planType, before: Object.fromEntries(changed.map((k) => [k, before[k] ?? null])), after: Object.fromEntries(changed.map((k) => [k, updated[k] ?? null])) },
    });
  }
  return { plan: await fullPlanRow(planType), ...(stripe ? { stripe } : {}) };
}

// PATCH /admin/plans/:key
export async function updatePlan(req, res) {
  const planType = keyFromParam(req.params.key);
  const input = planPatchSchema.parse(req.body ?? {});
  res.json(await applyPlanUpdate(planType, input, { actorId: req.user?.id ?? null }));
}

const archiveSchema = z.object({
  moveTo: z.string().regex(PLAN_KEY_PATTERN, "El plan destino no existe.").optional().nullable(),
});

async function archiveTarget(plan, moveTo) {
  if (!moveTo) return null;
  if (moveTo === plan.planType) throw new AppError("Elige un plan destino distinto del que archivas.", 400);
  const dest = await prisma.planConfig.findUnique({ where: { planType: moveTo } });
  if (!dest || dest.archivedAt) throw new AppError("El plan destino no existe o está archivado.", 400);
  return dest;
}

// Aviso a una tienda movida de plan al archivar el suyo. Va siempre a su campana (le cambian el plan sin que lo pida); el
// aviso al celular solo sale si el admin marcó "Avisar a la tienda" (X-Notify-Vendor), como cualquier acción del admin.
// La entrada de la campana se crea con el aviso automático apagado (el gancho de VendorNotification en lib/notify.js
// mandaría su propio push, con otro enlace): así llega un solo push, el de abajo, y solo si el admin lo pidió.
async function noticeMovedVendor(vendorId, fromPlan, toPlan, cardStopped) {
  const pushChosen = requestContext()?.notifyVendor === true;
  const title = `Tu tienda pasó al plan ${toPlan.displayName}`;
  const cardText = !cardStopped
    ? ""
    : toPlan.isDefault
      ? " Tu suscripción con tarjeta no se renovará: no se te volverá a cobrar el plan anterior."
      : " Tu suscripción con tarjeta no se renovará: cuando venza lo que pagaste, renueva desde Suscripción.";
  const body = `El plan ${fromPlan.displayName} dejó de ofrecerse y tu tienda pasó al plan ${toPlan.displayName}. Mira en Suscripción lo que incluye.${cardText}`;
  await runWithContext({ notifyVendor: false }, () =>
    prisma.vendorNotification.create({ data: { vendorId, type: "ADMIN_NOTICE", title, body: body.slice(0, 500) } })
  ).catch(() => {});
  if (pushChosen) void notifyVendor(vendorId, { category: "account", title, body, url: "/vendedor/verificacion", tag: `plan-archived-${vendorId}` }).catch(() => {});
}

// POST /admin/plans/:key/archive  { moveTo }
// Mueve todas las tiendas del plan al destino en una transacción (cada una con su VendorPlanChange) y archiva el plan. Después,
// tienda por tienda: deja de renovar su tarjeta (la suscripción lleva el plan archivado y su precio), aplica la baja de plan
// completa si el destino es el plan por defecto (applyPlanDowngrade: insignia, prueba, cupo y ofertas) o recalcula el cupo si
// es otro, y le avisa. Las tiendas eliminadas también se mueven (al destino o, si no hay ninguna viva, al plan por defecto)
// para que ninguna quede en un plan archivado si se restaura.
export async function archivePlan(req, res) {
  const planType = keyFromParam(req.params.key);
  const { moveTo } = archiveSchema.parse(req.body ?? {});
  const actorId = req.user?.id ?? null;
  const plan = await prisma.planConfig.findUnique({ where: { planType } });
  if (!plan) throw new AppError("Plan no encontrado.", 404);
  if (plan.archivedAt) throw new AppError("Ese plan ya está archivado.", 409);
  if (plan.isDefault) throw new AppError("Es el plan por defecto: elige antes otro plan por defecto.", 409);
  if (plan.isTrialPlan) throw new AppError("Es el plan de la prueba gratis: elige antes otro plan para la prueba.", 409);
  const dest = await archiveTarget(plan, moveTo);
  const live = await prisma.vendor.count({ where: { planType, deletedAt: null } });
  if (live > 0 && !dest) throw new AppError(`Este plan tiene ${plural(live, "tienda", "tiendas")}: elige a qué plan pasan.`, 400);
  const target = dest ?? (await prisma.planConfig.findFirst({ where: { isDefault: true, archivedAt: null } }));
  if (!target) throw new AppError("No hay un plan por defecto al que mover las tiendas.", 409);

  let moved;
  try {
    moved = await prisma.$transaction(
      async (tx) => {
        const list = await tx.vendor.findMany({ where: { planType }, select: { id: true, deletedAt: true, stripeSubscriptionId: true, nextPaymentDueDate: true } });
        if (list.length) {
          // Si el destino se cobra sin verificación, las tiendas con tiempo pagado lo conservan (ver keepPaidTimeWhere).
          // Se marcan antes de moverlas, en la misma transacción, para que la pasada horaria nunca las vea sin marcar.
          if (billedWithoutBadge(target)) await tx.vendor.updateMany({ where: keepPaidTimeWhere(planType), data: KEEP_PAID_TIME_DATA });
          await tx.vendor.updateMany({ where: { planType }, data: { planType: target.planType } });
          for (const v of list) await recordPlanChange(tx, { vendorId: v.id, fromPlan: planType, toPlan: target.planType, reason: "plan_archived", actorId });
        }
        await tx.planConfig.update({ where: { planType }, data: { archivedAt: new Date(), isPublic: false, highlighted: false } });
        return list;
      },
      { timeout: 60_000 }
    );
  } catch (err) {
    throw mapPrismaError(err);
  }
  afterPlanWrite();

  const liveMoved = moved.filter((v) => !v.deletedAt);
  const failedCard = [];
  const failedEffects = [];
  for (const v of liveMoved) {
    try {
      let cardStopped = false;
      // La tarjeta primero, con stopCardRenewal: solo desvincula la suscripción si Stripe confirma, y si falla el admin lo
      // ve en la respuesta. Antes, hacia el plan por defecto, applyPlanDowngrade la cancelaba tragándose el error y la
      // desvinculaba igual, y podía quedar una suscripción cobrando sin dueño sin que nadie se enterara.
      if (v.stripeSubscriptionId) {
        cardStopped = await stopCardRenewal(v);
        if (!cardStopped) failedCard.push(v.id);
      }
      if (target.isDefault) {
        // La misma baja de plan que usa el admin (quita la prueba y la insignia, recalcula ofertas; la tarjeta ya se
        // detuvo arriba, salvo si Stripe falló: entonces applyPlanDowngrade lo reintenta). Su aviso propio se apaga: la
        // tienda recibe el de abajo, que nombra el plan archivado y el nuevo. keepBillingCycle: la etapa de cobro se queda
        // (la marcó keepPaidTimeWhere o venía de otro plan cobrado) para devolverle su fecha justo abajo.
        await runWithContext({ notifyVendor: false }, () =>
          applyPlanDowngrade(v.id, { actorId, source: "ADMIN_ACTION", reason: `El plan ${plan.displayName} dejó de ofrecerse`, keepBillingCycle: true })
        );
        // applyPlanDowngrade borra la fecha de pago. Si el plan por defecto se cobra, la tienda que ya está en el ciclo de
        // cobro (la marcada en la transacción por tener tiempo pagado, ver keepPaidTimeWhere, o la que ya venía de otro plan
        // cobrado) recupera su fecha: sin ella planBilling nunca la volvería a cobrar (su paso 3 exige la fecha y el paso 2
        // solo toma las que no tienen etapa), y la que tenía tiempo pagado lo conserva como fecha de su primer cobro.
        if (billedWithoutBadge(target) && v.nextPaymentDueDate) {
          await prisma.vendor.updateMany({
            where: { id: v.id, planType: target.planType, billingNoticeStage: { not: null } },
            // Solo la fecha: billingNoticeDue se deja como estaba, para no repetir un aviso que ya salió.
            data: { nextPaymentDueDate: v.nextPaymentDueDate },
          });
        }
      }
      // Siempre: la tienda ya estaba en el plan nuevo antes de la baja, así que transitionVendorVerification no ve un cambio
      // de plan y no recalcula el cupo por su cuenta.
      await recalcVendorProductQuota(v.id);
      await noticeMovedVendor(v.id, plan, target, cardStopped);
    } catch (err) {
      console.error(`[planes] archivar ${planType}: falló un efecto en la tienda ${v.id}:`, err?.message);
      failedEffects.push(v.id);
    }
  }
  await recalcStoreOffersForPlan(target.planType);
  // Funciones guardadas en la tienda que el plan destino no incluye (ver whatsappOnWhere / privateOnWhere): solo en las
  // tiendas que llegaron ahora.
  if (liveMoved.length) {
    const movedIds = { id: { in: liveMoved.map((v) => v.id) } };
    if (!target.allowWhatsappOrders) await prisma.vendor.updateMany({ where: whatsappOnWhere(target.planType, movedIds), data: { orderDestination: "PANEL" } });
    if (!target.allowPublicProfile) await prisma.vendor.updateMany({ where: privateOnWhere(target.planType, movedIds), data: { isPrivate: false } });
  }
  if (billedWithoutBadge(target) && liveMoved.length) {
    const { startBillingForFreePlan } = await import("../services/planBilling.service.js");
    void startBillingForFreePlan(target.planType).catch((err) => console.error("[planes] no se pudo activar el cobro:", err?.message));
  }

  let stripe = null;
  if (failedCard.length) {
    const names = (await prisma.vendor.findMany({ where: { id: { in: failedCard } }, select: { companyName: true } })).map((v) => v.companyName);
    // El plan ya está archivado: no hay "probar de nuevo" desde aquí, hay que revisarlo en Stripe.
    stripe = {
      ...stripeSummary({ stopped: 0, failed: names }),
      message: `No se pudo confirmar en Stripe que deje de renovarse la suscripción con tarjeta de ${names.length === 1 ? "esta tienda" : "estas tiendas"}: ${names.join(", ")}. Revísalo en Stripe.`,
    };
  }
  logActivity({
    actorId,
    actorRole: "ADMIN",
    action: "PLAN_ARCHIVE",
    description: `Archivó el plan ${plan.displayName} y pasó ${plural(liveMoved.length, "tienda", "tiendas")} al plan ${target.displayName}.`,
    meta: { planType, moveTo: target.planType, moved: liveMoved.length, failedCard, failedEffects },
  });
  res.json({
    plan: await fullPlanRow(planType),
    moved: liveMoved.length,
    moveTo: liveMoved.length || dest ? target.planType : null,
    ...(stripe ? { stripe } : {}),
    ...(failedEffects.length ? { warning: `No se pudo terminar el cambio en ${plural(failedEffects.length, "tienda", "tiendas")}: ya están en el plan nuevo, revisa su cupo y sus ofertas.` } : {}),
  });
}

// POST /admin/plans/:key/restore: vuelve a la lista, oculto (se revisa antes de publicarlo).
export async function restorePlan(req, res) {
  const planType = keyFromParam(req.params.key);
  const plan = await prisma.planConfig.findUnique({ where: { planType } });
  if (!plan) throw new AppError("Plan no encontrado.", 404);
  if (!plan.archivedAt) throw new AppError("Ese plan no está archivado.", 409);
  await assertNameFree(plan.displayName, planType);
  await prisma.planConfig.update({ where: { planType }, data: { archivedAt: null, isPublic: false } });
  afterPlanWrite();
  logActivity({ actorId: req.user?.id ?? null, actorRole: "ADMIN", action: "PLAN_RESTORE", description: `Restauró el plan ${plan.displayName} (queda oculto).`, meta: { planType } });
  res.json({ plan: await fullPlanRow(planType) });
}

// POST /admin/plans/:key/preview-impact: lo mismo que PATCH (o { archive: true, moveTo }) sin escribir nada. También valida:
// una combinación imposible responde el mismo 400 que daría al guardar.
export async function previewPlanImpact(req, res) {
  const planType = keyFromParam(req.params.key);
  const before = await prisma.planConfig.findUnique({ where: { planType } });
  if (!before) throw new AppError("Plan no encontrado.", 404);
  if (req.body?.archive === true) {
    const { moveTo } = archiveSchema.parse({ moveTo: req.body.moveTo });
    if (before.archivedAt) throw new AppError("Ese plan ya está archivado.", 409);
    if (before.isDefault) throw new AppError("Es el plan por defecto: elige antes otro plan por defecto.", 409);
    if (before.isTrialPlan) throw new AppError("Es el plan de la prueba gratis: elige antes otro plan para la prueba.", 409);
    const dest = await archiveTarget(before, moveTo);
    if (!dest) {
      const vendors = await prisma.vendor.count({ where: { planType, deletedAt: null } });
      if (vendors > 0) {
        return res.json({ ...(await computeImpact(before, before)), needsMoveTo: true, messages: [`Este plan tiene ${plural(vendors, "tienda", "tiendas")}: elige a qué plan pasan.`] });
      }
      return res.json({ ...(await computeImpact(before, before)), needsMoveTo: false, messages: ["Ninguna tienda usa este plan: se archiva sin mover tiendas."] });
    }
    return res.json({ ...(await computeImpact(before, dest, { moveTo: dest })), needsMoveTo: false });
  }
  if (before.archivedAt) throw new AppError("Este plan está archivado. Restáuralo antes de editarlo.", 409);
  const input = planPatchSchema.parse(req.body ?? {});
  const { next, setDefault, setTrial } = await buildPlanPatch(before, input);
  res.json({ ...(await computeImpact(before, next, { setDefault, setTrial })), card: previewCard(next) });
}

// "Así lo ve la tienda": la tarjeta del plan con los cambios sin guardar, armada con la MISMA función que usa /planes y "Tu
// plan incluye" (buildPlanIncludes), para que la vista previa nunca diga algo distinto de lo que se publicará.
function previewCard(config) {
  return {
    displayName: config.displayName,
    tagline: config.tagline ?? null,
    priceCup: config.priceCup,
    priceUsd: config.priceUsd,
    listPriceCup: config.listPriceCup ?? null,
    listPriceUsd: config.listPriceUsd ?? null,
    isFree: !!config.isFree,
    contactOnly: !!config.contactOnly,
    grantsBadge: !!config.grantsBadge,
    highlighted: !!config.highlighted,
    isPublic: !!config.isPublic,
    includes: buildPlanIncludes(config),
  };
}

// --- Rutas: catálogo de funciones -----------------------------------------------------------------------------------------

// GET /admin/plan-features (incluye las inactivas; la pantalla oculta allowPanelOrders).
export async function listPlanFeatures(_req, res) {
  res.json({ features: await getPlanFeatureCatalog(), groups: FEATURE_GROUPS });
}

const featureTextFields = {
  label: z.string().trim().min(1, "Escribe el nombre de la función.").max(60, "El nombre admite hasta 60 caracteres."),
  description: z.string().trim().max(500, "La descripción admite hasta 500 caracteres."),
  group: z.enum(FEATURE_GROUPS, { errorMap: () => ({ message: "Elige un grupo de la lista." }) }),
  publicLabel: z.string().trim().max(120, "El texto público admite hasta 120 caracteres.").nullable(),
  unlimitedLabel: z.string().trim().max(120, "El texto sin tope admite hasta 120 caracteres.").nullable(),
  sortOrder: z.number().int().min(0).max(9999),
};

const createFeatureSchema = z.object({
  label: featureTextFields.label,
  description: featureTextFields.description.optional(),
  group: featureTextFields.group.optional(),
  publicLabel: featureTextFields.publicLabel.optional(),
  sortOrder: featureTextFields.sortOrder.optional(),
});

async function catalogEntry(key) {
  return (await getPlanFeatureCatalog()).find((f) => f.key === key) ?? null;
}

// POST /admin/plan-features: solo funciones personalizadas (se muestran como beneficio; el servidor no las hace cumplir).
export async function createPlanFeature(req, res) {
  const d = createFeatureSchema.parse(req.body ?? {});
  const rows = await prisma.planFeature.findMany({ select: { key: true, label: true, kind: true } });
  const norm = (s) => String(s).trim().toLocaleLowerCase("es");
  if (rows.some((r) => norm(r.label) === norm(d.label))) throw new AppError(`Ya hay una función llamada "${d.label}".`, 409);
  const key = featureKeyFromLabel(d.label, rows.map((r) => r.key));
  await prisma.planFeature.create({
    data: {
      key,
      label: d.label,
      description: d.description ?? "",
      group: d.group ?? "Otras",
      kind: "custom",
      column: null,
      requiresBadge: false,
      publicLabel: d.publicLabel || null,
      unlimitedLabel: null,
      sortOrder: d.sortOrder ?? 500,
      isActive: true,
    },
  });
  afterPlanWrite({ catalog: true });
  logActivity({ actorId: req.user?.id ?? null, actorRole: "ADMIN", action: "PLAN_FEATURE_CREATE", description: `Creó la función personalizada ${d.label}.`, meta: { key } });
  res.status(201).json({ feature: await catalogEntry(key) });
}

const updateFeatureSchema = z.object({
  label: featureTextFields.label.optional(),
  description: featureTextFields.description.optional(),
  group: featureTextFields.group.optional(),
  publicLabel: featureTextFields.publicLabel.optional(),
  unlimitedLabel: featureTextFields.unlimitedLabel.optional(),
  sortOrder: featureTextFields.sortOrder.optional(),
  isActive: z.boolean().optional(),
});

// PATCH /admin/plan-features/:key. Las del registro solo cambian sus textos, grupo y orden: el tipo, la columna, la insignia y
// si están activas los decide el código (una función que el servidor cumple no se puede apagar desde aquí).
export async function updatePlanFeature(req, res) {
  const key = String(req.params.key ?? "");
  const entry = await catalogEntry(key);
  if (!entry) throw new AppError("Función no encontrada.", 404);
  const d = updateFeatureSchema.parse(req.body ?? {});
  if (!entry.isCustom && d.isActive !== undefined) {
    throw new AppError("Esta función la cumple el servidor: no se puede apagar desde aquí. Apágala en cada plan.", 400);
  }
  if (entry.kind === "limit" && d.publicLabel && !d.publicLabel.includes("{n}")) {
    throw new AppError('El texto público de un tope tiene que llevar {n} donde va el número (por ejemplo "Hasta {n} productos").', 400);
  }
  if (d.label && d.label !== entry.label) {
    const norm = (s) => String(s).trim().toLocaleLowerCase("es");
    const others = await prisma.planFeature.findMany({ where: { key: { not: key } }, select: { label: true } });
    if (others.some((r) => norm(r.label) === norm(d.label))) throw new AppError(`Ya hay una función llamada "${d.label}".`, 409);
  }
  const data = Object.fromEntries(Object.entries(d).filter(([, v]) => v !== undefined));
  if ("publicLabel" in data) data.publicLabel = data.publicLabel || null;
  if ("unlimitedLabel" in data) data.unlimitedLabel = data.unlimitedLabel || null;
  // Una función del registro sin fila en la base (base sin sembrar) se crea con los valores del registro.
  const reg = FEATURE_REGISTRY[key];
  await prisma.planFeature.upsert({
    where: { key },
    update: data,
    create: {
      key,
      label: entry.label,
      description: entry.description ?? "",
      group: entry.group,
      kind: entry.kind,
      column: reg ? reg.column : null,
      requiresBadge: !!entry.requiresBadge,
      publicLabel: entry.publicLabel ?? null,
      unlimitedLabel: entry.unlimitedLabel ?? null,
      sortOrder: entry.sortOrder ?? 0,
      isActive: entry.isActive,
      ...data,
    },
  });
  afterPlanWrite({ catalog: true });
  logActivity({ actorId: req.user?.id ?? null, actorRole: "ADMIN", action: "PLAN_FEATURE_UPDATE", description: `Cambió la función ${data.label ?? entry.label}: ${Object.keys(data).join(", ")}.`, meta: { key, changes: data } });
  res.json({ feature: await catalogEntry(key) });
}

// DELETE /admin/plan-features/:key: solo personalizadas. Se borra la fila y su valor en todos los planes a la vez.
export async function deletePlanFeature(req, res) {
  const key = String(req.params.key ?? "");
  const entry = await catalogEntry(key);
  if (!entry) throw new AppError("Función no encontrada.", 404);
  if (!entry.isCustom) throw new AppError("Esta función la cumple el servidor: no se puede borrar. Apágala en cada plan.", 400);
  await prisma.$transaction([
    prisma.planFeature.delete({ where: { key } }),
    prisma.$executeRaw`UPDATE "PlanConfig" SET "customFeatures" = "customFeatures" - ${key}::text`,
  ]);
  afterPlanWrite({ catalog: true });
  logActivity({ actorId: req.user?.id ?? null, actorRole: "ADMIN", action: "PLAN_FEATURE_DELETE", description: `Borró la función personalizada ${entry.label}.`, meta: { key } });
  res.json({ ok: true });
}

// --- Rutas: estadísticas --------------------------------------------------------------------------------------------------
const dateParam = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Usa fechas con el formato AAAA-MM-DD.");
const statsQuerySchema = z.object({ from: dateParam.optional(), to: dateParam.optional() });

// GET /admin/plan-stats?from=YYYY-MM-DD&to=YYYY-MM-DD (por defecto, los últimos 30 días; `to` incluye todo ese día).
export async function getPlanStats(req, res) {
  const q = statsQuerySchema.parse(req.query ?? {});
  // "2026-02-31" pasa el formato pero no existe (Date.UTC salta al 3 de marzo): se compara con lo escrito.
  const exists = (s) => !s || new Date(Date.UTC(...ymdParts(s).map((n, i) => (i === 1 ? n - 1 : n)))).toISOString().slice(0, 10) === s;
  if (!exists(q.from) || !exists(q.to)) throw new AppError("Alguna de las fechas no existe.", 400);
  // Días del negocio (zona del sitio, ver rangeInTz). Sin `from`, los 30 días que terminan en `to` (o en hoy).
  const tz = await getSiteTimezone();
  const toParts = q.to ? ymdParts(q.to) : todayParts(tz);
  const fromParts = q.from ? ymdParts(q.from) : [toParts[0], toParts[1], toParts[2] - 29];
  const { from, to } = rangeInTz(fromParts, toParts, tz);
  if (from > to) throw new AppError("La fecha de inicio tiene que ser anterior a la de fin.", 400);
  if (to - from > 3 * 366 * DAY_MS) throw new AppError("Elige un periodo de hasta 3 años.", 400);
  res.json(await computePlanStats(from, to));
}
