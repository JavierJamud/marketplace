import { z } from "zod";
import * as Icons from "lucide-react";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { slugify } from "../utils/slugify.js";

// Bloque 18: "tipo de negocio" de la tienda — no confundir con Category
// (esa es de producto/rubro heredada de bloques anteriores, sin tocar).
// "Todos" nunca es una fila acá — es solo la opción de filtro sin filtro
// real, resuelta enteramente en el frontend.

// Bloque 112 (bug real reportado en vivo, con captura): el admin copió
// "users" tal cual aparece en la URL/título de lucide.dev/icons/users —
// pero el export real de lucide-react para ESE ícono es "Users" (PascalCase,
// mayúscula inicial). La validación exigía coincidencia exacta y rechazaba
// "users" como "no existe", aunque el ícono sí existe con ese nombre
// aproximado. Se agrega una normalización tolerante: si el nombre exacto no
// matchea, se separa por cualquier separador no alfanumérico (guiones,
// espacios) y se arma la versión PascalCase esperada por lucide-react antes
// de darlo por inválido — cubre "users"→"Users", "shopping-bag"→"ShoppingBag",
// "circle check big"→"CircleCheckBig", etc. Devuelve el nombre CANÓNICO real
// (nunca el que escribió el admin) para que lo que se guarda en la base
// siempre sea exactamente lo que CategoryIcon.jsx puede resolver después —
// alguna normalización floja del lado de guardado sin esto habría dejado el
// mismo problema, solo que invisible hasta la próxima vez que se intentara
// RENDERIZAR el ícono guardado.
function toPascalCase(name) {
  return name
    .trim()
    .replace(/[^a-zA-Z0-9]+/g, " ")
    .split(" ")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase())
    .join("");
}

function resolveLucideIconName(name) {
  if (typeof name !== "string" || !name.trim()) return null;
  const exact = name.trim();
  // lucide-react también exporta alias "*Icon" (ej. "GiftIcon") por cada
  // ícono — se acepta el nombre "canónico" (sin sufijo) para que el admin
  // siempre guarde el mismo nombre que ve documentado en tokens-cheatsheet.md.
  if (Icons[exact] && !exact.endsWith("Icon")) return exact;
  const pascal = toPascalCase(exact);
  if (Icons[pascal] && !pascal.endsWith("Icon")) return pascal;
  return null;
}

// Público — solo activas, ya ordenadas para el Home/filtro de Tiendas.
// Bloque 39 (Parte 3): se suma vendorCount (tiendas activas reales de cada
// rubro) — el bot general lo usa para elegir la categoría MÁS relevante de
// verdad en sus chips iniciales, en vez de una al azar entre las activas.
export async function listBusinessCategories(_req, res) {
  const categories = await prisma.businessCategory.findMany({
    where: { active: true },
    orderBy: [{ sortOrder: "asc" }, { name: "asc" }],
    // Bloque 64: cuenta solo tiendas con al menos 1 producto publicado —
    // mismo criterio de visibilidad que listVendors/getVendorBySlug, para
    // que el número no incluya tiendas que el cliente no puede ver de
    // todas formas.
    select: {
      id: true,
      name: true,
      slug: true,
      icon: true,
      _count: { select: { vendors: { where: { isBlocked: false, status: "ACTIVE", isPrivate: false, products: { some: { isActive: true } } } } } },
    },
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
  const icon = resolveLucideIconName(data.icon);
  if (!icon) throw new AppError(`"${data.icon}" no es un ícono válido de lucide-react.`, 400);

  let slug = slugify(data.name);
  const slugTaken = await prisma.businessCategory.findUnique({ where: { slug } });
  if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;

  let sortOrder = data.sortOrder;
  if (sortOrder === undefined) {
    const last = await prisma.businessCategory.findFirst({ orderBy: { sortOrder: "desc" } });
    sortOrder = (last?.sortOrder ?? -1) + 1;
  }

  const category = await prisma.businessCategory.create({ data: { name: data.name, slug, icon, sortOrder } });
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

  if (data.icon) {
    const icon = resolveLucideIconName(data.icon);
    if (!icon) throw new AppError(`"${data.icon}" no es un ícono válido de lucide-react.`, 400);
    data.icon = icon;
  }

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
