import { prisma } from "./prisma.js";
import { AppError } from "../utils/AppError.js";
import { completenessScore } from "./productRanking.js";
import { getPlanFeatureCatalog, getPlanFeatureCatalogSync, renderPlanIncludes, planFeatureList, customFeaturesOf, FEATURE_REGISTRY } from "./planFeatures.js";

// Bloque 52 (pedido explícito — "que todo esté bien agrupado en la sección
// de suscripciones... una concordancia con todo y una configuración
// correcta"): ÚNICO punto del código que decide qué puede hacer una tienda
// según su plan — reemplaza las constantes hardcodeadas y columnas pareadas
// sueltas que vivían repartidas en products.controller.js,
// orders.controller.js, vendors.controller.js y varios controllers de
// features (chat/offers/storeOffers/reviews). Ver PlanConfig en
// schema.prisma para el detalle de cada columna.

// Caché corta (5s): esta función se llama en casi todas las rutas de
// vendedor/tienda — sin caché sería una consulta extra de base por request.
// 5s es intencionalmente corto: un admin que acaba de guardar un cambio en
// "Configuración de planes" lo ve reflejado casi al instante, sin tener que
// reiniciar el backend.
let cache = null;
let cacheAt = 0;
const CACHE_MS = 5000;
// Última lectura, sin vencimiento: la usan las funciones síncronas (isPremiumActive, paymentPlanOf) que necesitan saber
// cuál es el plan por defecto o el de prueba sin esperar a la base. null = todavía no se leyó nunca.
let snapshot = null;

async function loadPlanConfigs() {
  if (cache && Date.now() - cacheAt < CACHE_MS) return cache;
  // El catálogo de funciones se refresca junto con los planes: así buildPlanIncludes (síncrona) usa textos recientes.
  const [rows] = await Promise.all([prisma.planConfig.findMany(), getPlanFeatureCatalog()]);
  cache = Object.fromEntries(rows.map((r) => [r.planType, r]));
  cacheAt = Date.now();
  snapshot = cache;
  return cache;
}

// Se llama después de cualquier escritura a PlanConfig (ver settings
// controller) para que el cambio se vea de inmediato, sin esperar los 5s.
export function invalidatePlanConfigCache() {
  cache = null;
}

// Un plan por su clave (PlanConfig.planType), archivado o no: los pagos y cambios viejos siguen apuntando a planes
// archivados y tienen que poder mostrar su nombre.
export async function getPlanConfig(planType) {
  const configs = await loadPlanConfigs();
  return configs[planType] ?? null;
}

// Los planes en el orden en que se muestran (sortOrder). Sin los archivados, salvo { includeArchived: true }: un plan
// archivado ya no se vende ni se asigna, pero su fila sigue para el historial.
export async function getAllPlanConfigs({ includeArchived = false } = {}) {
  const configs = await loadPlanConfigs();
  return Object.values(configs)
    .filter((c) => includeArchived || !c.archivedAt)
    .sort((a, b) => a.sortOrder - b.sortOrder || a.planType.localeCompare(b.planType));
}

// --- Claves de plan -----------------------------------------------------------------------------------------------------
// La clave de un plan es PlanConfig.planType (texto único, A-Z0-9_). Las cuatro de siempre (REGULAR, STANDARD, BUSINESS,
// ENTERPRISE) se conservan; un plan nuevo recibe una clave generada de su nombre (planKeyFromName). Lo que antes se
// deducía del nombre de la clave ("REGULAR es el gratis", "BUSINESS es el de la prueba") ahora sale de banderas del plan:
// isDefault (registro y bajada; exactamente uno) e isTrialPlan (prueba gratis; como mucho uno). Nunca se escribe una lista
// fija de planes en el código: se usan estas funciones.

// Valores de reserva solo para cuando la base todavía no se leyó (arranque) o le falta la bandera.
const FALLBACK_DEFAULT_PLAN = "REGULAR";
const FALLBACK_TRIAL_PLAN = "BUSINESS";

function flaggedKey(configs, flag) {
  const row = Object.values(configs ?? {}).find((c) => c[flag] && !c.archivedAt);
  return row?.planType ?? null;
}

