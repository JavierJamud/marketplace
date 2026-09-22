import { z } from "zod";
import { join, dirname } from "node:path";
import { unlink } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";

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
  res.json({
    settings: {
      heroImages: settings.heroImages,
      maxDeliveryCountriesRegular: settings.maxDeliveryCountriesRegular,
      maxDeliveryCountriesBusiness: settings.maxDeliveryCountriesBusiness,
      maxProvincesRegular: settings.maxProvincesRegular,
      maxProvincesBusiness: settings.maxProvincesBusiness,
      planFeaturesRegular: settings.planFeaturesRegular,
      planFeaturesBusiness: settings.planFeaturesBusiness,
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
      // Bloque 232: para que VendorStoreOffers.jsx muestre "X/N activas"
      // sin tener que pedir /admin/settings (esa ruta exige rol ADMIN).
      maxActiveStoreOffersPerVendor: settings.maxActiveStoreOffersPerVendor,
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
    },
  });
}

// Bloque 51: uso INTERNO (offers.controller.js/adminOffers.controller.js) —
// mismo criterio que getAiModelOverrides/getBrandSettings: nunca una ruta
// HTTP directa, cualquier controller que necesite la política de ofertas la
// llama en vez de hardcodear los días de cooldown/duración.
export async function getOfferPolicy() {
  const settings = await getOrCreateSettings();
  return { cooldownDays: settings.offerCooldownDays, defaultDurationDays: settings.offerDefaultDurationDays };
}

