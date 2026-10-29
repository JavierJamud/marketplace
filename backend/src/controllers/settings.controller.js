import { z } from "zod";
import { join, dirname } from "node:path";
import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { publicCatalog } from "../lib/catalog.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";
import { getAllPlanConfigs, getPlanConfig, buildPlanIncludes, publicPlan, isValidPlanKey, PLAN_KEY_PATTERN } from "../lib/planConfig.js";
import { applyPlanUpdate, planPatchSchema } from "./adminPlans.controller.js";
import { getModelHealthRows, isChatbotHealthy } from "../lib/aiProviderHealth.js";
import { createHeroVariant, smallVariantName } from "../lib/heroVariants.js";
import { forgetPwaEnabled } from "../lib/push.js";
import { connectedCount } from "../lib/realtime.js";
import { clearPublicCache } from "../middleware/publicCache.js";
import { resolveSessionUser } from "../middleware/auth.js";
import { normalizeSocialLinks } from "../lib/socialLinks.js";

// Bloque 294: tope de mesas de cada plan (null = sin tope), para los formularios del restaurante. Solo de los planes que
// quien pide puede ver con detalle (ver plansForViewer).
function tablesLimitByPlan(detailedPlans) {
  return Object.fromEntries(detailedPlans.map((c) => [c.planType, c.maxTables ?? null]));
}

// GET /settings es público. Antes mandaba la fila completa de TODOS los planes no archivados, también los ocultos
// (isPublic=false): cualquier visitante veía precios, topes e interruptores de un plan que el admin no publica (por ejemplo
// uno pactado a mano con una tienda). Ahora la fila completa va solo para los planes públicos, el de la prueba gratis (se
// le ofrece a toda tienda), el plan por defecto, el plan actual de quien pide (dueño o personal de la tienda) y, para el
// admin, todos. Con sesión, el resto de los ocultos viaja solo con su nombre y sus banderas de papel, que hacen falta para
// nombrar el plan de una tienda en cualquier pantalla (planNames). Sin sesión no viajan: ninguna pantalla pública nombra
// un plan oculto, y su nombre puede ser el de un trato hecho a mano con una tienda. Esto exige que el frontend vuelva a
// pedir /settings al iniciar sesión, porque comparte una sola copia guardada (queryKey ["site-settings"]).
async function planViewer(req) {
  const user = await resolveSessionUser(req);
  if (!user) return { anonymous: true, admin: false, planType: null };
  if (user.role === "ADMIN") return { anonymous: false, admin: true, planType: null };
  let vendor = null;
  if (user.role === "VENDOR") {
    vendor = await prisma.vendor.findUnique({ where: { userId: user.id }, select: { planType: true } });
  } else if (user.role === "VENDOR_STAFF") {
    const staff = await prisma.vendorStaff.findUnique({ where: { userId: user.id }, select: { vendor: { select: { planType: true } } } });
    vendor = staff?.vendor ?? null;
  }
  return { anonymous: false, admin: false, planType: vendor?.planType ?? null };
}

// Lo mínimo de un plan oculto que no es de quien pide: sin precios, topes, interruptores ni beneficios. Los arreglos van
// vacíos (no ausentes) para que una pantalla que los recorre no falle.
function hiddenPlanStub(p) {
  return {
    planType: p.planType,
    displayName: p.displayName,
    sortOrder: p.sortOrder,
    isPublic: false,
    isDefault: !!p.isDefault,
    isTrialPlan: !!p.isTrialPlan,
    isFree: !!p.isFree,
    contactOnly: !!p.contactOnly,
    grantsBadge: !!p.grantsBadge,
    highlighted: false,
    archivedAt: null,
    monthDiscounts: [],
    features: [],
    includes: [],
  };
}

async function plansForViewer(req) {
  const [configs, viewer] = await Promise.all([getAllPlanConfigs(), planViewer(req)]);
  const detailed = configs.filter((p) => viewer.admin || p.isPublic || p.isDefault || p.isTrialPlan || p.planType === viewer.planType);
  const detailedKeys = new Set(detailed.map((p) => p.planType));
  const plans = configs
    .filter((p) => !viewer.anonymous || detailedKeys.has(p.planType))
    .map((p) => (detailedKeys.has(p.planType) ? { ...p, includes: buildPlanIncludes(p) } : hiddenPlanStub(p)));
  return { plans, detailed };
}

// El estado de la IA se lee de la base en cada /settings, que pide cada visita: se guarda 15 s en memoria. Las filas de
// salud las actualiza una tarea cada varios minutos, así que no se pierde nada.
let chatbotCache = null;
async function chatbotAvailable() {
  if (chatbotCache && chatbotCache.expires > Date.now()) return chatbotCache.value;
  const value = await isChatbotHealthy();
  chatbotCache = { value, expires: Date.now() + 15_000 };
  return value;
}

// --- Redes de la plataforma (pie del sitio y de los correos) ------------------------------------------------------------
// Antes se guardaban como texto libre y el pie las ponía tal cual en href: un "javascript:..." se ejecutaba en todas las
// páginas y un "instagram.com/x" sin https quedaba como ruta relativa (404). Ahora pasan por la misma normalización que las
// redes de las tiendas (lib/socialLinks.js): solo https del dominio de cada red, el usuario ("@baznova") se completa y un
// número de WhatsApp queda como wa.me.
const BRAND_LINKS = [
  ["whatsappUrl", "whatsapp"],
  ["instagramUrl", "instagram"],
  ["facebookUrl", "facebook"],
];