// Plan por defecto: el de las tiendas nuevas y al que bajan las que dejan de pagar (hoy el Básico).
export async function getDefaultPlanKey() {
  return flaggedKey(await loadPlanConfigs(), "isDefault") ?? FALLBACK_DEFAULT_PLAN;
}

// Plan de la prueba gratis (hoy Premium).
export async function getTrialPlanKey() {
  return flaggedKey(await loadPlanConfigs(), "isTrialPlan") ?? FALLBACK_TRIAL_PLAN;
}

// Versiones síncronas con la última lectura de la base. Solo para código que no puede ser async.
export function getDefaultPlanKeySync() {
  return flaggedKey(snapshot, "isDefault") ?? FALLBACK_DEFAULT_PLAN;
}
export function getTrialPlanKeySync() {
  return flaggedKey(snapshot, "isTrialPlan") ?? FALLBACK_TRIAL_PLAN;
}

// Planes vigentes (no archivados), públicos u ocultos, en su orden.
export async function getActivePlanKeys() {
  return (await getAllPlanConfigs()).map((c) => c.planType);
}

// Planes de pago: ni el por defecto, ni gratis, ni archivados. Incluye los "por WhatsApp" (Empresarial): sus tiendas
// también tienen suscripción. Es lo que antes era la lista fija PAID_PLAN_TYPES.
export async function getPaidPlanKeys() {
  return (await getAllPlanConfigs()).filter((c) => !c.isDefault && !c.isFree).map((c) => c.planType);
}

// ¿Existe un plan con esa clave? Los archivados cuentan solo con { allowArchived: true } (historial, filtros de pagos viejos).
export async function isValidPlanKey(key, { allowArchived = false } = {}) {
  if (typeof key !== "string" || !key) return false;
  const config = (await loadPlanConfigs())[key];
  return !!config && (allowArchived || !config.archivedAt);
}

// Nombre visible de un plan, siempre desde la base. Si la clave no existe devuelve la clave tal cual.
export async function planDisplayName(key) {
  return (await getPlanConfig(key))?.displayName ?? key ?? "";
}

// Formato de una clave de plan: lo mismo que exige la base (CHECK en PlanConfig).
export const PLAN_KEY_PATTERN = /^[A-Z][A-Z0-9_]{0,29}$/;

// Clave estable y única para un plan nuevo a partir de su nombre: "Restaurante" -> "PLAN_RESTAURANTE". Mayúsculas, sin
// tildes, A-Z0-9_ y como mucho 30 caracteres. Se compara contra TODOS los planes, también los archivados (una clave nunca
// se reutiliza: los pagos viejos apuntan a ella). Si ya existe se agrega _2, _3...
export async function planKeyFromName(name) {
  const taken = new Set(Object.keys(await loadPlanConfigs()));
  const slug = String(name ?? "")
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .replace(/^PLAN_?/, "");
  const base = `PLAN_${slug || "NUEVO"}`.slice(0, 30).replace(/_+$/g, "");
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i++) {
    const suffix = `_${i}`;
    const candidate = `${base.slice(0, 30 - suffix.length).replace(/_+$/g, "")}${suffix}`;
    if (!taken.has(candidate)) return candidate;
  }
  throw new AppError("No se pudo generar una clave para el plan. Prueba con otro nombre.", 400);
}

// Historial de cambios de plan de una tienda (VendorPlanChange): de él salen las altas y bajas de cada plan en las
// estadísticas. Se llama en el mismo lugar donde se cambia Vendor.planType, con la transacción si la hay (`db` = tx o
// prisma), así nunca queda un cambio sin registrar ni un registro sin cambio. Si el plan no cambia no anota nada.
// `reason` es un código corto (ver PLAN_CHANGE_REASONS); `actorId` el usuario que lo hizo (null = el sistema).
export const PLAN_CHANGE_REASONS = [
  "registration",
  "admin_change",
  "admin_grant",
  "admin_revoke",
  "verification_approved",
  "payment_confirmed",
  "card_subscription",
  "trial_start",
  "trial_end",
  "downgrade_unpaid",
  "downgrade_cancelled",
  "plan_archived",
  "partner",
  "vendor_request",
  "other",
];

