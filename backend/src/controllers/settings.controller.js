import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

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
      heroImageUrl: settings.heroImageUrl ? `/uploads/site/${settings.heroImageUrl}` : null,
      maxDeliveryCountriesRegular: settings.maxDeliveryCountriesRegular,
      maxDeliveryCountriesBusiness: settings.maxDeliveryCountriesBusiness,
      maxProvincesRegular: settings.maxProvincesRegular,
      maxProvincesBusiness: settings.maxProvincesBusiness,
      planFeaturesRegular: settings.planFeaturesRegular,
      planFeaturesBusiness: settings.planFeaturesBusiness,
    },
  });
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

// Solo admin (ver admin.routes.js) — reemplaza la imagen del hero. A
// diferencia de las fotos de KYC, esta imagen es pública por diseño (se
// sirve vía express.static, ver app.js).
export async function updateHeroImage(req, res) {
  if (!req.file) throw new AppError("Subí una imagen para el hero.", 400);

  const settings = await getOrCreateSettings();
  const updated = await prisma.siteSettings.update({
    where: { id: settings.id },
    data: { heroImageUrl: req.file.filename },
  });
  res.json({ settings: { heroImageUrl: `/uploads/site/${updated.heroImageUrl}` } });
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