// Enlaces de WhatsApp sin número que sí abren un chat, un canal o un grupo, y que la plataforma usa de verdad: el enlace
// corto de WhatsApp Business (wa.me/message/<código>, wa.me/qr/<código>; el guardado hoy es uno de estos), un canal
// (whatsapp.com/channel/<id>) y la invitación a un grupo (chat.whatsapp.com/<código>). Se miran ANTES de
// normalizeSocialLinks y no cuando falla: esa función saca los dígitos de toda la ruta de wa.me, así que
// wa.me/message/AB1234567 quedaría como wa.me/1234567, un número equivocado y sin error. Por lo mismo, cualquier otra
// ruta de wa.me que no sea solo el número se rechaza aquí. Devuelve null cuando el enlace es de otro tipo (número,
// wa.me/<número>, api.whatsapp.com/send?phone=...) y lo resuelve normalizeSocialLinks, que también rechaza lo que no abre
// ningún chat (api.whatsapp.com/send sin phone, faq.whatsapp.com/...).
const WA_CODE = "[A-Za-z0-9]{1,100}";
const WA_SHORT_PATH = new RegExp(`^/(message|qr)/${WA_CODE}$`, "i");
const WA_CHANNEL_PATH = new RegExp(`^/channel/${WA_CODE}$`);
const WA_GROUP_PATH = new RegExp(`^/${WA_CODE}$`);
// El número puede venir con guiones o puntos (wa.me/53-5123-4567): normalizeSocialLinks los quita y revisa el largo.
const WA_NUMBER_PATH = /^\/\+?[\d.-]{7,20}$/;