export async function recordPlanChange(db, { vendorId, fromPlan = null, toPlan, reason, actorId = null }) {
  if (!vendorId || !toPlan || fromPlan === toPlan) return null;
  // Un código fuera de la lista se guarda igual (recortado): perderlo como "other" escondería de dónde vino el cambio.
  const why = String(reason || "other").slice(0, 80);
  return (db ?? prisma).vendorPlanChange.create({ data: { vendorId, fromPlan: fromPlan ?? null, toPlan, reason: why, actorId: actorId ?? null } });
}

// --- Precios ------------------------------------------------------------------------------------------------------------
// Cada plan tiene su precio mensual en CUP (transferencia) y en USD (tarjeta), y descuentos por pagar varios meses juntos
// (PlanConfig.monthDiscounts: [{ months, cup, usd }], el % en cada moneda). Se aplica el escalón más alto alcanzado: con
// descuentos en 3, 6 y 12 meses, pagar 8 meses lleva el de 6. Todo cobro (verificación, renovación, tarjeta, pago manual)
// sale de aquí, así el precio que ve la tienda y el que se cobra nunca difieren.

export function normalizeMonthDiscounts(raw) {
  if (!Array.isArray(raw)) return [];
  const clamp = (n) => Math.max(0, Math.min(90, Math.round(Number(n) || 0)));
  return raw
    .map((d) => ({ months: Math.trunc(Number(d?.months)), cup: clamp(d?.cup), usd: clamp(d?.usd) }))
    .filter((d) => d.months >= 2 && d.months <= 36 && (d.cup > 0 || d.usd > 0))
    .sort((a, b) => a.months - b.months);
}

export function discountFor(config, months, currency) {
  const key = currency === "USD" ? "usd" : "cup";
  const tier = [...normalizeMonthDiscounts(config?.monthDiscounts)].reverse().find((d) => months >= d.months);
  return tier?.[key] ?? 0;
}

const round2 = (n) => Math.round(n * 100) / 100;

// Precio de `months` meses de un plan en una moneda ("CUP" o "USD"): mensual, % de descuento y total a pagar. En CUP se
// redondea al peso (no hay centavos en las transferencias); en USD, al centavo.
export function planPrice(config, months, currency) {
  const monthly = currency === "USD" ? Number(config?.priceUsd ?? 0) : Number(config?.priceCup ?? 0);
  const discountPercent = discountFor(config, months, currency);
  const gross = monthly * months;
  const raw = gross * (1 - discountPercent / 100);
  const total = currency === "USD" ? round2(raw) : Math.round(raw);
  return { monthly, months, currency, discountPercent, gross: currency === "USD" ? round2(gross) : gross, total, perMonth: currency === "USD" ? round2(total / months) : Math.round(total / months) };
}

// Plan de un pago guardado. Los pagos de antes de los planes configurables no lo tienen: eran todos de Premium, que es el
// plan de prueba (isTrialPlan). Se usa la bandera en vez de la clave fija; mientras Premium siga siendo el de prueba da lo
// mismo que antes. Síncrona a propósito (los llamadores la usan dentro de map y de objetos literales).
export const paymentPlanOf = (planType) => planType ?? getTrialPlanKeySync();

// Cuánto se cobra por `months` meses del plan con un método de pago (CARD = USD, cualquier otro = CUP), con su descuento.
// Rechaza los planes que no se pagan en línea: los "por WhatsApp" y los gratis.
export async function quotePlan(planType, months, method) {
  const config = await getPlanConfig(paymentPlanOf(planType));
  if (!config) throw new AppError("Ese plan no existe.", 400);
  if (config.contactOnly) throw new AppError(`El plan ${config.displayName} se contrata hablando con el equipo por WhatsApp.`, 400);
  if (config.isFree) throw new AppError(`El plan ${config.displayName} es gratis por ahora: no hay nada que pagar.`, 400);
  return { config, ...planPrice(config, months, method === "CARD" ? "USD" : "CUP") };
}

