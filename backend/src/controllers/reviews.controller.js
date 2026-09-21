import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { getBrandSettings, getReviewPolicy } from "./settings.controller.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { logActivity, actorRoleForVendorAction } from "../lib/activityLog.js";

// Bloque 117/118 (pedido explícito): un mismo usuario logueado puede dejar
// hasta `maxPerProduct` comentarios por ventana de tiempo POR PRODUCTO
// (Product.jsx) — cada producto es su propio tope, sin importar si son de
// la misma tienda o no, así que puede reseñar 2 productos distintos de una
// misma tienda el mismo día. La reseña GENERAL de una tienda (Store.jsx, sin
// producto) tiene su propio tope aparte, `maxPerStore`, que nunca comparte
// balde con el de sus productos. Los 3 valores (ventana en horas, tope por
// producto, tope por tienda) más si las cuentas VENDOR pueden comentar en
// absoluto son configurables desde el admin (AdminReviews.jsx →
// getReviewPolicy/updateReviewPolicy en settings.controller.js) — antes
// eran constantes hardcodeadas acá. Mismo criterio/idioma que
// PRODUCT_REQUEST_DEDUP_HOURS en products.controller.js.

const __dirname = dirname(fileURLToPath(import.meta.url));
// Bloque 52: fotos de reseñas — públicas (se muestran junto al comentario en
// Store.jsx), mismo criterio que uploads/offers.
export const REVIEW_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "reviews");

// Multipart siempre (aunque no traiga imágenes) — así el mismo endpoint sirve
// para tiendas verificadas (con fotos) y no verificadas (sin ellas), sin dos
// rutas distintas. rating/productId llegan como string por FormData.
const createReviewSchema = z.object({
  vendorId: z.string(),
  productId: z.string().optional(),
  rating: z.coerce.number().int().min(1).max(5).optional(),
  comment: z.string().trim().min(1).max(1000),
});

// Solo compradores registrados pueden comentar/reseñar (autenticado, ver
// reviews.routes.js). Adjuntar imágenes además requiere que la tienda esté
// verificada (store.verified) — si una tienda no verificada recibe archivos
// igual (API manipulada, la UI ya oculta el selector), se rechaza entero en
// vez de guardarlos silenciosamente.
export async function createReview(req, res) {
  try {
    const data = createReviewSchema.parse(req.body);
    const policy = await getReviewPolicy();

    // Bloque 118 (pedido explícito): "los vendedores no pueden agregar
    // comentarios a ninguna tienda ni producto" — habilitable/deshabilitable
    // desde el admin (default: sí pueden, mismo comportamiento de siempre).
    // Bloquea a CUALQUIER cuenta VENDOR, incluida la del dueño de esta misma
    // tienda (no hay excepción "puede reseñarse a sí mismo").
    if (req.user.role === "VENDOR" && !policy.vendorsCanReview) {
      throw new AppError("Las cuentas de vendedor no pueden comentar ni reseñar tiendas o productos.", 403);
    }

    const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId } });
    if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE") throw new AppError("Tienda no encontrada.", 404);

    if (req.files?.length && vendor.verificationStatus !== "VERIFIED") {
      throw new AppError("Adjuntar fotos a una reseña solo está disponible en tiendas verificadas.", 403);
    }

    // Bloque 117/118: hasta `maxPerProduct` comentarios por ventana POR
    // PRODUCTO — reseñar el producto A no consume el cupo del producto B de
    // la misma tienda. La reseña general de la tienda (sin producto) tiene
    // su propio tope aparte, `maxPerStore`.
    const since = new Date(Date.now() - policy.dedupHours * 60 * 60 * 1000);
    const max = data.productId ? policy.maxPerProduct : policy.maxPerStore;
    const commentsInWindow = await prisma.review.count({
      where: { vendorId: data.vendorId, productId: data.productId ?? null, userId: req.user.id, createdAt: { gte: since } },
    });
    if (commentsInWindow >= max) {
      throw new AppError(
        data.productId
          ? "Ya alcanzaste el límite de reseñas para este producto por ahora — puedes volver a intentarlo más tarde."
          : "Ya alcanzaste el límite de comentarios para esta tienda por ahora — puedes volver a intentarlo más tarde.",
        429
      );
    }

    const author = await prisma.user.findUnique({ where: { id: req.user.id } });
    const { siteName } = await getBrandSettings();

    // Bloque 22: "compra verificada" = el autor tiene al menos un pedido no
    // cancelado con esta tienda al momento de comentar. Se calcula una sola
    // vez acá, no se recalcula después (mismo criterio que cualquier badge de
    // "verified purchase" — reflexa el momento del comentario, no el estado
    // actual de pedidos que puedan cancelarse más tarde).
    const hasOrder = await prisma.order.findFirst({
      where: { vendorId: data.vendorId, customerId: req.user.id, status: { not: "CANCELLED" } },
      select: { id: true },
    });

    const images = (req.files ?? []).map((f) => `/uploads/reviews/${f.filename}`);

    const review = await prisma.review.create({
      data: {
        vendorId: data.vendorId,
        productId: data.productId,
        userId: req.user.id,
        authorName: author?.fullName ?? `Cliente ${siteName}`,
        rating: data.rating,
        comment: data.comment,
        images,
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
      if (data.productId) await recalculateProductRating(data.productId);
    }

    logActivity({
      actorId: req.user.id,
      actorRole: "CUSTOMER",
      vendorId: data.vendorId,
      action: "review_posted",
      description: `Dejó una reseña en "${vendor.companyName}"`,
      meta: { reviewId: review.id, productId: data.productId ?? null, rating: data.rating ?? null },
    });

    res.status(201).json({ review });
  } catch (err) {
    // Igual criterio que offers.controller.js: Multer ya escribió los
    // archivos a disco antes de que corriera este handler — si algo falla
    // después (validación, tienda no verificada, etc.) no deben quedar huérfanos.
    if (req.files?.length) {
      for (const f of req.files) unlink(join(REVIEW_UPLOAD_DIR, f.filename)).catch(() => {});
    }
    throw err;
  }
}

