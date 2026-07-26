import { z } from "zod";
import { join, dirname } from "node:path";
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

// Bloque 49: logoUrl puede ser un archivo subido (nombre relativo, hay que
// anteponer /uploads/site/) o un link externo pegado por el admin (ya
// absoluto, se usa tal cual) — mismo criterio que las imágenes de producto.
function formatLogoUrl(logoUrl) {
  if (!logoUrl) return null;
  return /^https?:\/\//.test(logoUrl) ? logoUrl : `/uploads/site/${logoUrl}`;
}

// Público — Home.jsx lo consulta sin autenticación para pintar el hero.
// También expone los límites por plan (Bloque 19): el panel de vendedor los
// necesita para deshabilitar "+ Agregar" al llegar al tope y mostrar "X/Y".
export async function getSettings(_req, res) {
  const settings = await getOrCreateSettings();
  res.json({
    settings: {
      heroImageUrl: settings.heroImageUrl ? `/uploads/site/${settings.heroImageUrl}` : null,
      maxDeliveryCountriesRegular: settings.maxDeliveryCountriesRegular,
      maxDeliveryCountriesBusiness: settings.maxDeliveryCountriesBusiness,
      maxProvincesRegular: settings.maxProvincesRegular,
      maxProvincesBusiness: settings.maxProvincesBusiness,
      planFeaturesRegular: settings.planFeaturesRegular,
      planFeaturesBusiness: settings.planFeaturesBusiness,
      allowProductImageLinks: settings.allowProductImageLinks,
      siteName: settings.siteName,
      logoUrl: formatLogoUrl(settings.logoUrl),
      offerCooldownDays: settings.offerCooldownDays,
      offerDefaultDurationDays: settings.offerDefaultDurationDays,
      showChatWidget: settings.showChatWidget,
      productPaymentMethods: settings.productPaymentMethods,
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

const brandingSchema = z.object({
  siteName: z.string().trim().min(1).optional(),
  // "" borra el logo (vuelve a mostrar solo el nombre) — distinto de
  // `undefined`, que significa "no tocar este campo".
  logoUrl: z.string().trim().optional().nullable(),
});

// Admin ("Marca de la plataforma") — nombre de la plataforma y logo por
// link externo. Si el admin sube un archivo en su lugar, se usa
// updateBrandingLogo (multipart) de abajo, no este endpoint JSON.
export async function updateBranding(req, res) {
  const data = brandingSchema.parse(req.body);
  const settings = await getOrCreateSettings();
  const update = {};
  if (data.siteName !== undefined) update.siteName = data.siteName;
  if (data.logoUrl !== undefined) update.logoUrl = data.logoUrl || null;
  const updated = await prisma.siteSettings.update({ where: { id: settings.id }, data: update });
  res.json({ settings: { siteName: updated.siteName, logoUrl: formatLogoUrl(updated.logoUrl) } });
}

// Admin — subir el logo como archivo, alternativa a pegar link. Mismo patrón
// que updateHeroImage.
export async function updateBrandingLogo(req, res) {
  if (!req.file) throw new AppError("Sube un archivo de logo.", 400);
  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({
    where: { id: settings.id },
    data: { logoUrl: req.file.filename },
  });
  res.json({ settings: { logoUrl: formatLogoUrl(updated.logoUrl) } });
}

// Solo admin (ver admin.routes.js) — reemplaza la imagen del hero. A
// diferencia de las fotos de KYC, esta imagen es pública por diseño (se
// sirve vía express.static, ver app.js).
export async function updateHeroImage(req, res) {
  if (!req.file) throw new AppError("Sube una imagen para el hero.", 400);

  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({
    where: { id: settings.id },
    data: { heroImageUrl: req.file.filename },
  });
  res.json({ settings: { heroImageUrl: `/uploads/site/${updated.heroImageUrl}` } });
}

// Bloque 49: uso INTERNO (emails, PDFs, prompts de IA, mensajes de error) —
// mismo criterio que getAiModelOverrides de abajo: nunca una ruta HTTP
// directa, cualquier módulo que necesite el nombre/logo de la plataforma
// para mostrarlo fuera de la app (un correo, un PDF, el system prompt del
// chatbot) llama esto en vez de hardcodear "ZeuDin".
export async function getBrandSettings() {
  const settings = await getOrCreateSettings();
  const relativeOrAbsolute = formatLogoUrl(settings.logoUrl);
  // Distinto de formatLogoUrl tal cual (que devuelve rutas relativas para
  // que el FRONTEND les anteponga su propio axios baseURL) — un correo o un
  // PDF se abre fuera del navegador, sin ningún origin propio, así que acá
  // la ruta local sí necesita el host de este backend antepuesto a mano.
  const logoUrl = relativeOrAbsolute && !/^https?:\/\//.test(relativeOrAbsolute) ? `${env.backendUrl}${relativeOrAbsolute}` : relativeOrAbsolute;
  return { siteName: settings.siteName || "ZeuDin", logoUrl };
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
