import { prisma } from "../lib/prisma.js";

// Bloque 52: ahora incluye `children` de cada categoría top-level (antes
// solo devolvía el nivel raíz) — Shop.jsx (pills de filtro) sigue leyendo
// solo `name`/`id` de cada una tal cual, así que no rompe nada; el shape
// nuevo lo aprovecha VendorProducts.jsx para ofrecer también subcategorías
// al cargar un producto (antes invisibles fuera del buscador).
export async function listCategories(_req, res) {
  const categories = await prisma.category.findMany({
    where: { parentId: null },
    orderBy: { name: "asc" },
    select: {
      id: true,
      name: true,
      slug: true,
      children: { orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } },
    },
  });
  res.json({ categories });
}
