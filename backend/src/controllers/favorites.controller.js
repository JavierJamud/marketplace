import { toPublicVendor } from "../lib/publicVendor.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Las mismas condiciones con las que getVendorBySlug y getProductBySlug (products.controller.js) responden 404.
const vendorIsPublic = (v) => !!v && !v.isBlocked && v.status === "ACTIVE" && !v.deletedAt;
const productIsPublic = (p) =>
  !!p &&
  p.isActive &&
  !p.hiddenFromStore &&
  !p.overQuota &&
  !p.suspendedAt &&
  vendorIsPublic(p.vendor) &&
  !(p.availableForTableMenu && p.vendor.menuPublic === false);

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
          // Mismo conteo que listVendors (vendors.controller.js): lo solo de mesa o fuera del cupo del plan no se ve en la
          // tienda, así que tampoco suma en la tarjeta.
          _count: { select: { products: { where: { isActive: true, hiddenFromStore: false, overQuota: false } } } },
        },
      },
    },
  });
  // Solo se devuelve lo que el cliente puede abrir: una tienda bloqueada, suspendida o eliminada (o un producto que la
  // ficha pública da por "no encontrado") salía en la pestaña Favoritos y al tocarlo llevaba a una página de error. La fila
  // no se borra: si la tienda o el producto vuelven a estar visibles, reaparece sola.
  const visible = favorites.filter((fav) => (fav.vendorId ? vendorIsPublic(fav.vendor) : productIsPublic(fav.product)));
  // La fila Vendor completa lleva datos legales y de facturación del dueño: al cliente solo le llega la parte pública.
  const safe = visible.map((fav) => ({
    ...fav,
    vendor: toPublicVendor(fav.vendor),
    product: fav.product ? { ...fav.product, vendor: toPublicVendor(fav.product.vendor) } : fav.product,
  }));
  res.json({ favorites: safe });
}

const addFavoriteSchema = z
  .object({ productId: z.string().min(1).optional(), vendorId: z.string().min(1).optional() })
  .refine((d) => !!d.productId !== !!d.vendorId, { message: "Manda productId o vendorId, exactamente uno de los dos." });

export async function addFavorite(req, res) {
  const data = addFavoriteSchema.parse(req.body);

  if (data.productId) {
    const product = await prisma.product.findUnique({ where: { id: data.productId } });
    if (!product) throw new AppError("Producto no encontrado.", 404);
    const existing = await prisma.favorite.findUnique({ where: { userId_productId: { userId: req.user.id, productId: data.productId } } });
    if (existing) throw new AppError("Ya tienes este producto en favoritos.", 409);
  } else {
    const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
    if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE") throw new AppError("Tienda no encontrada.", 404);
    const existing = await prisma.favorite.findUnique({ where: { userId_vendorId: { userId: req.user.id, vendorId: data.vendorId } } });
    if (existing) throw new AppError("Ya tienes esta tienda en favoritos.", 409);
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
