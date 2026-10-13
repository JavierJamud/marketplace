import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { vendorZoneWhere } from "../lib/vendorZone.js";
import { AppError } from "../utils/AppError.js";

// Categorías de producto: dos niveles (categoría y subcategorías). El catálogo inicial viene de
// prisma/categorias-productos.mjs; el admin lo administra (rutas /admin/product-categories) y un vendedor puede proponer una
// categoría nueva al cargar un producto cuando la suya no existe (POST /categories): queda disponible para todos y marcada
// como "creada por un vendedor" para que el admin la revise.

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slugify = (s) => fold(s).replace(/\s+/g, "-");

async function uniqueSlug(name, parentSlug) {
  const base = slugify(name) || "categoria";
  for (const candidate of [base, parentSlug ? `${parentSlug}-${base}` : null].filter(Boolean)) {
    if (!(await prisma.category.findUnique({ where: { slug: candidate }, select: { id: true } }))) return candidate;
  }
  let n = 2;
  while (await prisma.category.findUnique({ where: { slug: `${base}-${n}` }, select: { id: true } })) n++;
  return `${base}-${n}`;
}

// Bloque 52: ahora incluye `children` de cada categoría top-level (antes solo devolvía el nivel raíz) — Shop.jsx (pills de
// filtro) sigue leyendo solo `name`/`id` de cada una, y VendorProducts.jsx arma el selector con las subcategorías.
export async function listCategories(req, res) {
  const zone = vendorZoneWhere(req.query);
  const categories = await prisma.category.findMany({
    where: { parentId: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      isUserCreated: true,
      children: { orderBy: { name: "asc" }, select: { id: true, name: true, slug: true, isUserCreated: true } },
    },
  });
  if (!zone) return res.json({ categories });

  // Con un lugar elegido, solo las categorías que tienen productos a la venta de tiendas de ese lugar (con sus subcategorías).
  const used = await prisma.product.groupBy({
    by: ["categoryId"],
    where: {
      isActive: true,
      hiddenFromStore: false,
      overQuota: false,
      OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }],
      vendor: { isBlocked: false, status: "ACTIVE", isPrivate: false, locations: zone },
    },
  });
  const ids = new Set(used.map((u) => u.categoryId).filter(Boolean));
  const kept = categories
    .map((c) => ({ ...c, children: c.children.filter((ch) => ids.has(ch.id)) }))
    .filter((c) => ids.has(c.id) || c.children.length > 0);
  res.json({ categories: kept });
}

const createSchema = z.object({
  name: z.string().trim().min(2, "Escribe el nombre de la categoría.").max(60, "El nombre es muy largo (máximo 60 caracteres)."),
  parentId: z.string().trim().min(1).nullish(),
});

const BAD_WORDS = /(put[oa]s?|mierda|co[ñn]o|pendej|cabr[oó]n|verga|follar|culo|marica|maric[oó]n)/i;

// Vendedor (o admin): crea una categoría nueva. Si ya existe una con ese nombre en el mismo nivel, devuelve la existente.
export async function createCategory(req, res) {
  const { name, parentId } = createSchema.parse(req.body);
  if (BAD_WORDS.test(fold(name))) throw new AppError("Ese nombre no se puede usar como categoría.", 400);
  if (!/[a-zA-Z0-9À-ſ]/.test(name)) throw new AppError("Escribe un nombre válido.", 400);

  let parent = null;
  if (parentId) {
    parent = await prisma.category.findUnique({ where: { id: parentId }, select: { id: true, slug: true, parentId: true } });
    if (!parent) throw new AppError("La categoría principal no existe.", 404);
    if (parent.parentId) throw new AppError("Elige una categoría principal, no una subcategoría.", 400);
  }

  const all = await prisma.category.findMany({ select: { id: true, name: true, slug: true, parentId: true } });
  // Si ya existe una con ese nombre en el mismo nivel (o como categoría principal), se usa esa en lugar de duplicarla.
  const existing = all.find((c) => fold(c.name) === fold(name) && ((c.parentId ?? null) === (parent?.id ?? null) || (!parent && !c.parentId)));
  if (existing) return res.json({ category: existing, existing: true });

  const slug = await uniqueSlug(name, parent?.slug);
  const category = await prisma.category.create({
    data: { name, slug, parentId: parent?.id ?? null, isUserCreated: req.user?.role !== "ADMIN" },
    select: { id: true, name: true, slug: true, parentId: true, isUserCreated: true },
  });
  res.status(201).json({ category, existing: false });
}

// --- Admin -------------------------------------------------------------------

export async function listCategoriesAdmin(_req, res) {
  const rows = await prisma.category.findMany({
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, parentId: true, isUserCreated: true, createdAt: true, _count: { select: { products: true, children: true } } },
  });
  res.json({ categories: rows.map(({ _count, ...c }) => ({ ...c, productCount: _count.products, childCount: _count.children })) });
}

const updateSchema = z.object({
  name: z.string().trim().min(2).max(60).optional(),
  parentId: z.string().trim().min(1).nullable().optional(),
});

export async function updateCategoryAdmin(req, res) {
  const { id } = req.params;
  const data = updateSchema.parse(req.body);
  const category = await prisma.category.findUnique({ where: { id }, select: { id: true, name: true, parentId: true, _count: { select: { children: true } } } });
  if (!category) throw new AppError("Categoría no encontrada.", 404);

  const nextParentId = data.parentId === undefined ? category.parentId : data.parentId;
  if (nextParentId) {
    if (nextParentId === id) throw new AppError("Una categoría no puede ser su propia categoría principal.", 400);
    const parent = await prisma.category.findUnique({ where: { id: nextParentId }, select: { parentId: true } });
    if (!parent) throw new AppError("La categoría principal no existe.", 404);
    if (parent.parentId) throw new AppError("Solo hay dos niveles: elige una categoría principal.", 400);
    if (category._count.children > 0) throw new AppError("Esta categoría tiene subcategorías; no puede pasar a ser subcategoría de otra.", 400);
  }
  const newName = data.name ?? category.name;
  const siblings = await prisma.category.findMany({ where: { parentId: nextParentId ?? null, NOT: { id } }, select: { name: true } });
  if (siblings.some((s) => fold(s.name) === fold(newName))) throw new AppError(`Ya existe "${newName}" en ese nivel.`, 409);

  const updated = await prisma.category.update({
    where: { id },
    data: { ...(data.name ? { name: data.name } : {}), ...(data.parentId !== undefined ? { parentId: data.parentId } : {}), isUserCreated: false },
    select: { id: true, name: true, slug: true, parentId: true },
  });
  res.json({ category: updated });
}

// Solo se elimina una categoría sin productos ni subcategorías (si no, el admin la mueve o la renombra).
export async function deleteCategoryAdmin(req, res) {
  const { id } = req.params;
  const category = await prisma.category.findUnique({ where: { id }, select: { name: true, _count: { select: { products: true, children: true } } } });
  if (!category) throw new AppError("Categoría no encontrada.", 404);
  if (category._count.products > 0) throw new AppError(`"${category.name}" tiene ${category._count.products} producto(s). Muévelos a otra categoría antes de eliminarla.`, 409);
  if (category._count.children > 0) throw new AppError(`"${category.name}" tiene subcategorías. Elimínalas o muévelas primero.`, 409);
  await prisma.category.delete({ where: { id } });
  res.status(204).send();
}