// Un plan que se cobra: ni gratis por ahora ni "por WhatsApp".
export function isPaidConfig(config) {
  return !!config && !config.isFree && !config.contactOnly;
}

// Lo que ve cualquiera en la página de planes (sin datos internos).
export function publicPlan(config) {
  return {
    planType: config.planType,
    name: config.displayName,
    tagline: config.tagline,
    sortOrder: config.sortOrder,
    priceCup: config.priceCup,
    priceUsd: config.priceUsd,
    listPriceCup: config.listPriceCup,
    listPriceUsd: config.listPriceUsd,
    isFree: config.isFree,
    contactOnly: config.contactOnly,
    highlighted: config.highlighted,
    grantsBadge: config.grantsBadge,
    isDefault: !!config.isDefault,
    isTrialPlan: !!config.isTrialPlan,
    monthDiscounts: normalizeMonthDiscounts(config.monthDiscounts),
    includes: buildPlanIncludes(config),
    // Funciones del catálogo (activas, en su orden) con su valor en este plan y el texto público ya armado. Las
    // personalizadas van aquí también (kind 'custom', enforced:false). Ver planFeatureList en planFeatures.js.
    features: planFeatureList(config),
    limits: {
      maxProducts: config.maxProducts,
      maxProvinces: config.maxProvinces,
      maxDeliveryCountries: config.maxDeliveryCountries,
      maxStaffUsers: config.allowStaffUsers ? config.maxStaffUsers : 0,
      maxTables: config.allowQrTables ? config.maxTables : 0,
      maxDiscountCodes: config.allowDiscountCodes ? config.maxDiscountCodes : 0,
      maxActiveStoreOffers: config.allowStoreOffers ? config.maxActiveStoreOffers : 0,
      maxMonthlyOrderEmails: config.allowCustomerEmails ? config.maxMonthlyOrderEmails : 0,
    },
    flags: {
      allowWhatsappOrders: config.allowWhatsappOrders,
      allowPos: config.allowPos,
      allowAiChatbot: config.allowAiChatbot,
      allowLoyalty: config.allowLoyalty,
      allowCustomerEmails: config.allowCustomerEmails,
      allowSchedules: config.allowSchedules,
      allowReviewPhotos: config.allowReviewPhotos,
      allowAdminChat: config.allowAdminChat,
      featuredInHome: config.featuredInHome,
      allowPublicProfile: config.allowPublicProfile,
    },
  };
}

// Bloque 52 (pedido explícito, decisión confirmada — "las dos cosas"): una
// función/límite "Premium" exige AMBAS condiciones, nunca una sola. Antes
// del Bloque 52 esto era solo `verificationStatus === "VERIFIED"` en una
// decena de lugares — funcionaba por una coincidencia de datos (el admin
// solo otorgaba planType:"BUSINESS" junto con la verificación, nunca por
// separado), pero una tienda Premium activada a mano SIN estar verificada
// quedaría con todas las funciones encendidas igual si siguiéramos mirando
// solo verificationStatus. La insignia de verificado sigue siendo nada más
// que un sello de confianza — nunca una llave de funciones por sí sola.
// Con los planes configurables: las funciones de un plan de pago están activas si la tienda está verificada en ese plan
// (los planes con insignia) o, en un plan de pago sin insignia, mientras tenga tiempo pagado. Qué funciones concretas tiene
// cada plan lo deciden sus interruptores (assertPlanAllows / planAllows).
// El plan por defecto (isDefault, hoy el Básico) nunca cuenta como plan de pago activo, aunque tenga fecha de cobro.
export function isPremiumActive(vendor) {
  if (!vendor || vendor.planType === getDefaultPlanKeySync()) return false;
  if (vendor.verificationStatus === "VERIFIED") return true;
  return !!vendor.nextPaymentDueDate && new Date(vendor.nextPaymentDueDate) > new Date();
}

// Límite numérico efectivo de una tienda para `key` (ej. "maxProducts").
// null = sin límite. Nunca lanza — el caller decide qué hacer con el número.
export async function getPlanLimit(vendor, key) {
  const config = await getPlanConfig(vendor.planType);
  return config?.[key] ?? null;
}

