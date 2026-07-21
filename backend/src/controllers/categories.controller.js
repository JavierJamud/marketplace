import { prisma } from "../lib/prisma.js";

export async function listCategories(_req, res) {
  const categories = await prisma.category.findMany({
    where: { parentId: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true },
  });
  res.json({ categories });
}