function whatsappLinkWithoutNumber(value) {
  let url;
  try {
    url = new URL(/^https?:\/\//i.test(value) ? value : `https://${value}`);
  } catch {
    return null;
  }
  if (!["http:", "https:"].includes(url.protocol)) return null;
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const path = url.pathname.replace(/\/+$/, "");
  if (host === "wa.me") {
    if (WA_SHORT_PATH.test(path)) return `https://wa.me${path}`;
    if (WA_NUMBER_PATH.test(path)) return null;
    throw new AppError("El enlace de WhatsApp tiene que llevar el número (por ejemplo wa.me/5351234567) o ser el enlace corto de WhatsApp Business (wa.me/message/...).", 400);
  }
  if (host === "whatsapp.com" && WA_CHANNEL_PATH.test(path)) return `https://whatsapp.com${path}`;
  if (host === "chat.whatsapp.com" && WA_GROUP_PATH.test(path)) return `https://chat.whatsapp.com${path}`;
  return null;
}

function brandLink(network, raw) {
  const value = String(raw ?? "").trim();
  if (!value) return null;
  if (network === "whatsapp") {
    const special = whatsappLinkWithoutNumber(value);
    if (special) return special;
  }
  return normalizeSocialLinks({ [network]: value })?.[network]?.url ?? null;
}

// Al leer: un valor guardado antes de esta validación que no la pasa no se publica (null), en vez de llegar al href.
function safeBrandLink(network, stored) {
  try {
    return brandLink(network, stored);
  } catch {
    return null;
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
export const SITE_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "site");

// Fila única de configuración global — se crea al primer uso, nunca hay una
// segunda fila (a diferencia del KYC, esto es público y no tiene owner).
async function getOrCreateSettings() {
  const existing = await prisma.siteSettings.findFirst();
  if (existing) return existing;
  return prisma.siteSettings.create({ data: {} });
}

// --- Modo mantenimiento -----------------------------------------------------------------------------------------------------------
const DEFAULT_MAINTENANCE_MESSAGE = "Estamos mejorando el sitio. Volvemos muy pronto.";

// Estado actual, guardado unos segundos en memoria: el bloqueo del servidor lo consulta en cada petición.
let maintenanceCache = null;
export async function getMaintenanceState() {
  if (maintenanceCache && maintenanceCache.expires > Date.now()) return maintenanceCache.value;
  const s = await getOrCreateSettings();
  const value = { mode: s.maintenanceMode, message: s.maintenanceMessage?.trim() || DEFAULT_MAINTENANCE_MESSAGE, customMessage: s.maintenanceMessage ?? "" };
  maintenanceCache = { value, expires: Date.now() + 3000 };
  return value;
}

// Público: lo lee el sitio para saber si debe mostrar el aviso.
export async function getMaintenance(_req, res) {
  const { mode, message, customMessage } = await getMaintenanceState();
  res.set("Cache-Control", "no-store");
  res.json({ mode, message, customMessage });
}

const maintenanceSchema = z.object({
  mode: z.enum(["OFF", "HOME", "FULL"]),
  message: z.string().trim().max(300, "El mensaje admite hasta 300 caracteres.").optional().nullable(),
});

// Admin: activa, cambia o desactiva el modo mantenimiento.
export async function updateMaintenance(req, res) {
  const data = maintenanceSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  await prisma.siteSettings.update({
    where: { id: settings.id },
    data: { maintenanceMode: data.mode, ...(data.message !== undefined ? { maintenanceMessage: data.message || null } : {}) },
  });
  maintenanceCache = null; // el cambio se aplica de inmediato
  const state = await getMaintenanceState();
  res.json({ mode: state.mode, message: state.message, customMessage: state.customMessage });
}

// Público — Home.jsx lo consulta sin autenticación para pintar el hero.
// También expone los límites por plan (Bloque 19): el panel de vendedor los
// necesita para deshabilitar "+ Agregar" al llegar al tope y mostrar "X/Y".
export async function getSettings(req, res) {
  const [settings, catalog, { plans, detailed }] = await Promise.all([getOrCreateSettings(), publicCatalog(), plansForViewer(req)]);
  // La lista de planes cambia según quién pide (ver plansForViewer): ninguna caché intermedia debe mezclar respuestas.
  // res.vary agrega a la cabecera y no la reemplaza: cors() (app.js) ya puso "Vary: Origin" y tiene que seguir ahí.
  res.vary("Authorization");
  // Bloque 52 (pedido explícito — "debe haber una concordancia con todo...
  // vamos a poder ver toda la configuración real que pueden y que van a
  // tener los vendedores"): los 2 planes completos (límites, interruptores,
  // beneficios, nombre visible) viajan acá — ÚNICA fuente que consume tanto
  // el admin (AdminSubscriptions.jsx) como el vendedor/comprador
  // (VendorVerification.jsx, PlanComparisonModal.jsx, Account.jsx). Antes
  // cada pantalla tenía su propia copia hardcodeada (verificationMeta.js) que
  // podía decir cualquier cosa sin relación con lo que el backend aplicaba.
  // `includes`: lo que incluye cada plan armado con sus límites y funciones reales (ver buildPlanIncludes). `features` sigue
  // siendo el texto libre que edita el admin. Los planes ocultos solo traen el detalle para quien puede verlo
  // (plansForViewer).
  res.json({
    settings: {
      plans,
      heroImages: settings.heroImages,
      allowProductImageLinks: settings.allowProductImageLinks,
      siteName: settings.siteName,
      whatsappUrl: safeBrandLink("whatsapp", settings.whatsappUrl),
      instagramUrl: safeBrandLink("instagram", settings.instagramUrl),
      facebookUrl: safeBrandLink("facebook", settings.facebookUrl),
      // Bloque 75: número crudo (E.164) para el botón "Contactar soporte"
      // que ve un vendedor bloqueado/suspendido — distinto de whatsappUrl
      // (ese es un link libre para el ícono del pie de los correos).
      supportWhatsapp: settings.supportWhatsapp,
      offerCooldownDays: settings.offerCooldownDays,
      offerDefaultDurationDays: settings.offerDefaultDurationDays,
      // Bloque 118: expuesta públicamente para que Product.jsx/Store.jsx
      // puedan mostrar el texto real ("1 comentario por día por producto")
      // en vez de un valor fijo que se desactualiza si el admin la cambia.
      reviewDedupHours: settings.reviewDedupHours,
      maxReviewsPerProductPerPeriod: settings.maxReviewsPerProductPerPeriod,
      maxReviewsPerStorePerPeriod: settings.maxReviewsPerStorePerPeriod,
      vendorsCanReview: settings.vendorsCanReview,
      // Cierre automático de pedidos sin respuesta: el panel de la tienda muestra cuándo se cerraría cada pedido pendiente.
      orderFollowUpEnabled: settings.orderFollowUpEnabled,
      orderAutoCancelHours: settings.orderAutoCancelHours,
      showChatWidget: settings.showChatWidget,
      pwaEnabled: settings.pwaEnabled,
      // Monedas y formas de pago con su nombre visible (ver lib/catalog.js). Las dos listas de abajo son las activas, para
      // las pantallas que solo ofrecen opciones; `catalog` trae todas para mostrar el nombre de cualquier valor guardado.
      catalog,
      productPaymentMethods: catalog.productPayments.filter((o) => o.isActive).map((o) => o.code),
      availableCurrencies: catalog.currencies.filter((o) => o.isActive).map((o) => o.code),
      // Bloque 64: datos de la transferencia CUP para la suscripción del
      // Plan Business — VendorVerification.jsx/PagoManual.jsx los muestran
      // tal cual, nunca un dato inventado (null = "contacta al equipo").
      cupBankAccountNumber: settings.cupBankAccountNumber,
      cupBankAccountHolder: settings.cupBankAccountHolder,
      cupBankInstructions: settings.cupBankInstructions,
      // Bloque 52 (pedido explícito): teléfono por el que el cliente puede
      // verificar/notificar su pago — opcional, solo para copiar.
      cupBankPhone: settings.cupBankPhone,
      // Los precios de cada plan viven en PlanConfig (Suscripciones > planes). Los viejos cupSubscriptionPriceCup y
      // cardSubscriptionPriceUsd de SiteSettings ya no se editan ni se leen: dejaron de viajar aquí.
      // Días de la prueba gratis: los textos de la oferta y del panel lo muestran tal cual.
      trialDays: settings.trialDays,
      // Días sin pagar hasta que una tienda queda suspendida (planBilling.service.js).
      unpaidSuspendDays: settings.unpaidSuspendDays,
      // Bloque 66: catálogo de etiquetas que un vendedor puede elegir para
      // un producto — "Nuevo" es fijo del sistema, no viaja en esta lista
      // (ver assertBadgeAllowed en products.controller.js).
      availableProductBadges: settings.availableProductBadges,
      newBadgeDurationDays: settings.newBadgeDurationDays,
      // Bloque 85: zona horaria del negocio — hoy solo la consume
      // aiHealthCheck.job.js (ver getSiteTimezone más abajo), expuesta acá
      // para que AdminBranding.jsx la lea/edite igual que el resto de esta
      // pantalla.
      timezone: settings.timezone,
      // Bloque 238 (pedido explícito): si al menos un proveedor de IA está
      // respondiendo de verdad en este momento (estado cacheado, ver
      // lib/aiProviderHealth.js) — Home.jsx lo usa para ocultar el botón de
      // chat cuando los 3 proveedores están caídos, en vez de dejar que el
      // cliente le escriba a un chat que ya se sabe que va a fallar.
      chatbotAvailable: await chatbotAvailable(),
      // Bloque 294: tope de mesas de cada plan (null = sin tope) para que los formularios de registro y de
      // configuración del restaurante no dejen escribir más de lo que el plan permite.
      maxTablesByPlan: tablesLimitByPlan(detailed),
      // Bloque 237: política de "Venta rápida" (anuncios clasificados de
      // clientes) — la necesitan tanto AdminOffers.jsx (tarjeta nueva) como
      // CustomerPanel.jsx (texto dinámico del ciclo de vida en 2 etapas).
      maxActiveListingsPerCustomer: settings.maxActiveListingsPerCustomer,
      maxNewListingsPerDay: settings.maxNewListingsPerDay,
      listingPublicVisibilityDays: settings.listingPublicVisibilityDays,
      listingExpiryDays: settings.listingExpiryDays,
      maxListingImages: settings.maxListingImages,
    },
  });
}

// Bloque 51: uso INTERNO (offers.controller.js/adminOffers.controller.js) —
// mismo criterio que getBrandSettings: nunca una ruta
// HTTP directa, cualquier controller que necesite la política de ofertas la
// llama en vez de hardcodear los días de cooldown/duración.
export async function getOfferPolicy() {
  const settings = await getOrCreateSettings();
  return { cooldownDays: settings.offerCooldownDays, defaultDurationDays: settings.offerDefaultDurationDays };
}

// Bloque 232 (pedido explícito — "quiero poder cambiar desde el panel de
// admin si los vendedores pueden tener una oferta activa en su tienda o
// pueden tener más de una"): uso INTERNO (storeOffers.controller.js), nunca
// una ruta HTTP directa. Distinta política: esto es sobre StoreOffer
// (ofertas DENTRO de la tienda), no sobre Offer (Home). Bloque 52: el
// límite pasó de un solo valor global (SiteSettings) a uno POR PLAN
// (PlanConfig.maxActiveStoreOffers) — por eso ahora pide el planType.
export async function getStoreOfferPolicy(planType) {
  const config = await getPlanConfig(planType);
  // Un plan sin ofertas tiene tope 0 aunque su maxActiveStoreOffers guarde un
  // número (el admin apagó el interruptor sin borrar el límite): antes este
  // valor decía "sin tope" o el número viejo en un plan que no las incluye.
  if (!config?.allowStoreOffers) return { maxActive: 0 };
  return { maxActive: config.maxActiveStoreOffers ?? null };
}

// Días de la prueba gratis del Plan Premium que edita el admin en Suscripciones. Se lee al activar cada prueba, así que un
// cambio solo afecta a las pruebas que se activen después; las que ya corren conservan su fecha de fin.
export async function getTrialDays() {
  const settings = await getOrCreateSettings();
  return settings.trialDays ?? 30;
}

// Bloque 118: mismo criterio que getOfferPolicy de arriba — uso INTERNO
// (reviews.controller.js), nunca una ruta HTTP directa.
export async function getReviewPolicy() {
  const settings = await getOrCreateSettings();
  return {
    dedupHours: settings.reviewDedupHours,
    maxPerProduct: settings.maxReviewsPerProductPerPeriod,
    maxPerStore: settings.maxReviewsPerStorePerPeriod,
    vendorsCanReview: settings.vendorsCanReview,
  };
}

// Bloque 52: un solo endpoint guarda la fila de PlanConfig del plan indicado (límites, interruptores, beneficios, nombre
// visible). `.optional()` en cada campo porque AdminSubscriptions.jsx guarda cada tarjeta de plan por separado.
// Con los planes dinámicos la validación y los efectos viven en adminPlans.controller.js (applyPlanUpdate), compartidos con
// PATCH /admin/plans/:key: así la pantalla vieja y la nueva aplican las mismas reglas (isFree y contactOnly excluyentes,
// descuentos de 2 a 24 meses, tope de beneficios, confirmación al cambiar la insignia o al dejar de cobrar). La clave ya no
// es una lista fija de 4 planes: cualquier plan que exista (PLAN_KEY_PATTERN + isValidPlanKey).
// Se arma al primer uso y no al cargar el módulo: adminPlans.controller.js llega a este archivo por una cadena de imports
// (servicios de planes y de cobro), y según cuál se cargue primero planPatchSchema todavía no existiría aquí.
let planConfigSchema = null;
const getPlanConfigSchema = () =>
  (planConfigSchema ??= planPatchSchema.extend({ planType: z.string().regex(PLAN_KEY_PATTERN, "Plan no encontrado.") }));

export async function listPlanConfigs(_req, res) {
  res.json({ plans: await getAllPlanConfigs() });
}

export async function updatePlanConfig(req, res) {
  const { planType, ...data } = getPlanConfigSchema().parse(req.body);
  // Los archivados existen (para el historial), pero applyPlanUpdate responde 409 y pide restaurarlos antes de editarlos.
  if (!(await isValidPlanKey(planType, { allowArchived: true }))) throw new AppError("Plan no encontrado.", 404);
  res.json(await applyPlanUpdate(planType, data, { actorId: req.user?.id ?? null }));
}

const productSettingsSchema = z.object({
  allowProductImageLinks: z.boolean(),
});

// Admin (AdminLocations.jsx) — endpoint propio en vez de sumarse a
// updatePlanLimits/updatePlanFeatures: mismo criterio de esos dos, esto no es
// un límite numérico ni una lista de features, es un switch de moderación de
// contenido de producto.
export async function updateProductSettings(req, res) {
  const data = productSettingsSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({ settings: { allowProductImageLinks: updated.allowProductImageLinks } });
}

const chatWidgetSchema = z.object({ showChatWidget: z.boolean() });

// Admin ("Marca de la plataforma") — Home.jsx monta MarketplaceChatWidget
// condicionado a este flag (antes siempre visible, sin forma de apagarlo).
export async function updateChatWidgetSettings(req, res) {
  const data = chatWidgetSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({ settings: { showChatWidget: updated.showChatWidget } });
}

// Interruptor de emergencia de la PWA: apagado, los dispositivos desinstalan el service worker y vacían su caché al siguiente acceso, y
// el servidor deja de enviar avisos push.
const pwaSchema = z.object({ pwaEnabled: z.boolean() });

// Estado de la PWA para el admin: si está encendida, cuántos dispositivos reciben avisos (por aplicación) y cuántas pantallas
// están conectadas en vivo ahora mismo.
export async function getPwaStatus(_req, res) {
  const settings = await getOrCreateSettings();
  const byApp = await prisma.pushSubscription.groupBy({ by: ["app"], _count: { _all: true } });
  const devices = Object.fromEntries(byApp.map((r) => [r.app, r._count._all]));
  res.json({ pwaEnabled: settings.pwaEnabled, devices, connected: connectedCount() });
}

export async function updatePwaSettings(req, res) {
  const { pwaEnabled } = pwaSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data: { pwaEnabled } });
  forgetPwaEnabled();
  clearPublicCache();
  res.json({ settings: { pwaEnabled: updated.pwaEnabled } });
}

