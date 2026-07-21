import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

export async function listProvinces(_req, res) {
  const provinces = await prisma.province.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
  res.json({ provinces });
}

// Bloque 19: países activos — lo usa el vendedor para elegir a dónde entrega
// (VendorSettings.jsx) y potencialmente el checkout más adelante. Solo
// active:true, igual que listBusinessCategories/listProvinces (los
// inactivos siguen existiendo para no romper asignaciones previas, pero no
// se ofrecen para elegir de nuevo).
export async function listActiveCountries(_req, res) {
  const countries = await prisma.country.findMany({
    where: { isActive: true },
    orderBy: { name: "asc" },
    select: { id: true, name: true, code: true },
  });
  res.json({ countries });
}

export async function listMunicipalities(req, res) {
  const { provinceId } = req.params;
  const municipalities = await prisma.municipality.findMany({
    where: { provinceId },
    orderBy: { name: "asc" },
  });
  res.json({ municipalities });
}

// Provincias vecinas, usadas por el buscador para recomendar productos
// cercanos cuando no hay stock en la provincia elegida.
export async function listAdjacentProvinces(req, res) {
  const { provinceId } = req.params;
  const adjacencies = await prisma.provinceAdjacency.findMany({
    where: { provinceAId: provinceId },
    include: { provinceB: { select: { id: true, name: true, code: true } } },
  });
  res.json({ provinces: adjacencies.map((a) => a.provinceB) });
}

// --- Admin (Bloque 18) ------------------------------------------------------
// La compra en el sitio sigue mostrando "Cuba" fijo como único país de
// entrega (ver Checkout.jsx) — esto es solo para que el admin deje cargado
// de antemano un catálogo de países/provincias/municipios más amplio, listo
// para el día que ZeuDin entregue a otro país sin tocar código.

export async function listCountries(_req, res) {
  const countries = await prisma.country.findMany({
    orderBy: { name: "asc" },
    include: { _count: { select: { provinces: true } } },
  });
  res.json({ countries });
}

const createCountrySchema = z.object({
  code: z.string().trim().min(2).max(5).toUpperCase(),
  name: z.string().trim().min(2),
});

export async function createCountry(req, res) {
  const data = createCountrySchema.parse(req.body);
  const existing = await prisma.country.findUnique({ where: { code: data.code } });
  if (existing) throw new AppError("Ya existe un país con ese código.", 409);

  const country = await prisma.country.create({ data });
  res.status(201).json({ country });
}

const updateCountrySchema = z.object({
  code: z.string().trim().min(2).max(5).toUpperCase().optional(),
  name: z.string().trim().min(2).optional(),
  isActive: z.boolean().optional(),
});

export async function updateCountry(req, res) {
  const { id } = req.params;
  const data = updateCountrySchema.parse(req.body);

  const existing = await prisma.country.findUnique({ where: { id } });
  if (!existing) throw new AppError("País no encontrado.", 404);

  if (data.code) {
    const codeTaken = await prisma.country.findUnique({ where: { code: data.code } });
    if (codeTaken && codeTaken.id !== id) throw new AppError("Ya existe un país con ese código.", 409);
  }

  const country = await prisma.country.update({ where: { id }, data });
  res.json({ country });
}

// Bloque 21: activar/desactivar TODOS de un tirón — para cuando el admin
// carga el catálogo mundial completo y quiere arrancar con todo prendido o
// apagado en vez de tocar país por país.
export async function activateAllCountries(_req, res) {
  const { count } = await prisma.country.updateMany({ data: { isActive: true } });
  res.json({ count });
}

export async function deactivateAllCountries(_req, res) {
  const { count } = await prisma.country.updateMany({ data: { isActive: false } });
  res.json({ count });
}

const bulkDeleteCountriesSchema = z.object({ ids: z.array(z.string().min(1)).min(1, "Elegí al menos un país.") });