// Funciones que además del interruptor del plan exigen la insignia de verificada (requiresBadge en FEATURE_REGISTRY: chat
// con IA, ofertas de tienda, destacada en la portada, fotos en reseñas, chat con el equipo). El registro es la fuente: la
// base no puede cambiar requiresBadge (PATCH /admin/plan-features lo ignora), así que no hace falta leer el catálogo.
export function featureRequiresBadge(flag) {
  return !!FEATURE_REGISTRY[flag]?.requiresBadge;
}

// ¿El plan trae `flag`? El interruptor y, si la función exige insignia, que el plan la dé: /planes y "Tu plan incluye"
// (renderPlanIncludes) no la anuncian en un plan sin insignia ("Requiere un plan con insignia"), así que tampoco se cumple.
function planHasFeature(config, flag) {
  if (!config?.[flag]) return false;
  return !featureRequiresBadge(flag) || !!config.grantsBadge;
}

// Regla única de "¿esta tienda puede usar `flag`?": lo que trae su plan (planHasFeature) y, si la función exige insignia, que
// la tienda esté VERIFIED. Antes cada punto de cumplimiento miraba la verificación a su manera (unos verificationStatus,
// otros isPremiumActive, que da true en un plan de pago sin insignia con tiempo pagado) y las pantallas públicas decían
// "Requiere un plan con insignia" mientras el servidor la dejaba usar. También cubre a una tienda que conserva VERIFIED
// tras pasar a un plan sin insignia (archivo del plan o grantsBadge apagado): ya no usa esas funciones.
function allowsWith(config, vendor, flag) {
  if (!planHasFeature(config, flag)) return false;
  if (vendor && featureRequiresBadge(flag) && vendor.verificationStatus !== "VERIFIED") return false;
  return true;
}

// Lo mismo que assertPlanAllows pero sin lanzar: para tareas automáticas (correos, pantallas públicas) que se saltan en silencio.
// Acepta la tienda (`{ planType, verificationStatus }`) o solo la clave del plan. Con la tienda aplica también la insignia
// de las funciones requiresBadge; con solo la clave mira únicamente el plan, así que para esas funciones hay que pasar la
// tienda.
export async function planAllows(vendorOrPlanType, flag) {
  const vendor = vendorOrPlanType && typeof vendorOrPlanType === "object" ? vendorOrPlanType : null;
  const config = await getPlanConfig(vendor ? vendor.planType : vendorOrPlanType);
  return allowsWith(config, vendor, flag);
}

// Lanza un AppError en español si la tienda no puede usar `flag` (ej. "allowAiChatbot") con su plan actual: el interruptor
// del plan y, en las funciones requiresBadge, la insignia (misma regla que planAllows).
// `planRequired` en el detalle del 403: es lo que mira isPlanError (PlanUpsell.jsx) para mostrar "esta función no está en
// tu plan" con el camino a Suscripción, en vez de un error suelto. Antes solo lo mandaba la caja (requirePosPlan).
// Con el plan correcto pero sin la insignia, una función requiresBadge responde 403 con `badgeRequired` (no `planRequired`):
// lo que le falta a la tienda es verificarse, no cambiar de plan.
export async function assertPlanAllows(vendor, flag, message) {
  const config = await getPlanConfig(vendor.planType);
  if (!planHasFeature(config, flag)) {
    throw new AppError(message ?? "Tu plan actual no incluye esta función.", 403, { planRequired: flag });
  }
  if (!allowsWith(config, vendor, flag)) {
    throw new AppError("Disponible solo para tiendas verificadas.", 403, { badgeRequired: flag });
  }
}