// Recordatorios automáticos a clientes (jobs/customerReminders.job.js): interruptor general y cuántos salieron en 30 días.
export async function getCustomerRemindersStatus(_req, res) {
  const settings = await getOrCreateSettings();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const sent = await prisma.emailLog.groupBy({ by: ["type"], where: { type: { in: ["CART_REMINDER", "STORE_REMINDER"] }, status: "SENT", createdAt: { gte: since } }, _count: { _all: true } });
  const optedOut = await prisma.user.count({ where: { role: "CUSTOMER", marketingEmails: false } });
  const byType = Object.fromEntries(sent.map((r) => [r.type, r._count._all]));
  res.json({ enabled: settings.customerRemindersEnabled, cart30d: byType.CART_REMINDER ?? 0, store30d: byType.STORE_REMINDER ?? 0, optedOut });
}

export async function updateCustomerRemindersSettings(req, res) {
  const { enabled } = z.object({ enabled: z.boolean() }).parse(req.body);
  const settings = await getOrCreateSettings();
  await prisma.siteSettings.update({ where: { id: settings.id }, data: { customerRemindersEnabled: enabled } });
  res.json({ enabled });
}

// --- Pedidos que la tienda no responde ------------------------------------------------------------------------------------------
// Uso interno (jobs/orderOverdue.job.js, services/orderFollowUp.service.js): si está activo y a cuántas horas va cada aviso.
export async function getOrderFollowUpPolicy() {
  const s = await getOrCreateSettings();
  return { enabled: s.orderFollowUpEnabled, reminderHours: s.orderReminderHours, warningHours: s.orderCancelWarningHours, cancelHours: s.orderAutoCancelHours };
}

