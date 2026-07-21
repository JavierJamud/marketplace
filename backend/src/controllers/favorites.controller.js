import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Bloque 22: favoritos de producto (ya existía el modelo, nunca se había
// construido ni el endpoint ni la UI) y de tienda (nuevo) — mismo modelo
// Favorite, exactamente uno de productId/vendorId por fila. Se incluye todo
// lo que ProductCard.jsx/StoreCard.jsx necesitan para poder reusar esos
// mismos componentes tal cual en la pestaña "Favoritos" del panel.
export async function listMyFavorites(req, res) {
  const favorites = await prisma.favorite.findMany({
    where: { userId: req.user.id },
    orderBy: { createdAt: "desc" },
    include: {
      product: {
        include: { vendor: { include: { locations: { include: { province: true, municipality: true } } } } },
      },
      vendor: {
        include: {
          locations: { include: { province: true, municipality: true } },
          category: true,
          businessCategory: true,
          _count: { select: { products: { where: { isActive: true } } } },
        },
      },
    },
  });
  res.json({ favorites });
}

const addFavoriteSchema = z
  .object({ productId: z.string().min(1).optional(), vendorId: z.string().min(1).optional() })
  .refine((d) => !!d.productId !== !!d.vendorId, { message: "Mandá productId o vendorId, exactamente uno de los dos." });

export async function addFavorite(req, res) {
  const data = addFavoriteSchema.parse(req.body);

  if (data.productId) {
    const product = await prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new AppError("Producto no encontrado.", 404);
    const existing = await prisma.favorite.findUnique({ where: { userId_productId: { userId: req.user.id, productId: data.productId } } });
    if (existing) throw new AppError("Ya tenés este producto en favoritos.", 409);
  } else {
    const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
    if (!vendor || vendor.isBlocked) throw new AppError("Tienda no encontrada.", 404);
    const existing = await prisma.favorite.findUnique({ where: { userId_vendorId: { userId: req.user.id, vendorId: data.vendorId } } });
    if (existing) throw new AppError("Ya tenés esta tienda en favoritos.", 409);
  }

  const favorite = await prisma.favorite.create({
    data: { userId: req.user.id, productId: data.productId, vendorId: data.vendorId },
  });
  res.status(201).json({ favorite });
}

export async function removeFavorite(req, res) {
  const { id } = req.params;
  const favorite = await prisma.favorite.findUnique({ where: { id } });
  if (!favorite || favorite.userId !== req.user.id) throw new AppError("Favorito no encontrado.", 404);

  await prisma.favorite.delete({ where: { id } });
  res.json({ ok: true });
}
