import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

const createReviewSchema = z.object({
  vendorId: z.string(),
  productId: z.string().optional(),
  rating: z.number().int().min(1).max(5).optional(),
  comment: z.string().min(1).max(1000),
});

// Solo compradores registrados pueden comentar/reseñar (autenticado).
export async function createReview(req, res) {
  const data = createReviewSchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
  if (!vendor || vendor.isBlocked) throw new AppError("Tienda no encontrada.", 404);

  const author = await prisma.user.findUnique({ where: { id: req.user.id } });

  // Bloque 22: "compra verificada" = el autor tiene al menos un pedido no
  // cancelado con esta tienda al momento de comentar. Se calcula una sola
  // vez acá, no se recalcula después (mismo criterio que cualquier badge de
  // "verified purchase" — reflexa el momento del comentario, no el estado
  // actual de pedidos que puedan cancelarse más tarde).
  const hasOrder = await prisma.order.findFirst({
    where: { vendorId: data.vendorId, customerId: req.user.id, status: { not: "CANCELLED" } },
    select: { id: true },
  });

  const review = await prisma.review.create({
    data: {
      vendorId: data.vendorId,
      productId: data.productId,
      userId: req.user.id,
      authorName: author?.fullName ?? "Cliente ZeuDin",
      rating: data.rating,
      comment: data.comment,
      isVerifiedPurchase: !!hasOrder,
    },
  });

  // Si la reseña trae estrellas, recalcula el promedio de la tienda (solo
  // sobre reseñas visibles — una oculta por el admin no debe seguir
  // empujando el promedio público).
  if (data.rating) {
    const agg = await prisma.review.aggregate({
      where: { vendorId: data.vendorId, rating: { not: null }, isHidden: false },
      _avg: { rating: true },
    });
    await prisma.vendor.update({
      where: { id: data.vendorId },
      data: { rating: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0 },
    });
  }

  res.status(201).json({ review });
}

// --- Vendedor (Bloque 22) ---------------------------------------------------
// El vendedor nunca puede ocultar/borrar un comentario (eso es solo admin),
// pero sí responder públicamente — la respuesta se muestra en Store.jsx
// pegada al comentario, como una respuesta de la tienda.

export async function listMyReviews(req, res) {
  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tenés una tienda registrada.", 404);

  const reviews = await prisma.review.findMany({
    where: { vendorId: vendor.id, isHidden: false },
    orderBy: { createdAt: "desc" },
    include: { product: { select: { id: true, name: true, slug: true } } },
  });
  res.json({ reviews });
}

const replySchema = z.object({ reply: z.string().trim().min(1, "Escribí una respuesta.").max(1000) });

export async function replyToReview(req, res) {
  const { id } = req.params;
  const { reply } = replySchema.parse(req.body);

  const vendor = await prisma.vendor.findUnique({ where: { userId: req.user.id } });
  if (!vendor) throw new AppError("No tenés una tienda registrada.", 404);

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review || review.vendorId !== vendor.id) throw new AppError("Comentario no encontrado.", 404);

  const updated = await prisma.review.update({
    where: { id },
    data: { vendorReply: reply, vendorRepliedAt: new Date() },
  });
  res.json({ review: updated });
}

// --- Admin (Bloque 22) ------------------------------------------------------
// El vendedor no puede tocar esto — solo el admin oculta o borra un
// comentario. "Ocultar" es reversible (isHidden), "eliminar" es definitivo.

export async function listAllReviews(_req, res) {
  const reviews = await prisma.review.findMany({
    orderBy: { createdAt: "desc" },
    include: {
      vendor: { select: { id: true, companyName: true, slug: true } },
      product: { select: { id: true, name: true, slug: true } },
    },
    take: 200,
  });
  res.json({ reviews });
}

async function recalculateVendorRating(vendorId) {
  const agg = await prisma.review.aggregate({
    where: { vendorId, rating: { not: null }, isHidden: false },
    _avg: { rating: true },
  });
  await prisma.vendor.update({
    where: { id: vendorId },
    data: { rating: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0 },
  });
}

const toggleHiddenSchema = z.object({ isHidden: z.boolean() });

export async function setReviewHidden(req, res) {
  const { id } = req.params;
  const { isHidden } = toggleHiddenSchema.parse(req.body);

  const existing = await prisma.review.findUnique({ where: { id } });
  if (!existing) throw new AppError("Comentario no encontrado.", 404);

  const review = await prisma.review.update({ where: { id }, data: { isHidden } });
  if (review.vendorId && review.rating) await recalculateVendorRating(review.vendorId);

  res.json({ review });
}

export async function deleteReview(req, res) {
  const { id } = req.params;
  const existing = await prisma.review.findUnique({ where: { id } });
  if (!existing) throw new AppError("Comentario no encontrado.", 404);

  await prisma.review.delete({ where: { id } });
  if (existing.vendorId && existing.rating) await recalculateVendorRating(existing.vendorId);

  res.json({ ok: true });
}