// --- Vendedor (Bloque 22) ---------------------------------------------------
// El vendedor nunca puede ocultar/borrar un comentario (eso es solo admin),
// pero sí responder públicamente — la respuesta se muestra en Store.jsx
// pegada al comentario, como una respuesta de la tienda.

// Bloque 183: resolveMyVendor — soporta usuarios de sistema con la
// sección "resenas" asignada (ver vendors.routes.js).
export async function listMyReviews(req, res) {
  const vendor = await resolveMyVendor(req.user.id);

  // Bloque 69: ya NO filtra isHidden:false — el vendedor necesita ver el
  // estado real de lo que reportó (oculto esperando revisión, mantenido de
  // nuevo visible, o suspendido) para que reportar tenga algún feedback. La
  // UI (VendorReviews.jsx) es quien decide cómo mostrar cada estado.
  const reviews = await prisma.review.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    include: { product: { select: { id: true, name: true, slug: true } } },
  });
  res.json({ reviews });
}

const replySchema = z.object({ reply: z.string().trim().min(1, "Escribe una respuesta.").max(1000) });

export async function replyToReview(req, res) {
  const { id } = req.params;
  const { reply } = replySchema.parse(req.body);

  const vendor = await resolveMyVendor(req.user.id);

  const review = await prisma.review.findUnique({ where: { id } });
  if (!review || review.vendorId !== vendor.id) throw new AppError("Comentario no encontrado.", 404);

  const updated = await prisma.review.update({
    where: { id },
    data: { vendorReply: reply, vendorRepliedAt: new Date() },
  });
  logActivity({
    actorId: req.user.id,
    actorRole: actorRoleForVendorAction(req),
    vendorId: vendor.id,
    action: "review_replied",
    description: `Respondió una reseña en "${vendor.companyName}"`,
    meta: { reviewId: id },
  });
  res.json({ review: updated });
}

// --- Reportar (Bloque 69, pedido explícito) ---------------------------------
// Un solo endpoint para los 2 lugares desde donde se puede reportar: el
// panel de vendedor (sobre reseñas de SU propia tienda, VendorReviews.jsx) y
// la cuenta de cualquier cliente logueado (sobre cualquier reseña que vea en
// Store.jsx/Product.jsx, nunca la propia). No hay gate de "solo el dueño de
// la tienda" acá a propósito — cualquier usuario autenticado puede reportar
// contenido que ve, igual que un vendedor navegando otra tienda como
// cliente; lo único que nunca se permite es reportar tu propio comentario.
function assertReportable(review) {
  if (review.reportStatus === "KEPT") {
    throw new AppError("Este comentario ya fue revisado por el equipo y se decidió mantenerlo — no se puede volver a reportar.", 409);
  }
  if (review.reportStatus === "REPORTED") {
    throw new AppError("Este comentario ya está reportado y esperando revisión del admin.", 409);
  }
  if (review.reportStatus === "SUSPENDED") {
    throw new AppError("Este comentario ya fue suspendido por el admin.", 409);
  }
}

const reportReviewSchema = z.object({ reason: z.string().trim().max(300).optional() });