// Bloque 232 (pedido explícito — "quiero poder cambiar desde el panel de
// admin si los vendedores pueden tener una oferta activa en su tienda o
// pueden tener más de una"): mismo criterio que getOfferPolicy de arriba —
// uso INTERNO (storeOffers.controller.js), nunca una ruta HTTP directa.
// Distinta política: esto es sobre StoreOffer (ofertas DENTRO de la
// tienda), no sobre Offer (Home).
export async function getStoreOfferPolicy() {
  const settings = await getOrCreateSettings();
  return { maxActive: settings.maxActiveStoreOffersPerVendor };
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

const planLimitsSchema = z.object({
  maxDeliveryCountriesRegular: z.number().int().min(0).optional(),
  maxDeliveryCountriesBusiness: z.number().int().min(0).optional(),
  maxProvincesRegular: z.number().int().min(0).optional(),
  maxProvincesBusiness: z.number().int().min(0).optional().nullable(),
});

// Admin — nunca hardcodeado en el código, así el negocio puede ajustar
// cuántos países/provincias puede cargar cada plan sin un deploy.
export async function updatePlanLimits(req, res) {
  const data = planLimitsSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({
    settings: {
      maxDeliveryCountriesRegular: updated.maxDeliveryCountriesRegular,
      maxDeliveryCountriesBusiness: updated.maxDeliveryCountriesBusiness,
      maxProvincesRegular: updated.maxProvincesRegular,
      maxProvincesBusiness: updated.maxProvincesBusiness,
    },
  });
}

const planFeaturesSchema = z.object({
  planFeaturesRegular: z.array(z.string().trim().min(1)).optional(),
  planFeaturesBusiness: z.array(z.string().trim().min(1)).optional(),
});

// Admin (AdminSubscriptions.jsx) — qué incluye cada plan, mostrado en
// VendorVerification.jsx/VendorSubscription.jsx. Endpoint propio en vez de
// sumarse a updatePlanLimits: ese schema es específicamente sobre topes
// numéricos (países/provincias), mezclar listas de texto ahí le resta
// claridad al nombre y al schema.
export async function updatePlanFeatures(req, res) {
  const data = planFeaturesSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({
    settings: {
      planFeaturesRegular: updated.planFeaturesRegular,
      planFeaturesBusiness: updated.planFeaturesBusiness,
    },
  });
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

const storeOfferPolicySchema = z.object({
  maxActiveStoreOffersPerVendor: z.number().int().min(1).max(20),
});

// Admin (AdminStoreOffers.jsx) — cuántas ofertas de tienda puede mantener
// `active:true` a la vez cada vendedor (ver assertActiveOfferLimit en
// storeOffers.controller.js). Endpoint propio, mismo criterio que
// updateOfferPolicy: es una política de StoreOffer, no de Offer/Home.
export async function updateStoreOfferPolicy(req, res) {
  const data = storeOfferPolicySchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data });
  res.json({ settings: { maxActiveStoreOffersPerVendor: updated.maxActiveStoreOffersPerVendor } });
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
// getBrandSettings/getAiModelOverrides de arriba, nunca una ruta HTTP.
export async function getSiteTimezone() {
  const settings = await getOrCreateSettings();
  return settings.timezone || "America/Havana";
}

const cupPaymentSettingsSchema = z.object({
  cupBankAccountNumber: z.string().trim().optional().nullable(),
  cupBankAccountHolder: z.string().trim().optional().nullable(),
  cupBankInstructions: z.string().trim().optional().nullable(),
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
  if (data.cupSubscriptionPriceCup !== undefined) update.cupSubscriptionPriceCup = data.cupSubscriptionPriceCup;
  if (data.cardSubscriptionPriceUsd !== undefined) update.cardSubscriptionPriceUsd = data.cardSubscriptionPriceUsd;
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data: update });
  res.json({
    settings: {
      cupBankAccountNumber: updated.cupBankAccountNumber,
      cupBankAccountHolder: updated.cupBankAccountHolder,
      cupBankInstructions: updated.cupBankInstructions,
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

// Bloque 96 (pedido explícito): el hero pasa de 1 imagen fija a un slider —
// mismo patrón que addProductImages (products.controller.js): agrega al
// array existente, nunca lo reemplaza entero, para poder subir de a una o
// varias juntas sin perder las que ya había. A diferencia de las fotos de
// KYC, estas imágenes son públicas por diseño (se sirven vía express.static,
// ver app.js).
export async function addHeroImages(req, res) {
  if (!req.files?.length) throw new AppError("Sube al menos una imagen para el hero.", 400);

  const newUrls = req.files.map((f) => `/uploads/site/${f.filename}`);
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

  // Best-effort: borra el archivo físico también, no bloquea la respuesta si falla.
  const filename = url.split("/").pop();
  unlink(join(SITE_UPLOAD_DIR, filename)).catch(() => {});

  res.json({ settings: { heroImages: updated.heroImages } });
}

// Bloque 49: uso INTERNO (emails, PDFs, prompts de IA, mensajes de error) —
// mismo criterio que getAiModelOverrides de abajo: nunca una ruta HTTP
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

// Bloque 43/45: uso INTERNO (ai.js) — nunca una ruta HTTP directa, mismo
// criterio que getStripeConfig en integrations.controller.js. null en
// cualquiera de los tres = ese proveedor usa el DEFAULT_MODEL hardcodeado
// en su propio archivo (lib/nvidia.js|groq.js|gemini.js). Bloque 45:
// Cerebras salió del sistema, NVIDIA NIM lo reemplaza como tercer proveedor.
export async function getAiModelOverrides() {
  const settings = await getOrCreateSettings();
  return {
    groq: settings.aiModelGroq || null,
    gemini: settings.aiModelGemini || null,
    nvidia: settings.aiModelNvidia || null,
  };
}

// Admin — /admin/integraciones muestra/edita estos tres junto al switch de
// Activo y la API key de cada proveedor (AdminIntegrations.jsx).
export async function getAiModelSettings(_req, res) {
  const overrides = await getAiModelOverrides();
  res.json({ aiModels: overrides });
}

const aiModelsSchema = z.object({
  aiModelGroq: z.string().trim().optional(),
  aiModelGemini: z.string().trim().optional(),
  aiModelNvidia: z.string().trim().optional(),
});

// Un campo vacío ("") vuelve a null — es decir, "usar el default del
// código" — nunca hay que borrar la fila entera para volver al modelo
// original de un proveedor puntual.
export async function updateAiModels(req, res) {
  const data = aiModelsSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const cleaned = Object.fromEntries(Object.entries(data).map(([key, value]) => [key, value ? value : null]));
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data: cleaned });
  res.json({
    aiModels: { groq: updated.aiModelGroq || null, gemini: updated.aiModelGemini || null, nvidia: updated.aiModelNvidia || null },
  });
}
