import { prisma } from "./prisma.js";
import { slugify } from "../utils/slugify.js";

// Enlace público de la tienda (/tienda/<slug>). Antes, si el nombre limpio ya estaba ocupado se le pegaba un código de la
// hora ("dr-soluciones-informaticas-mvbplqqm"), y casi siempre lo ocupaba una tienda ELIMINADA con el mismo nombre (un
// registro anterior), porque eliminar no soltaba el enlace. Ahora: la tienda eliminada lo suelta, y si el nombre se repite
// de verdad se usa -2, -3...

// Enlace que deja una tienda eliminada: no choca con ningún nombre real.
const releasedSlug = (vendorId) => `eliminada-${vendorId}`;

// Lo ocupa otra tienda viva, como enlace actual o como enlace anterior (que sigue llevando a ella).
async function slugInUse(slug, exceptVendorId) {
  const not = exceptVendorId ? { id: { not: exceptVendorId } } : {};
  const holder = await prisma.vendor.findFirst({
    where: { ...not, OR: [{ slug }, { previousSlugs: { has: slug }, deletedAt: null }] },
    select: { id: true, slug: true, deletedAt: true },
  });
  if (!holder) return false;
  // Una eliminada que todavía lo tiene (de antes de este cambio): se le quita y queda libre.
  if (holder.deletedAt && holder.slug === slug) {
    await prisma.vendor.update({ where: { id: holder.id }, data: { slug: releasedSlug(holder.id) } });
    return false;
  }
  return true;
}

export async function pickVendorSlug(companyName, exceptVendorId = null) {
  const base = slugify(companyName) || "tienda";
  if (!(await slugInUse(base, exceptVendorId))) return base;
  for (let n = 2; ; n++) {
    const candidate = `${base}-${n}`;
    if (!(await slugInUse(candidate, exceptVendorId))) return candidate;
  }
}

// Para los datos de finalizeUserDeletion: la tienda eliminada suelta su enlace y sus enlaces anteriores.
export const releaseVendorSlugData = (vendorId) => ({ slug: releasedSlug(vendorId), previousSlugs: [] });

// El enlace que pide el visitante puede ser uno anterior: devuelve el actual de esa tienda, o el mismo si no se movió.
export async function resolveVendorSlug(slug) {
  if (!slug) return slug;
  const exists = await prisma.vendor.findUnique({ where: { slug }, select: { id: true } });
  if (exists) return slug;
  const moved = await prisma.vendor.findFirst({ where: { previousSlugs: { has: slug }, deletedAt: null }, select: { slug: true } });
  return moved?.slug ?? slug;
}

// Al arrancar: suelta los enlaces de las tiendas eliminadas y pasa al enlace limpio a las que quedaron con el código de la
// hora al final. El enlace viejo se guarda en previousSlugs para que lo ya compartido siga funcionando. Idempotente.
const TIME_CODE = /^[a-z0-9]{7,10}$/;

export async function tidyVendorSlugs() {
  const deleted = await prisma.vendor.findMany({ where: { deletedAt: { not: null }, NOT: { slug: { startsWith: "eliminada-" } } }, select: { id: true } });
  for (const v of deleted) await prisma.vendor.update({ where: { id: v.id }, data: releaseVendorSlugData(v.id) });

  const alive = await prisma.vendor.findMany({ where: { deletedAt: null }, select: { id: true, slug: true, companyName: true, previousSlugs: true } });
  let cleaned = 0;
  for (const v of alive) {
    const base = slugify(v.companyName);
    if (!base || !v.slug.startsWith(`${base}-`)) continue;
    const suffix = v.slug.slice(base.length + 1);
    // Solo el código de la hora (letras y números, con alguna letra); un "-2" puesto a propósito no se toca.
    if (!TIME_CODE.test(suffix) || !/[a-z]/.test(suffix)) continue;
    const next = await pickVendorSlug(v.companyName, v.id);
    if (next === v.slug) continue;
    await prisma.vendor.update({ where: { id: v.id }, data: { slug: next, previousSlugs: [...new Set([...v.previousSlugs, v.slug])] } });
    cleaned++;
  }
  if (deleted.length || cleaned) console.log(`[enlaces] tiendas eliminadas que soltaron su enlace: ${deleted.length}; enlaces limpiados: ${cleaned}`);
  return { released: deleted.length, cleaned };
}