// Pedido detenido: a cuántas horas sin cambiar de estado se avisa a la tienda y al cliente (services/orderDelay.service.js).
export async function getOrderDelayPolicy() {
  const s = await getOrCreateSettings();
  return { delayEnabled: s.orderDelayEnabled, delayHours: s.orderDelayHours };
}

// Admin > Configuración > Tiendas y productos. Junto a los ajustes van las cifras reales de los últimos 30 días.
export async function getOrderFollowUpSettings(_req, res) {
  const policy = await getOrderFollowUpPolicy();
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const delay = await getOrderDelayPolicy();
  const [waiting, reminded, autoCancelled, reactivated, delayed] = await Promise.all([
    prisma.order.count({ where: { status: "NEW", channel: { not: "TABLE" }, createdAt: { lte: new Date(Date.now() - policy.reminderHours * 3600_000) } } }),
    prisma.order.count({ where: { pendingReminderAt: { gte: since } } }),
    prisma.orderEvent.count({ where: { type: "AUTO_CANCELLED", createdAt: { gte: since } } }),
    prisma.orderEvent.count({ where: { type: "REACTIVATED", createdAt: { gte: since } } }),
    prisma.orderEvent.count({ where: { type: "DELAY_NOTICE", createdAt: { gte: since } } }),
  ]);
  res.json({ ...policy, ...delay, stats: { waiting, reminded30d: reminded, autoCancelled30d: autoCancelled, reactivated30d: reactivated, delayed30d: delayed } });
}

const orderFollowUpSchema = z
  .object({
    enabled: z.boolean(),
    reminderHours: z.number().int().min(1).max(336),
    warningHours: z.number().int().min(2).max(336),
    cancelHours: z.number().int().min(3).max(336),
    delayEnabled: z.boolean().optional(),
    delayHours: z.number().int().min(1).max(720).optional(),
  })
  .refine((d) => d.reminderHours < d.warningHours && d.warningHours < d.cancelHours, {
    message: "Las horas tienen que ir en orden: primero el recordatorio, después el aviso y al final el cierre.",
  });

export async function updateOrderFollowUpSettings(req, res) {
  const d = orderFollowUpSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  await prisma.siteSettings.update({
    where: { id: settings.id },
    data: {
      orderFollowUpEnabled: d.enabled,
      orderReminderHours: d.reminderHours,
      orderCancelWarningHours: d.warningHours,
      orderAutoCancelHours: d.cancelHours,
      ...(d.delayEnabled !== undefined ? { orderDelayEnabled: d.delayEnabled } : {}),
      ...(d.delayHours !== undefined ? { orderDelayHours: d.delayHours } : {}),
    },
  });
  clearPublicCache();
  res.json({ ...(await getOrderFollowUpPolicy()), ...(await getOrderDelayPolicy()) });
}

