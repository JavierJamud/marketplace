// Carga las categorías de producto (prisma/categorias-productos.mjs). Solo AGREGA: nunca borra, renombra ni mueve nada de lo
// que ya exista (productos ya publicados, categorías creadas por el admin o por vendedores). Se puede repetir sin problema.
//   node prisma/seed-categorias-productos.mjs
import { PrismaClient } from "@prisma/client";
import { CATEGORIAS } from "./categorias-productos.mjs";

const prisma = new PrismaClient();
const fold = (s) => String(s).normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
const slugify = (s) => fold(s).replace(/\s+/g, "-");

const existing = await prisma.category.findMany({ select: { id: true, name: true, slug: true, parentId: true } });
const slugs = new Set(existing.map((c) => c.slug));
let created = 0;

async function ensure(name, parentId, parentSlug) {
  const found = existing.find((c) => c.parentId === (parentId ?? null) && fold(c.name) === fold(name));
  if (found) return found;
  let slug = slugify(name);
  if (slugs.has(slug)) slug = parentSlug ? `${parentSlug}-${slug}` : `${slug}-categoria`;
  let n = 2;
  const base = slug;
  while (slugs.has(slug)) slug = `${base}-${n++}`;
  const row = await prisma.category.create({ data: { name, slug, parentId: parentId ?? null }, select: { id: true, name: true, slug: true, parentId: true } });
  slugs.add(slug);
  existing.push(row);
  created++;
  return row;
}

for (const [parentName, children] of Object.entries(CATEGORIAS)) {
  const parent = await ensure(parentName, null, null);
  for (const child of children) await ensure(child, parent.id, parent.slug);
}

const total = await prisma.category.count();
console.log(`Categorías de producto: ${created} nuevas, ${total} en total.`);
await prisma.$disconnect();
