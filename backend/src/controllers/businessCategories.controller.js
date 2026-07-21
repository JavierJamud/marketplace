import { z } from "zod";
import * as Icons from "lucide-react";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { slugify } from "../utils/slugify.js";

// Bloque 18: "tipo de negocio" de la tienda — no confundir con Category
// (esa es de producto/rubro heredada de bloques anteriores, sin tocar).
// "Todos" nunca es una fila acá — es solo la opción de filtro sin filtro
// real, resuelta enteramente en el frontend.

function isValidLucideIcon(name) {
  // lucide-react también exporta alias "*Icon" (ej. "GiftIcon") por cada
  // ícono — se acepta el nombre "canónico" (sin sufijo) para que el admin
  // siempre guarde el mismo nombre que ve documentado en tokens-cheatsheet.md.
  return typeof name === "string" && !!Icons[name] && !name.endsWith("Icon");
}

// Público — solo activas, ya ordenadas para el Home/filtro de Tiendas.
// Bloque 39 (Parte 3): se suma vendorCount (tiendas activas reales de cada
// rubro) — el bot general lo usa para elegir la categoría MÁS relevante de
// verdad en sus chips iniciales, en vez de una al azar entre las activas.
export async function listBusinessCategories(_req, res) {
  const categories = await prisma.businessCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    select: { id: true, name: true, slug: true, icon: true, _count: { select: { vendors: { where: { isBlocked: false } } } } },
  });
  res.json({ categories: categories.map(({ _count, ...c }) => ({ ...c, vendorCount: _count.vendors })) });
}

// --- Admin -------------------------------------------------------------

export async function listBusinessCategoriesAdmin(_req, res) {
  const categories = await prisma.businessCategory.findMany({
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    include: { _count: { select: { vendors: true } } },
  });
  res.json({ categories });
}

const createSchema = z.object({
  name: z.string().trim().min(2),
  icon: z.string().trim().min(1),
  sortOrder: z.number().int().optional(),
});

export async function createBusinessCategory(req, res) {
  const data = createSchema.parse(req.body);
  if (!isValidLucideIcon(data.icon)) throw new AppError(`"${data.icon}" no es un ícono válido de lucide-react.`, 400);

  let slug = slugify(data.name);
  const slugTaken = await prisma.businessCategory.findUnique({ where: { slug } });
  if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;

  let sortOrder = data.sortOrder;
  if (sortOrder === undefined) {
    const last = await prisma.businessCategory.findFirst({ orderBy: { sortOrder: "desc" } });
    sortOrder = (last?.sortOrder ?? -1) + 1;
  }

  const category = await prisma.businessCategory.create({ data: { name: data.name, slug, icon: data.icon, sortOrder } });
  res.status(201).json({ category });
}

const updateSchema = z.object({
  name: z.string().trim().min(2).optional(),
  icon: z.string().trim().min(1).optional(),
  active: z.boolean().optional(),
  sortOrder: z.number().int().optional(),
});

export async function updateBusinessCategory(req, res) {
  const { id } = req.params;
  const data = updateSchema.parse(req.body);

  const existing = await prisma.businessCategory.findUnique({ where: { id } });
  if (!existing) throw new AppError("Categoría no encontrada.", 404);

  if (data.icon && !isValidLucideIcon(data.icon)) throw new AppError(`"${data.icon}" no es un ícono válido de lucide-react.`, 400);

  const category = await prisma.businessCategory.update({ where: { id }, data });
  res.json({ category });
}

// Solo se puede borrar sin tiendas asociadas — si tiene, se fuerza a
// desactivar en su lugar (no rompe las tiendas que ya la tienen asignada).
export async function deleteBusinessCategory(req, res) {
  const { id } = req.params;
  const category = await prisma.businessCategory.findUnique({ where: { id }, include: { _count: { select: { vendors: true } } } });
  if (!category) throw new AppError("Categoría no encontrada.", 404);

  if (category._count.vendors > 0) {
    throw new AppError(
      `No se puede eliminar: ${category._count.vendors} tienda(s) tienen este tipo de negocio asignado. Desactivala en su lugar.`,
      409
    );
  }

  await prisma.businessCategory.delete({ where: { id } });
  res.status(204).end();
}