// Mismo criterio que BusinessCategory.delete (Bloque 18) y el comentario de
// arriba: un país en uso (con provincias cargadas o algún vendedor
// entregando ahí) no se borra — se desactiva en su lugar. Acá se procesa la
// selección entera de una: los que se pueden borrar se borran, los que no
// se reportan aparte (no es todo-o-nada, un checkbox marcado por error no
// debería bloquear el resto de la selección).
export async function bulkDeleteCountries(req, res) {
  const { ids } = bulkDeleteCountriesSchema.parse(req.body);

  const countries = await prisma.country.findMany({
    where: { id: { in: ids } },
    include: { _count: { select: { provinces: true, vendorDeliveries: true } } },
  });

  const deletable = countries.filter((c) => c._count.provinces === 0 && c._count.vendorDeliveries === 0);
  const blocked = countries
    .filter((c) => c._count.provinces > 0 || c._count.vendorDeliveries > 0)
    .map((c) => ({
      id: c.id,
      name: c.name,
      reason:
        c._count.provinces > 0
          ? `Tiene ${c._count.provinces} provincia(s) cargada(s).`
          : `${c._count.vendorDeliveries} tienda(s) lo tienen como país de entrega.`,
    }));

  if (deletable.length > 0) {
    await prisma.country.deleteMany({ where: { id: { in: deletable.map((c) => c.id) } } });
  }

  res.json({ deletedCount: deletable.length, blocked });
}

// A diferencia de listProvinces (pública, solo id/name/code para selects del
// sitio), esta trae todo — país y cantidad de municipios — para la tabla de
// administración.
export async function listProvincesForAdmin(_req, res) {
  const provinces = await prisma.province.findMany({
    orderBy: { name: "asc" },
    include: { country: { select: { id: true, name: true, code: true } }, _count: { select: { municipalities: true } } },
  });
  res.json({ provinces });
}

const createProvinceSchema = z.object({
  code: z.string().trim().min(1).max(10).toLowerCase(),
  name: z.string().trim().min(2),
  countryId: z.string().min(1, "Elegí a qué país pertenece."),
});

export async function createProvince(req, res) {
  const data = createProvinceSchema.parse(req.body);
  const country = await prisma.country.findUnique({ where: { id: data.countryId } });
  if (!country) throw new AppError("País no encontrado.", 404);

  const codeTaken = await prisma.province.findUnique({ where: { code: data.code } });
  if (codeTaken) throw new AppError("Ya existe una provincia con ese código.", 409);

  const province = await prisma.province.create({ data });
  res.status(201).json({ province });
}

const updateProvinceSchema = z.object({
  code: z.string().trim().min(1).max(10).toLowerCase().optional(),
  name: z.string().trim().min(2).optional(),
  countryId: z.string().min(1).optional(),
});

export async function updateProvince(req, res) {
  const { id } = req.params;
  const data = updateProvinceSchema.parse(req.body);

  const existing = await prisma.province.findUnique({ where: { id } });
  if (!existing) throw new AppError("Provincia no encontrada.", 404);

  if (data.countryId) {
    const country = await prisma.country.findUnique({ where: { id: data.countryId } });
    if (!country) throw new AppError("País no encontrado.", 404);
  }
  if (data.code) {
    const codeTaken = await prisma.province.findUnique({ where: { code: data.code } });
    if (codeTaken && codeTaken.id !== id) throw new AppError("Ya existe una provincia con ese código.", 409);
  }

  const province = await prisma.province.update({ where: { id }, data });
  res.json({ province });
}

const createMunicipalitySchema = z.object({ name: z.string().trim().min(2) });

export async function createMunicipality(req, res) {
  const { provinceId } = req.params;
  const { name } = createMunicipalitySchema.parse(req.body);

  const province = await prisma.province.findUnique({ where: { id: provinceId } });
  if (!province) throw new AppError("Provincia no encontrada.", 404);

  const existing = await prisma.municipality.findUnique({ where: { provinceId_name: { provinceId, name } } });
  if (existing) throw new AppError("Esa provincia ya tiene un municipio con ese nombre.", 409);

  const municipality = await prisma.municipality.create({ data: { provinceId, name } });
  res.status(201).json({ municipality });
}