const offerPolicySchema = z.object({
  offerCooldownDays: z.number().int().min(1).max(365),
  offerDefaultDurationDays: z.number().int().min(1).max(365),
});

// Admin (AdminOffers.jsx) — cada cuántos días un vendedor verificado puede
// publicar/republicar una oferta, y cuánto dura activa por default. Endpoint
// propio (no sumado a updatePlanLimits) por el mismo criterio que
// updateProductSettings: es una política de ofertas, no un límite de plan.
export async function updateOfferPolicy(req, res) {
  const data = offerPolicySchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({ settings: { offerCooldownDays: updated.offerCooldownDays, offerDefaultDurationDays: updated.offerDefaultDurationDays } });
}

// Bloque 237 (pedido explícito): política de "Venta rápida" — mismo molde
// que offerPolicySchema de arriba. El .refine() evita configurar una
// visibilidad pública más larga que la vida total del anuncio, cosa que no
// tendría sentido (el anuncio se borraría antes de dejar de ser público).
const listingPolicySchema = z
  .object({
    maxActiveListingsPerCustomer: z.number().int().min(1).max(100),
    maxNewListingsPerDay: z.number().int().min(1).max(50),
    listingPublicVisibilityDays: z.number().int().min(1).max(365),
    listingExpiryDays: z.number().int().min(1).max(365),
    maxListingImages: z.number().int().min(1).max(10),
  })
  .refine((data) => data.listingPublicVisibilityDays <= data.listingExpiryDays, {
    message: "La visibilidad pública no puede durar más que la vida total del anuncio.",
    path: ["listingPublicVisibilityDays"],
  });

// Admin (AdminOffers.jsx, misma sección que la política de Ofertas) — tope
// de anuncios activos y nuevos por día que puede tener un cliente en "Venta
// rápida", y a los cuántos días deja de mostrarse al público / se borra solo
// (ver getListingPolicy, uso interno de customerListings.controller.js).
export async function updateListingPolicy(req, res) {
  const data = listingPolicySchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({
    settings: {
      maxActiveListingsPerCustomer: updated.maxActiveListingsPerCustomer,
      maxNewListingsPerDay: updated.maxNewListingsPerDay,
      listingPublicVisibilityDays: updated.listingPublicVisibilityDays,
      listingExpiryDays: updated.listingExpiryDays,
      maxListingImages: updated.maxListingImages,
    },
  });
}

// Reglas de moderación por reportes (ver lib/moderation.js). Solo el admin las ve: no se publican en /settings para que
// nadie calcule cuánto puede abusar antes de un bloqueo.
const MODERATION_FIELDS = ["fraudReportEvidenceDeadlineDays", "suspendedItemAppealDays", "customerStrikeLimit", "customerClaimDays", "vendorStrikeLimit", "vendorSupportContactDays", "vendorFraudSuspensionDays"];
const moderationSchema = z.object({
  fraudReportEvidenceDeadlineDays: z.number().int().min(1).max(60),
  suspendedItemAppealDays: z.number().int().min(1).max(365),
  customerStrikeLimit: z.number().int().min(1).max(50),
  customerClaimDays: z.number().int().min(1).max(365),
  vendorStrikeLimit: z.number().int().min(1).max(50),
  vendorSupportContactDays: z.number().int().min(1).max(365),
  vendorFraudSuspensionDays: z.number().int().min(1).max(730),
});
const pickModeration = (s) => Object.fromEntries(MODERATION_FIELDS.map((f) => [f, s[f]]));

export async function getModerationSettingsAdmin(_req, res) {
  res.json({ settings: pickModeration(await getOrCreateSettings()) });
}

export async function updateModerationSettings(req, res) {
  const data = moderationSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({ settings: pickModeration(updated) });
}

// Uso INTERNO (customerListings.controller.js) — mismo criterio que
// getOfferPolicy de arriba.
export async function getListingPolicy() {
  const settings = await getOrCreateSettings();
  return {
    maxActive: settings.maxActiveListingsPerCustomer,
    maxNewPerDay: settings.maxNewListingsPerDay,
    publicVisibilityDays: settings.listingPublicVisibilityDays,
    expiryDays: settings.listingExpiryDays,
    maxImages: settings.maxListingImages,
  };
}

const reviewPolicySchema = z.object({
  reviewDedupHours: z.number().int().min(1).max(720),
  maxReviewsPerProductPerPeriod: z.number().int().min(1).max(100),
  maxReviewsPerStorePerPeriod: z.number().int().min(1).max(100),
  vendorsCanReview: z.boolean(),
});

// Admin (AdminReviews.jsx) — cada cuánto (horas) se resetea el tope de
// comentarios/reseñas por cuenta, cuántos puede dejar por producto y por
// tienda (general, sin producto) dentro de esa ventana, y si las cuentas
// VENDOR pueden comentar/reseñar en absoluto (ver createReview en
// reviews.controller.js, que llama getReviewPolicy en vez de tener esto
// hardcodeado).
export async function updateReviewPolicy(req, res) {
  const data = reviewPolicySchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({
    settings: {
      reviewDedupHours: updated.reviewDedupHours,
      maxReviewsPerProductPerPeriod: updated.maxReviewsPerProductPerPeriod,
      maxReviewsPerStorePerPeriod: updated.maxReviewsPerStorePerPeriod,
      vendorsCanReview: updated.vendorsCanReview,
    },
  });
}