export async function reportReview(req, res) {
  const { id } = req.params;
  const { reason } = reportReviewSchema.parse(req.body);

  const review = await prisma.review.findUnique({
    where: { id },
    include: { vendor: { select: { companyName: true, userId: true } } },
  });
  if (!review) throw new AppError("Comentario no encontrado.", 404);
  if (review.userId === req.user.id) throw new AppError("No puedes reportar tu propio comentario.", 400);
  assertReportable(review);

  const updated = await prisma.review.update({
    where: { id },
    data: {
      isHidden: true,
      reportStatus: "REPORTED",
      reportedById: req.user.id,
      reportReason: reason || null,
      reportedAt: new Date(),
    },
  });
  if (updated.vendorId && updated.rating) await recalculateVendorRating(updated.vendorId);
  if (updated.productId && updated.rating) await recalculateProductRating(updated.productId);

  // Bloque 69 (pedido explícito): "el admin siempre debe estar notificado de
  // todas estas acciones de los vendedores y clientes también" — cubre los
  // 2 orígenes posibles con el mismo aviso, solo cambia la redacción.
  const reporterIsVendorOwner = review.vendor?.userId === req.user.id;
  logActivity({
    actorId: req.user.id,
    actorRole: reporterIsVendorOwner ? "VENDOR" : "CUSTOMER",
    vendorId: review.vendorId ?? undefined,
    action: "review_reported",
    description: `Reportó un comentario${review.vendor ? ` en "${review.vendor.companyName}"` : ""}`,
    meta: { reviewId: id, reason: reason || null },
  });
  await notifyAdminActionNeeded(
    "Un comentario fue reportado",
    `${reporterIsVendorOwner ? `El vendedor de "${review.vendor?.companyName}"` : "Un cliente"} reportó un comentario${
      reason ? ` (motivo: "${reason}")` : ""
    } — quedó oculto mientras lo revisas en el panel de administración.`,
    review.vendorId ?? undefined
  );

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
      // Bloque 69: quién reportó — el admin necesita saber si fue el
      // vendedor de la propia tienda o un cliente cualquiera para decidir.
      reportedBy: { select: { fullName: true, role: true } },
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

// Bloque 116 (pedido explícito): mismo criterio que recalculateVendorRating
// de arriba, pero acotado a las reseñas de ESTE producto puntual (no todas
// las de la tienda) — es lo que alimenta las estrellas + "(N)" de
// ProductCard.jsx. También guarda reviewCount (a diferencia del rating de
// tienda, acá la tarjeta necesita mostrar la cantidad, no solo el promedio).
async function recalculateProductRating(productId) {
  const agg = await prisma.review.aggregate({
    where: { productId, rating: { not: null }, isHidden: false },
    _avg: { rating: true },
    _count: { rating: true },
  });
  await prisma.product.update({
    where: { id: productId },
    data: {
      rating: agg._avg.rating ? Math.round(agg._avg.rating * 10) / 10 : 0,
      reviewCount: agg._count.rating,
    },
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
  if (review.productId && review.rating) await recalculateProductRating(review.productId);

  res.json({ review });
}

// Bloque 69 (pedido explícito): resuelve un reporte pendiente — "mantener"
// vuelve a mostrar el comentario y lo sella contra nuevos reportes
// (assertReportable de arriba rechaza cualquier intento futuro); "suspender"
// lo deja oculto, y desde ahí la única acción posible es `deleteReview` de
// abajo (ya existente, exclusivo del admin).
const resolveReportSchema = z.object({ decision: z.enum(["keep", "suspend"]) });

export async function resolveReviewReport(req, res) {
  const { id } = req.params;
  const { decision } = resolveReportSchema.parse(req.body);

  const existing = await prisma.review.findUnique({ where: { id } });
  if (!existing) throw new AppError("Comentario no encontrado.", 404);
  if (existing.reportStatus !== "REPORTED") {
    throw new AppError("Este comentario no tiene ningún reporte pendiente de revisión.", 409);
  }

  const review = await prisma.review.update({
    where: { id },
    data: {
      isHidden: decision === "suspend",
      reportStatus: decision === "keep" ? "KEPT" : "SUSPENDED",
      reportResolvedById: req.user.id,
      reportResolvedAt: new Date(),
    },
  });
  if (review.vendorId && review.rating) await recalculateVendorRating(review.vendorId);
  if (review.productId && review.rating) await recalculateProductRating(review.productId);

  res.json({ review });
}

export async function deleteReview(req, res) {
  const { id } = req.params;
  const existing = await prisma.review.findUnique({ where: { id } });
  if (!existing) throw new AppError("Comentario no encontrado.", 404);

  await prisma.review.delete({ where: { id } });
  if (existing.vendorId && existing.rating) await recalculateVendorRating(existing.vendorId);
  if (existing.productId && existing.rating) await recalculateProductRating(existing.productId);

  res.json({ ok: true });
}