// Lo que el plan de la tienda le deja usar en su panel (GET /vendors/me): el menú y las pantallas ocultan lo que el plan
// no trae en vez de mostrar botones que el servidor rechaza. Sale de los mismos interruptores que miran assertPlanAllows y
// planAllows (no de isPremiumActive), así lo que se ve en el panel y lo que el servidor deja hacer nunca difieren.
// Los topes de una función apagada valen 0, como en publicPlan; null = sin tope.
// Además de las claves de siempre trae todas las del registro (FEATURE_REGISTRY) y `custom` (las funciones personalizadas
// encendidas, { clave: true }), así una pantalla nueva no necesita otra lista fija.
// Las funciones que exigen insignia cuentan solo si el plan la da (planHasFeature), igual que en assertPlanAllows: el menú
// no ofrece en un plan sin insignia lo que el servidor rechaza.
export function planFeaturesOf(config) {
  const on = (flag) => planHasFeature(config, flag);
  const cap = (flag, key) => (on(flag) ? config[key] ?? null : 0);
  const fromRegistry = {};
  for (const [key, f] of Object.entries(FEATURE_REGISTRY)) {
    if (f.kind === "flag") fromRegistry[key] = on(f.column);
    else fromRegistry[key] = f.governedBy ? cap(FEATURE_REGISTRY[f.governedBy].column, f.column) : config?.[f.column] ?? null;
  }
  delete fromRegistry.allowPanelOrders;
  return {
    ...fromRegistry,
    custom: customFeaturesOf(config),
    planType: config?.planType ?? null,
    allowPos: on("allowPos"),
    allowQrTables: on("allowQrTables"),
    allowLoyalty: on("allowLoyalty"),
    allowStoreOffers: on("allowStoreOffers"),
    allowDiscountCodes: on("allowDiscountCodes"),
    allowStaffUsers: on("allowStaffUsers"),
    allowCustomerEmails: on("allowCustomerEmails"),
    allowAiChatbot: on("allowAiChatbot"),
    allowSchedules: on("allowSchedules"),
    allowAdminChat: on("allowAdminChat"),
    allowWhatsappOrders: on("allowWhatsappOrders"),
    maxProducts: config?.maxProducts ?? null,
    maxProvinces: config?.maxProvinces ?? null,
    maxDeliveryCountries: config?.maxDeliveryCountries ?? null,
    maxStaffUsers: cap("allowStaffUsers", "maxStaffUsers"),
    maxTables: cap("allowQrTables", "maxTables"),
    maxDiscountCodes: cap("allowDiscountCodes", "maxDiscountCodes"),
    maxActiveStoreOffers: cap("allowStoreOffers", "maxActiveStoreOffers"),
    maxMonthlyOrderEmails: cap("allowCustomerEmails", "maxMonthlyOrderEmails"),
  };
}

// Bloque 52 (pedido explícito — al bajar el cupo de productos, "se muestran
// solo los últimos productos del límite que se define y los demás quedan en
// el panel del vendedor... no públicos"): recalcula qué productos activos de
// una tienda quedan DENTRO del cupo (overQuota:false, visibles en la web
// pública) y cuáles quedan afuera (overQuota:true, el vendedor los sigue
// viendo y administrando en su panel, pero ningún listado público los
// muestra — mismo criterio de exclusión que hiddenFromStore). Los más
// recientes (`createdAt desc`) ganan el cupo por default; el vendedor puede
// reordenar la prioridad con swapProductQuota más abajo.
//
// Se llama: al guardar la configuración de un plan (el cupo de TODAS las
// tiendas de ese plan pudo cambiar) y al cambiar el planType de una tienda
// puntual. Cuando UN producto pasa a activo se usa placeProductInQuota (más
// abajo), que no reordena los que ya estaban publicados.
export async function recalcVendorProductQuota(vendorId) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { planType: true } });
  if (!vendor) return;
  const maxProducts = await getPlanLimit(vendor, "maxProducts");

  if (maxProducts === null) {
    await prisma.product.updateMany({ where: { vendorId, isActive: true, overQuota: true }, data: { overQuota: false } });
    return;
  }

  const active = await prisma.product.findMany({
    where: { vendorId, isActive: true },
    select: { id: true, createdAt: true, quotaPinnedAt: true, salesCount: true, rating: true, reviewCount: true, images: true, description: true, tags: true, categoryId: true, badge: true },
  });
  const withinQuota = new Set(rankForQuota(active).slice(0, maxProducts).map((p) => p.id));

  await prisma.$transaction([
    prisma.product.updateMany({
      where: { vendorId, isActive: true, id: { in: [...withinQuota] } },
      data: { overQuota: false },
    }),
    prisma.product.updateMany({
      where: { vendorId, isActive: true, id: { notIn: [...withinQuota] } },
      data: { overQuota: true },
    }),
  ]);
}