const brandingSchema = z.object({
  siteName: z.string().trim().min(1).optional(),
  // Bloque 61: "" borra, undefined no toca (mismo criterio para las 3). El formato se valida y normaliza en updateBranding
  // con brandLink (solo https del dominio de cada red), que responde 400 con el motivo.
  whatsappUrl: z.string().trim().max(300, "El enlace es demasiado largo.").optional().nullable(),
  instagramUrl: z.string().trim().max(300, "El enlace es demasiado largo.").optional().nullable(),
  facebookUrl: z.string().trim().max(300, "El enlace es demasiado largo.").optional().nullable(),
  // Bloque 75: a diferencia de whatsappUrl (link libre), este SÍ se valida
  // en formato E.164 — hace falta un número crudo, no un link, para poder
  // armarle un mensaje prellenado al botón "Contactar soporte".
  supportWhatsapp: z.union([z.string().regex(/^\+\d{7,15}$/, "Incluye el código de país (ej. +5355512345)."), z.literal("")]).optional().nullable(),
  // Bloque 85: se valida que sea una zona IANA real intentando construir un
  // Intl.DateTimeFormat con ella — un string cualquiera ("Cuba", "GMT-5"
  // mal tipeado) rompería silenciosamente el cálculo de "son las 3am" en
  // aiHealthCheck.job.js si se guardara tal cual.
  timezone: z
    .string()
    .trim()
    .refine((tz) => {
      try {
        new Intl.DateTimeFormat("en-US", { timeZone: tz });
        return true;
      } catch {
        return false;
      }
    }, "Zona horaria inválida.")
    .optional(),
});

// Admin ("Marca de la plataforma") — nombre de la plataforma. El logo ya
// no se administra acá (ver el comentario largo en usePlatformSettings.js,
// frontend) — es un asset fijo del código.
export async function updateBranding(req, res) {
  const data = brandingSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const update = {};
  if (data.siteName !== undefined) update.siteName = data.siteName;
  for (const [field, network] of BRAND_LINKS) {
    if (data[field] !== undefined) update[field] = brandLink(network, data[field]);
  }
  if (data.supportWhatsapp !== undefined) update.supportWhatsapp = data.supportWhatsapp || null;
  if (data.timezone !== undefined) update.timezone = data.timezone;
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data: update });
  res.json({
    settings: {
      siteName: updated.siteName,
      whatsappUrl: updated.whatsappUrl,
      instagramUrl: updated.instagramUrl,
      facebookUrl: updated.facebookUrl,
      supportWhatsapp: updated.supportWhatsapp,
      timezone: updated.timezone,
    },
  });
}

// Bloque 85: uso INTERNO (aiHealthCheck.job.js) — mismo criterio que
// getBrandSettings de arriba, nunca una ruta HTTP.
export async function getSiteTimezone() {
  const settings = await getOrCreateSettings();
  return settings.timezone || "America/Havana";
}

const cupPaymentSettingsSchema = z.object({
  cupBankAccountNumber: z.string().trim().optional().nullable(),
  cupBankAccountHolder: z.string().trim().optional().nullable(),
  cupBankInstructions: z.string().trim().optional().nullable(),
  // Bloque 52 (pedido explícito — "agregar también un número de teléfono...
  // no será obligatorio"): mismo criterio opcional que el resto de estos
  // datos — el vendedor solo lo copia, nunca lo escribe.
  cupBankPhone: z.string().trim().optional().nullable(),
  trialDays: z.number().int().min(1, "La prueba debe durar al menos 1 día.").max(365, "La prueba puede durar hasta 365 días.").optional(),
  unpaidSuspendDays: z.number().int().min(1, "Al menos 1 día.").max(365, "Hasta 365 días.").optional(),
});

// Admin — datos bancarios de la transferencia CUP + precio mensual de la
// suscripción en las 2 monedas, editables sin redeploy (Bloque 64, reemplaza
// el "CI: 9205-XXXX-XXXX" que estaba a mano en VendorVerification.jsx;
// Bloque 150 suma el precio USD que antes era una constante en lib/stripe.js).
export async function updateCupPaymentSettings(req, res) {
  const data = cupPaymentSettingsSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const update = {};
  if (data.cupBankAccountNumber !== undefined) update.cupBankAccountNumber = data.cupBankAccountNumber || null;
  if (data.cupBankAccountHolder !== undefined) update.cupBankAccountHolder = data.cupBankAccountHolder || null;
  if (data.cupBankInstructions !== undefined) update.cupBankInstructions = data.cupBankInstructions || null;
  if (data.cupBankPhone !== undefined) update.cupBankPhone = data.cupBankPhone || null;
  if (data.trialDays !== undefined) update.trialDays = data.trialDays;
  if (data.unpaidSuspendDays !== undefined) update.unpaidSuspendDays = data.unpaidSuspendDays;
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data: update });
  res.json({
    settings: {
      cupBankAccountNumber: updated.cupBankAccountNumber,
      cupBankAccountHolder: updated.cupBankAccountHolder,
      cupBankInstructions: updated.cupBankInstructions,
      cupBankPhone: updated.cupBankPhone,
      trialDays: updated.trialDays,
      unpaidSuspendDays: updated.unpaidSuspendDays,
    },
  });
}

