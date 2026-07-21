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
