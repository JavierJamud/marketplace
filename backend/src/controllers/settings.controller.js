import { z } from "zod";
import { join, dirname } from "node:path";
import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";
import { getAllPlanConfigs, getPlanConfig, invalidatePlanConfigCache, recalcVendorProductQuota } from "../lib/planConfig.js";
import { getModelHealthRows, isChatbotHealthy } from "../lib/aiProviderHealth.js";

// Bloque 294: tope de mesas de cada plan (null = sin tope), para los formularios del restaurante.
async function tablesLimitByPlan() {
  const configs = await getAllPlanConfigs();
  return Object.fromEntries(configs.map((c) => [c.planType, c.maxTables ?? null]));
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

// Público — Home.jsx lo consulta sin autenticación para pintar el hero.
// También expone los límites por plan (Bloque 19): el panel de vendedor los
// necesita para deshabilitar "+ Agregar" al llegar al tope y mostrar "X/Y".
export async function getSettings(_req, res) {
  const settings = await getOrCreateSettings();
  // Bloque 52 (pedido explícito — "debe haber una concordancia con todo...
  // vamos a poder ver toda la configuración real que pueden y que van a
  // tener los vendedores"): los 2 planes completos (límites, interruptores,
  // beneficios, nombre visible) viajan acá — ÚNICA fuente que consume tanto
  // el admin (AdminSubscriptions.jsx) como el vendedor/comprador
  // (VendorVerification.jsx, PlanComparisonModal.jsx, Account.jsx). Antes
  // cada pantalla tenía su propia copia hardcodeada (verificationMeta.js) que
  // podía decir cualquier cosa sin relación con lo que el backend aplicaba.
  const plans = await getAllPlanConfigs();
  res.json({
    settings: {
      plans,
      allowProductImageLinks: settings.allowProductImageLinks,
      siteName: settings.siteName,
      whatsappUrl: settings.whatsappUrl,
      instagramUrl: settings.instagramUrl,
      facebookUrl: settings.facebookUrl,
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
      showChatWidget: settings.showChatWidget,
      productPaymentMethods: settings.productPaymentMethods,
      // Bloque 65: de qué conjunto puede elegir una tienda su moneda
      // operativa única al registrarse o cambiarla después.
      availableCurrencies: settings.availableCurrencies,
      // Bloque 64: datos de la transferencia CUP para la suscripción del
      // Plan Business — VendorVerification.jsx/PagoManual.jsx los muestran
      // tal cual, nunca un dato inventado (null = "contacta al equipo").
      cupBankAccountNumber: settings.cupBankAccountNumber,
      cupBankAccountHolder: settings.cupBankAccountHolder,
      cupBankInstructions: settings.cupBankInstructions,
      // Bloque 52 (pedido explícito): teléfono por el que el cliente puede
      // verificar/notificar su pago — opcional, solo para copiar.
      cupBankPhone: settings.cupBankPhone,
      cupSubscriptionPriceCup: settings.cupSubscriptionPriceCup,
      // Bloque 150: precio mensual del cobro con tarjeta (Stripe) — antes
      // una constante hardcodeada, ahora editable junto al precio CUP.
      cardSubscriptionPriceUsd: settings.cardSubscriptionPriceUsd,
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
      chatbotAvailable: await isChatbotHealthy(),
      // Bloque 294: tope de mesas de cada plan (null = sin tope) para que los formularios de registro y de
      // configuración del restaurante no dejen escribir más de lo que el plan permite.
      maxTablesByPlan: await tablesLimitByPlan(),
      // Bloque 237: política de "Venta rápida" (anuncios clasificados de
      // clientes) — la necesitan tanto AdminOffers.jsx (tarjeta nueva) como
      // CustomerPanel.jsx (texto dinámico del ciclo de vida en 2 etapas).
      maxActiveListingsPerCustomer: settings.maxActiveListingsPerCustomer,
      maxNewListingsPerDay: settings.maxNewListingsPerDay,
      listingPublicVisibilityDays: settings.listingPublicVisibilityDays,
      listingExpiryDays: settings.listingExpiryDays,
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
  return { maxActive: config?.maxActiveStoreOffers ?? null };
}

// Bloque 150: uso INTERNO (verification.controller.js/admin.controller.js)
// — mismo criterio que getBrandSettings/getReviewPolicy, nunca una ruta
// HTTP directa. Único lugar que resuelve "precio por mes" para calcular el
// monto esperado de una suscripción — así nunca se desincroniza del precio
// vigente que el admin edita en AdminSubscriptions.jsx.
export async function getSubscriptionPricing() {
  const settings = await getOrCreateSettings();
  return { cupPricePerMonth: settings.cupSubscriptionPriceCup, cardPricePerMonthUsd: settings.cardSubscriptionPriceUsd };
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

// Bloque 52 (pedido explícito — "todo por el estilo... configuración de las
// suscripciones, donde se podrá configurar todo"): reemplaza a
// updatePlanLimits/updatePlanFeatures — un solo endpoint que guarda TODA la
// fila de PlanConfig del plan indicado (límites, interruptores, beneficios,
// nombre visible), en vez de 2 endpoints separados sobre columnas pareadas
// sueltas de SiteSettings. `.optional()` en cada campo porque
// AdminSubscriptions.jsx guarda cada tarjeta de plan por separado — un
// request nunca manda las ~20 columnas, solo las que esa tarjeta edita.
const planConfigSchema = z.object({
  planType: z.enum(["REGULAR", "BUSINESS"]),
  displayName: z.string().trim().min(1).max(40).optional(),
  features: z.array(z.string().trim().min(1)).optional(),
  maxProducts: z.number().int().min(0).optional().nullable(),
  maxProvinces: z.number().int().min(0).optional().nullable(),
  maxDeliveryCountries: z.number().int().min(0).optional().nullable(),
  maxMonthlyOrderEmails: z.number().int().min(0).optional().nullable(),
  maxStaffUsers: z.number().int().min(0).optional().nullable(),
  maxTables: z.number().int().min(0).optional().nullable(),
  maxActiveStoreOffers: z.number().int().min(0).optional().nullable(),
  maxDiscountCodes: z.number().int().min(0).optional().nullable(),
  allowAiChatbot: z.boolean().optional(),
  allowHomeOffers: z.boolean().optional(),
  allowStoreOffers: z.boolean().optional(),
  allowDiscountCodes: z.boolean().optional(),
  allowQrTables: z.boolean().optional(),
  allowStaffUsers: z.boolean().optional(),
  allowAdminChat: z.boolean().optional(),
  allowReviewPhotos: z.boolean().optional(),
  allowSchedules: z.boolean().optional(),
  allowPublicProfile: z.boolean().optional(),
  allowWhatsappOrders: z.boolean().optional(),
  allowPanelOrders: z.boolean().optional(),
  featuredInHome: z.boolean().optional(),
});

export async function listPlanConfigs(_req, res) {
  res.json({ plans: await getAllPlanConfigs() });
}

export async function updatePlanConfig(req, res) {
  const { planType, ...data } = planConfigSchema.parse(req.body);
  // Al menos un destino de pedido tiene que seguir habilitado — un plan sin
  // WhatsApp NI panel dejaría a sus tiendas sin ninguna forma de recibir
  // pedidos, un estado roto que ningún formulario debería poder guardar.
  const current = await getPlanConfig(planType);
  const nextWhatsapp = data.allowWhatsappOrders ?? current?.allowWhatsappOrders ?? true;
  const nextPanel = data.allowPanelOrders ?? current?.allowPanelOrders ?? true;
  if (!nextWhatsapp && !nextPanel) {
    throw new AppError("Un plan necesita al menos un destino de pedidos habilitado (WhatsApp o panel).", 400);
  }

  const updated = await prisma.planConfig.update({ where: { planType }, data });
  invalidatePlanConfigCache();

  // Bloque 52 (pedido explícito — al bajar maxProducts, "se muestran solo
  // los últimos productos del límite... los demás quedan en el panel"):
  // recalcula el cupo de TODAS las tiendas de este plan — nunca solo al
  // crear/editar un producto puntual, porque el límite cambió para todas a
  // la vez acá.
  if (data.maxProducts !== undefined) {
    const vendorIds = await prisma.vendor.findMany({ where: { planType }, select: { id: true } });
    for (const { id } of vendorIds) await recalcVendorProductQuota(id);
  }

  res.json({ plan: updated });
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

// Solo "cod"/"prepaid" son togglables acá — "whatsapp" es el canal
// universal (products.controller.js lo permite siempre, no forma parte de
// esta lista) y "table" nunca es elegible a mano (solo lo trae el menú QR
// sembrado). Ver assertPaymentMethodsAllowed en products.controller.js.
const productPaymentMethodsSchema = z.object({
  productPaymentMethods: z.array(z.enum(["cod", "prepaid"])),
});

export async function updateProductPaymentMethods(req, res) {
  const data = productPaymentMethodsSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({ settings: { productPaymentMethods: updated.productPaymentMethods } });
}

// Bloque 65: de qué conjunto fijo (CUP/USD/EUR/MXN) puede elegir una tienda
// su moneda operativa única, en el registro o al cambiarla después (ver
// assertCurrencyAllowed en vendors.controller.js) — nunca puede quedar
// vacío, dejaría el registro de tiendas nuevas sin ninguna opción.
const availableCurrenciesSchema = z.object({
  availableCurrencies: z.array(z.enum(["CUP", "USD", "EUR", "MXN"])).min(1, "Deja al menos una moneda disponible."),
});

export async function updateAvailableCurrencies(req, res) {
  const data = availableCurrenciesSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({ settings: { availableCurrencies: updated.availableCurrencies } });
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
    },
  });
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
  // Bloque 61: "" borra, undefined no toca (mismo criterio para las 3) —
  // nunca se valida el formato estricto de URL acá porque un link de
  // WhatsApp puede ser wa.me/... o api.whatsapp.com/..., no hay un único
  // formato "correcto" que validar.
  whatsappUrl: z.string().trim().optional().nullable(),
  instagramUrl: z.string().trim().optional().nullable(),
  facebookUrl: z.string().trim().optional().nullable(),
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
  if (data.whatsappUrl !== undefined) update.whatsappUrl = data.whatsappUrl || null;
  if (data.instagramUrl !== undefined) update.instagramUrl = data.instagramUrl || null;
  if (data.facebookUrl !== undefined) update.facebookUrl = data.facebookUrl || null;
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
  cupSubscriptionPriceCup: z.number().int().positive().optional(),
  // Bloque 150: mismo formulario ("Datos de pago de la suscripción" en
  // AdminSubscriptions.jsx) — el precio CARD/Stripe se edita junto al CUP.
  cardSubscriptionPriceUsd: z.number().int().positive().optional(),
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
  if (data.cupSubscriptionPriceCup !== undefined) update.cupSubscriptionPriceCup = data.cupSubscriptionPriceCup;
  if (data.cardSubscriptionPriceUsd !== undefined) update.cardSubscriptionPriceUsd = data.cardSubscriptionPriceUsd;
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data: update });
  res.json({
    settings: {
      cupBankAccountNumber: updated.cupBankAccountNumber,
      cupBankAccountHolder: updated.cupBankAccountHolder,
      cupBankInstructions: updated.cupBankInstructions,
      cupBankPhone: updated.cupBankPhone,
      cupSubscriptionPriceCup: updated.cupSubscriptionPriceCup,
      cardSubscriptionPriceUsd: updated.cardSubscriptionPriceUsd,
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
    whatsappUrl: settings.whatsappUrl || null,
    instagramUrl: settings.instagramUrl || null,
    facebookUrl: settings.facebookUrl || null,
  };
}

// Bloque 238/245 — Admin: estado real de cada MODELO de IA (healthy/down/inactive), para que el admin lo confirme de un
// vistazo junto al badge "Activo/Inactivo" que ya existe — no reemplaza el
// correo de aviso (notifyAdminActionNeeded), es solo para consulta visual.
export async function getAdminAiProviderHealth(req, res) {
  const health = await getModelHealthRows();
  res.json({ health });
}
