import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getPlanConfig } from "../lib/planConfig.js";

export const ZONE_INCLUDE = { province: { include: { country: true } }, municipality: true };

// Zona de servicio de UNA provincia o estado de la tienda. municipalityIds null = toda la provincia; [] = quitar la provincia;
// lista = solo esos municipios. La usan la propia tienda (Configuración) y el admin (Editar tienda), con las mismas reglas.
// enforcePlan: la tienda respeta el tope de provincias de su plan; el admin puede corregir sin ese tope.
export async function syncVendorProvinceZone(vendor, { provinceId, municipalityIds }, { enforcePlan = true } = {}) {
  const province = await prisma.province.findUnique({ where: { id: provinceId } });

  const isDeletingAll = municipalityIds !== null && municipalityIds.length === 0;
  if (!isDeletingAll) {
    if (!province || !province.isActive) throw new AppError("Provincia/Estado no disponible.", 404);
  }

  const existingLocations = await prisma.vendorLocation.findMany({ where: { vendorId: vendor.id } });
  const distinctProvinceCount = new Set(existingLocations.map((l) => l.provinceId)).size;
  const isNewProvince = !existingLocations.some((l) => l.provinceId === provinceId);

  if (enforcePlan && isNewProvince && (municipalityIds === null || municipalityIds.length > 0)) {
    const planConfig = await getPlanConfig(vendor.planType);
    const max = planConfig?.maxProvinces ?? null;
    if (max !== null && distinctProvinceCount >= max) {
      throw new AppError(
        `Tu Plan ${planConfig.displayName} permite vender en hasta ${max} provincia(s). Verifica tu tienda para ampliar el límite.`,
        403
      );
    }
  }

  if (municipalityIds === null) {
    // "Todos los municipios"
    await prisma.vendorLocation.deleteMany({ where: { vendorId: vendor.id, provinceId } });
    await prisma.vendorLocation.create({
      data: { vendorId: vendor.id, provinceId, countryId: province.countryId ?? null, municipalityId: null },
    });
  } else if (municipalityIds.length === 0) {
    await prisma.vendorLocation.deleteMany({ where: { vendorId: vendor.id, provinceId } });
    if (province?.countryId) {
      const remainingInCountry = await prisma.vendorLocation.count({
        where: { vendorId: vendor.id, province: { countryId: province.countryId } },
      });
      if (remainingInCountry === 0) {
        await prisma.vendorDeliveryCountry.deleteMany({ where: { vendorId: vendor.id, countryId: province.countryId } });
      }
    }
  } else {
    const validMunicipalities = await prisma.municipality.findMany({
      where: { id: { in: municipalityIds }, provinceId, isActive: true },
    });
    const validIds = new Set(validMunicipalities.map((m) => m.id));
    // Si ninguna de las elegidas existe o sigue activa, se avisa: antes se borraba la zona entera sin decir nada.
    if (validIds.size === 0) throw new AppError("Ninguno de los municipios o ciudades elegidos está disponible. Vuelve a elegirlos.", 400);

    await prisma.vendorLocation.deleteMany({
      where: { vendorId: vendor.id, provinceId, OR: [{ municipalityId: null }, { municipalityId: { notIn: [...validIds] } }] },
    });

    const currentLocs = await prisma.vendorLocation.findMany({ where: { vendorId: vendor.id, provinceId } });
    const currentMunIds = new Set(currentLocs.map((l) => l.municipalityId));

    // En un solo paso (un estado puede tener cientos de ciudades elegidas).
    const toCreate = [...validIds].filter((mId) => !currentMunIds.has(mId));
    if (toCreate.length) {
      await prisma.vendorLocation.createMany({
        data: toCreate.map((mId) => ({ vendorId: vendor.id, provinceId, countryId: province.countryId ?? null, municipalityId: mId })),
      });
    }
  }

  return prisma.vendorLocation.findMany({ where: { vendorId: vendor.id }, include: ZONE_INCLUDE });
}