// Un producto que acaba de pasar a activo (su primera foto, reactivarlo desde el panel, una apelación aceptada) entra al cupo
// solo si queda lugar; si no, queda activo pero fuera del cupo (overQuota:true): la tienda lo ve en su panel como "Fuera del
// cupo" y decide con swapProductQuota si lo cambia por otro. Antes ningún camino de activación miraba el tope y el producto
// salía al público con overQuota:false (el valor por defecto), así que creando borradores y subiéndoles foto se publicaba sin
// límite. No se usa recalcVendorProductQuota a propósito: reordena por mérito y podría sacar de la vista pública un producto
// que ya estaba publicado solo porque el nuevo tiene la ficha más completa.
// Devuelve el overQuota con que quedó el producto.
export async function placeProductInQuota(vendorId, productId) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { planType: true } });
  if (!vendor) return false;
  const maxProducts = await getPlanLimit(vendor, "maxProducts");
  if (maxProducts === null) {
    await prisma.product.update({ where: { id: productId }, data: { overQuota: false } });
    return false;
  }
  const others = await prisma.product.count({ where: { vendorId, isActive: true, overQuota: false, id: { not: productId } } });
  if (others >= maxProducts) {
    await prisma.product.update({ where: { id: productId }, data: { overQuota: true } });
    return true;
  }
  await prisma.product.update({ where: { id: productId }, data: { overQuota: false } });
  // Dos activaciones casi a la vez pueden ver el mismo hueco libre: se vuelve a contar y, si el cupo se pasó, este cede el
  // lugar. En el peor caso los dos ceden y queda un hueco libre, nunca uno de más.
  const within = await prisma.product.count({ where: { vendorId, isActive: true, overQuota: false } });
  if (within > maxProducts) {
    await prisma.product.update({ where: { id: productId }, data: { overQuota: true } });
    return true;
  }
  return false;
}

// Qué productos quedan visibles cuando la tienda tiene más que su cupo (por ejemplo, al terminar la prueba gratis). Antes
// ganaban los más recientes, y eso premiaba cargar muchos productos al final de la prueba. Ahora el orden es por mérito:
//  1. los que la tienda eligió a mano para el cupo (el más reciente primero);
//  2. los que vendieron de verdad;
//  3. los mejor valorados por clientes, y después los de ficha más completa (fotos, descripción, categoría);
//  4. a igualdad, el más antiguo: un producto con historia pesa más que uno recién creado.
export function rankForQuota(products) {
  return [...products].sort((a, b) => {
    const pa = a.quotaPinnedAt ? new Date(a.quotaPinnedAt).getTime() : 0;
    const pb = b.quotaPinnedAt ? new Date(b.quotaPinnedAt).getTime() : 0;
    if (pa !== pb) return pb - pa;
    if (b.salesCount !== a.salesCount) return b.salesCount - a.salesCount;
    const ra = Number(a.rating) * Math.min(a.reviewCount, 5);
    const rb = Number(b.rating) * Math.min(b.reviewCount, 5);
    if (rb !== ra) return rb - ra;
    const ca = completenessScore(a);
    const cb = completenessScore(b);
    if (cb !== ca) return cb - ca;
    return new Date(a.createdAt) - new Date(b.createdAt);
  });
}

// Intercambio explícito pedido por el dueño ("agregar un botón que luego de
// eliminar algunos solo deberá activar otros para que sean visibles"): el
// vendedor elige qué producto EXCEDENTE pasa a ocupar el cupo — nunca
// automático. Si no hay cupo libre, baja de categoría al producto activo
// menos prioritario (el más viejo) para hacerle lugar, en vez de fallar.
const QUOTA_SWAPS_PER_DAY = 5;