// "Nuevo" no se incluye acá — es fijo del sistema, siempre disponible,
// nunca desactivable (ver assertBadgeAllowed en products.controller.js).
// Nunca puede quedar sin al menos 1 entrada además de "Nuevo" — no es un
// requisito duro (a diferencia de availableCurrencies), un vendedor
// simplemente se queda solo con "Nuevo"/"Sin etiqueta" si el admin las
// borra todas.
const productBadgeSettingsSchema = z.object({
  availableProductBadges: z.array(z.string().trim().min(1)).max(20, "Máximo 20 etiquetas."),
  newBadgeDurationDays: z.number().int().min(1).max(365),
});

// Admin ("Marca de la plataforma") — catálogo administrable de etiquetas de
// producto + cuántos días dura "Nuevo" antes de desaparecer sola.
export async function updateProductBadgeSettings(req, res) {
  const data = productBadgeSettingsSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({ settings: { availableProductBadges: updated.availableProductBadges, newBadgeDurationDays: updated.newBadgeDurationDays } });
}

// Imágenes del Hero de la Home: se agregan al arreglo existente (una o varias juntas) sin reemplazarlo entero. Son públicas por
// diseño (se sirven con express.static, ver app.js), a diferencia de las fotos de verificación.
export async function addHeroImages(req, res) {
  if (!req.files?.length) throw new AppError("Sube al menos una imagen para el hero.", 400);

  const newUrls = req.files.map((f) => `/uploads/site/${f.filename}`);
  // Versión pequeña para celulares (si falla, el sitio usa la original).
  await Promise.all(req.files.map((f) => createHeroVariant(SITE_UPLOAD_DIR, f.filename).catch(() => {})));
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({
    where: { id: settings.id },
    data: { heroImages: [...settings.heroImages, ...newUrls] },
  });
  res.status(201).json({ settings: { heroImages: updated.heroImages } });
}

const removeHeroImageSchema = z.object({ url: z.string().min(1) });

export async function removeHeroImage(req, res) {
  const { url } = removeHeroImageSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  if (!settings.heroImages.includes(url)) throw new AppError("Esa imagen no está en el hero.", 404);

  const nextImages = settings.heroImages.filter((u) => u !== url);
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data: { heroImages: nextImages } });

  // Se borra también el archivo, sin bloquear la respuesta si falla.
  const filename = url.split("/").pop();
  unlink(join(SITE_UPLOAD_DIR, filename)).catch(() => {});
  unlink(join(SITE_UPLOAD_DIR, smallVariantName(filename))).catch(() => {});

  res.json({ settings: { heroImages: updated.heroImages } });
}

// Bloque 49: uso INTERNO (emails, PDFs, prompts de IA, mensajes de error) —
// mismo criterio que getBrandSettings: nunca una ruta HTTP
// directa, cualquier módulo que necesite el nombre/logo de la plataforma
// para mostrarlo fuera de la app (un correo, un PDF, el system prompt del
// chatbot) llama esto en vez de hardcodear "ZeuDin".
export async function getBrandSettings() {
  const settings = await getOrCreateSettings();
  // Bloque 46: el logo ya no vive en la base — es un asset fijo, servido
  // por app.js en /brand/logo.png (ver el comentario largo ahí). Siempre
  // presente, nunca null — usado como fallback de og:image en
  // og.controller.js. emailShell() (templates/_shared.js) NO usa este
  // campo para el logo de la plataforma — lee el mismo archivo directo del
  // disco para incrustarlo, en vez de pedírselo a esta URL.
  const logoUrl = `${env.backendUrl}/brand/logo.png`;
  return {
    siteName: settings.siteName || "ZeuDin",
    logoUrl,
    // Pie de los correos: un valor viejo que no pasa la validación de redes no se pone en un enlace (ver safeBrandLink).
    whatsappUrl: safeBrandLink("whatsapp", settings.whatsappUrl),
    instagramUrl: safeBrandLink("instagram", settings.instagramUrl),
    facebookUrl: safeBrandLink("facebook", settings.facebookUrl),
  };
}

// Bloque 238/245 — Admin: estado real de cada MODELO de IA (healthy/down/inactive), para que el admin lo confirme de un
// vistazo junto al badge "Activo/Inactivo" que ya existe — no reemplaza el
// correo de aviso (notifyAdminActionNeeded), es solo para consulta visual.
export async function getAdminAiProviderHealth(req, res) {
  const health = await getModelHealthRows();
  res.json({ health });
}

// Cifras públicas del panel de bienvenida (Account.jsx): países activos en el admin (todos, tengan tiendas o no) y
// categorías de negocio disponibles para abrir una tienda y comprar. Solo números reales de la base, nada escrito a mano.
export async function getPublicStats(_req, res) {
  const [countries, categories] = await Promise.all([
    prisma.country.count({ where: { isActive: true } }),
    prisma.businessCategory.count({ where: { active: true } }),
  ]);
  res.json({ countries, categories });
}

// GET /settings/plans: lo que muestra la página pública de planes. Los planes ocultos (isPublic=false) no salen; el
// Empresarial lleva el WhatsApp de soporte para contratarlo.
export async function getPublicPlans(_req, res) {
  const [plans, settings] = await Promise.all([getAllPlanConfigs(), getOrCreateSettings()]);
  res.json({
    plans: plans.filter((p) => p.isPublic).map(publicPlan),
    supportWhatsapp: settings.supportWhatsapp ?? null,
    trialDays: settings.trialDays,
  });
}

// Cuántas tiendas tiene cada plan (sin las eliminadas), para el admin.
export async function planVendorCounts(_req, res) {
  const rows = await prisma.vendor.groupBy({ by: ["planType"], where: { deletedAt: null }, _count: { _all: true } });
  res.json({ counts: Object.fromEntries(rows.map((r) => [r.planType, r._count._all])) });
}
