import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getPlanConfig } from "../lib/planConfig.js";
import { plansOffering, plansSentence } from "../lib/planUpsell.js";

export const ZONE_INCLUDE = { province: { include: { country: true } }, municipality: true };

// Provincias distintas de una lista de ubicaciones, para el tope maxProvinces: una sola cuenta para la tienda, el registro
// y el admin. Una ubicación sin provincia del catálogo (país fuera de Cuba o estado escrito a mano) cuenta por su país y su
// estado escrito. Antes aquí se contaba new Set(provinceId), así que todas las de provincia null valían como una, y el
// admin usaba otra clave: uno veía "excede" donde el otro no.
export function vendorProvinceKey(loc) {
  return loc.provinceId ?? `${loc.countryId ?? loc.countryOther ?? ""}:${(loc.stateOther ?? "").trim().toLowerCase()}`;
}
export function countVendorProvinces(locations) {
  return new Set(locations.map(vendorProvinceKey)).size;
}

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
  const distinctProvinceCount = countVendorProvinces(existingLocations);
  const isNewProvince = !existingLocations.some((l) => l.provinceId === provinceId);

  if (enforcePlan && isNewProvince && (municipalityIds === null || municipalityIds.length > 0)) {
    const planConfig = await getPlanConfig(vendor.planType);
    const max = planConfig?.maxProvinces ?? null;
    if (max !== null && distinctProvinceCount >= max) {
      // Mismo aviso que addMyLocation (vendors.controller.js): los planes con más provincias salen de la base. Antes decía
      // "verifica tu tienda", como si verificarse subiera el tope; lo sube el plan.
      const more = plansSentence(await plansOffering(null, { limitKey: "maxProvinces", above: max }), { one: "Para vender en más provincias, cámbiate al plan", many: "Para vender en más provincias, cámbiate a uno de estos planes:" });
      throw new AppError([`Tu plan ${planConfig.displayName} permite vender en hasta ${max} ${max === 1 ? "provincia" : "provincias"}.`, more].filter(Boolean).join(" "), 403);
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