export async function swapProductQuota(vendorId, productIdToActivate) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { planType: true } });
  if (!vendor) throw new AppError("Tienda no encontrada.", 404);

  const target = await prisma.product.findFirst({ where: { id: productIdToActivate, vendorId, isActive: true } });
  if (!target) throw new AppError("Producto no encontrado.", 404);
  if (!target.overQuota) return; // ya estaba dentro del cupo, nada que hacer

  // Tope de cambios por día: sin él, una tienda podría ir rotando qué productos se ven y mostrar todo su catálogo con el
  // cupo de un plan menor.
  const swapsToday = await prisma.product.count({ where: { vendorId, quotaPinnedAt: { gte: new Date(Date.now() - 24 * 60 * 60 * 1000) } } });
  if (swapsToday >= QUOTA_SWAPS_PER_DAY) {
    throw new AppError(`Puedes cambiar hasta ${QUOTA_SWAPS_PER_DAY} productos visibles por día. Prueba de nuevo mañana o pasa a un plan con más productos para publicarlos todos.`, 429);
  }

  const maxProducts = await getPlanLimit(vendor, "maxProducts");
  if (maxProducts === null) {
    await prisma.product.update({ where: { id: target.id }, data: { overQuota: false, quotaPinnedAt: new Date() } });
    return;
  }

  const withinQuotaCount = await prisma.product.count({ where: { vendorId, isActive: true, overQuota: false } });
  if (withinQuotaCount < maxProducts) {
    await prisma.product.update({ where: { id: target.id }, data: { overQuota: false, quotaPinnedAt: new Date() } });
    return;
  }

  // Sin lugar libre: cede el puesto el que menos merece estar según rankForQuota (el último de la lista), y pierde su marca de
  // "elegido a mano" para que no vuelva a entrar solo en el próximo recálculo.
  const within = await prisma.product.findMany({
    where: { vendorId, isActive: true, overQuota: false },
    select: { id: true, createdAt: true, quotaPinnedAt: true, salesCount: true, rating: true, reviewCount: true, images: true, description: true, tags: true, categoryId: true, badge: true },
  });
  const leaving = rankForQuota(within).at(-1);
  await prisma.$transaction([
    prisma.product.update({ where: { id: target.id }, data: { overQuota: false, quotaPinnedAt: new Date() } }),
    ...(leaving ? [prisma.product.update({ where: { id: leaving.id }, data: { overQuota: true, quotaPinnedAt: null } })] : []),
  ]);
}


// Lo que incluye un plan, armado SOLO con lo que el admin configura en Suscripciones (límites y funciones encendidas). Es lo
// que ven las tiendas en "Tu plan incluye", en la comparación de planes y en la página de pago: así nunca contradice lo que
// el sistema aplica de verdad (antes salía del texto libre del plan y podía decir "hasta 20 productos" con un límite de 10).
// Las líneas salen del catálogo de funciones (renderPlanIncludes en planFeatures.js, con los textos que el admin edita) y
// terminan con las funciones personalizadas encendidas. El texto libre del admin se agrega al final como beneficios extra,
// sin las líneas con números (podrían contradecir un límite real; los límites ya salen arriba con el valor configurado).
// Síncrona: usa la última lectura del catálogo, que se refresca cada vez que se leen los planes (loadPlanConfigs).
const TOPICS = ["verificad", "producto", "provincia", "envio", "whatsapp", "pedido", "caja", "chat", "usuario", "mesa", "codigo", "oferta", "punto", "correo", "horario", "resena", "destacad", "perfil", "privad"];

export function buildPlanIncludes(config) {
  if (!config) return [];
  const c = config;
  const lines = renderPlanIncludes(c, getPlanFeatureCatalogSync());
  // Un extra que habla de algo que ya está arriba (con otras palabras) se omite para no repetirlo.
  const norm = (t) => t.normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const covered = TOPICS.filter((k) => lines.some((l) => norm(l).includes(k)));
  const extras = (c.features ?? [])
    .map((f) => String(f).trim())
    .filter((f) => f && !/\d/.test(f) && !covered.some((k) => norm(f).includes(k)));
  return [...lines, ...extras];
}
