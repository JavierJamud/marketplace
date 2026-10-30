import { z } from "zod";
import { isStoreOwnerPerson } from "../lib/accountRealm.js";
import { recalcVendorRating, recalcProductRating } from "../lib/ratings.js";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { deleteUploadedImages } from "../lib/uploadFiles.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { getBrandSettings, getReviewPolicy } from "./settings.controller.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { logActivity, actorRoleForVendorAction } from "../lib/activityLog.js";
import { assertPlanAllows } from "../lib/planConfig.js";
import { sendReviewReplyEmail } from "../lib/email.js";
import { env } from "../config/env.js";
import { paginationQuerySchema, pageArgs, pageMeta } from "../lib/pagination.js";
import { requireVendorWrite } from "../middleware/requireVendorAccess.js";

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
  // Título corto y opcional: se muestra en negrita sobre el comentario.
  title: z.string().trim().max(40, "El título admite hasta 40 caracteres.").optional(),
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
    // Nadie reseña su propia tienda ni sus productos, tampoco el dueño desde su cuenta de cliente (cuentas separadas: mismo
    // correo o teléfono, lib/accountRealm.js).
    if (await isStoreOwnerPerson(req.user.id, vendor.userId)) throw new AppError("No puedes reseñar tu propia tienda ni sus productos.", 403);

    if (req.files?.length) {
      if (vendor.verificationStatus !== "VERIFIED") {
        throw new AppError("Adjuntar fotos a una reseña solo está disponible en tiendas verificadas.", 403);
      }
      await assertPlanAllows(vendor, "allowReviewPhotos", "Esta tienda no admite fotos en sus reseñas.");
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
          ? "Ya alcanzaste el límite de reseñas para este producto por ahora. Puedes volver a intentarlo más tarde."
          : "Ya alcanzaste el límite de comentarios para esta tienda por ahora. Puedes volver a intentarlo más tarde.",
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
    // Nombre del producto en la reseña: sigue mostrándose aunque después se borre el producto.
    const reviewedProduct = data.productId ? await prisma.product.findUnique({ where: { id: data.productId }, select: { name: true } }) : null;

    const review = await prisma.review.create({
      data: {
        vendorId: data.vendorId,
        productId: data.productId,
        productName: reviewedProduct?.name ?? null,
        userId: req.user.id,
        authorName: author?.fullName ?? `Cliente ${siteName}`,
        rating: data.rating,
        title: data.title || null,
        comment: data.comment,
        images,
        isVerifiedPurchase: !!hasOrder,
      },
    });

    // Si la reseña trae estrellas, recalcula el promedio de la tienda (solo
    // sobre reseñas visibles — una oculta por el admin no debe seguir
    // empujando el promedio público).
    if (data.rating) {
      await recalcVendorRating(data.vendorId);
      if (data.productId) await recalcProductRating(data.productId);
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
  // Al cliente se le avisa por correo, salvo que la respuesta sea la misma que ya tenía.
  if (review.vendorReply !== reply) void notifyReviewReply(review, { responder: vendor.companyName, reply, fromStore: true });
  res.json({ review: updated });
}

// El equipo de la plataforma también puede responder cualquier comentario. Su respuesta es aparte de la de la tienda (un comentario puede tener las dos) y se publica con el nombre de la plataforma.
export async function adminReplyToReview(req, res) {
  const { id } = req.params;
  const { reply } = replySchema.parse(req.body);
  const review = await prisma.review.findUnique({ where: { id } });
  if (!review) throw new AppError("Comentario no encontrado.", 404);

  const updated = await prisma.review.update({
    where: { id },
    data: { adminReply: reply, adminRepliedAt: new Date() },
  });
  if (review.adminReply !== reply) {
    const { siteName } = await getBrandSettings();
    void notifyReviewReply(review, { responder: siteName, reply });
  }
  res.json({ review: updated });
}

// Correo al autor del comentario con la respuesta que recibió. Nunca bloquea ni hace fallar la respuesta: si el autor ya no existe,
// no tiene correo o el envío falla, simplemente no se avisa.
async function notifyReviewReply(review, { responder, reply, fromStore = false }) {
  try {
    if (!review.userId || !review.vendorId) return;
    const [customer, vendor, product] = await Promise.all([
      prisma.user.findUnique({ where: { id: review.userId }, select: { email: true, fullName: true, deletedAt: true } }),
      prisma.vendor.findUnique({ where: { id: review.vendorId }, select: { id: true, slug: true, companyName: true } }),
      review.productId ? prisma.product.findUnique({ where: { id: review.productId }, select: { name: true, slug: true } }) : null,
    ]);
    if (!customer?.email || customer.deletedAt || !vendor) return;
    const path = product ? `/producto/${vendor.slug}/${product.slug}` : `/tienda/${vendor.slug}`;
    await sendReviewReplyEmail({
      to: customer.email,
      vendorId: vendor.id,
      fromStore,
      customerName: review.authorName || customer.fullName,
      responder,
      targetLabel: product?.name ?? vendor.companyName,
      comment: review.comment ?? "",
      reply,
      ctaUrl: `${env.frontendUrl}${path}#resenas`,
    });
  } catch (err) {
    console.error("[reviews] no se pudo avisar de la respuesta:", err.message);
  }
}

// --- Reportar (Bloque 69, pedido explícito) ---------------------------------
// Un solo endpoint para los 2 lugares desde donde se puede reportar: el
// panel de vendedor (VendorReviews.jsx) y la cuenta de cualquier cliente
// logueado (Store.jsx/Product.jsx). Reglas, todas en reportReview:
// - Un cliente puede reportar cualquier comentario que ve, nunca el propio.
// - El dueño de la tienda y su personal actúan por la tienda: necesitan
//   nivel "Modificar" en "resenas" (requireVendorWrite), y el personal solo
//   reporta comentarios de la tienda para la que trabaja.
// - Hay topes: REPORTS_PER_DAY por cuenta y MAX_PENDING_TEAM_REPORTS por
//   equipo de tienda (ver más abajo).
function assertReportable(review) {
  if (review.reportStatus === "KEPT") {
    throw new AppError("Este comentario ya fue revisado por el equipo y se decidió mantenerlo. No se puede volver a reportar.", 409);
  }
  if (review.reportStatus === "REPORTED") {
    throw new AppError("Este comentario ya está reportado y esperando revisión del admin.", 409);
  }
  if (review.reportStatus === "SUSPENDED") {
    throw new AppError("Este comentario ya fue suspendido por el admin.", 409);
  }
}

const reportReviewSchema = z.object({ reason: z.string().trim().max(300).optional() });

// Topes del reporte. Ocultar al instante es a propósito (Bloque 69), pero sin topes una tienda podía reportar todas sus
// reseñas negativas, dejarlas ocultas y subir su nota hasta que el admin revisara, y cualquier cuenta podía vaciar los
// comentarios de una tienda ajena. Se cuentan en la base (reportedById y reportedAt quedan guardados en cada reseña), así
// valen igual después de reiniciar el servidor y entre varias instancias.
// - REPORTS_PER_DAY: reportes de una misma cuenta en 24 horas, en cualquier tienda.
// - MAX_PENDING_TEAM_REPORTS: reseñas de una tienda reportadas por su propio equipo (dueño o personal) que esperan revisión a
//   la vez. Cuando el admin resuelve una, se libera el lugar.
const REPORTS_PER_DAY = 5;
const MAX_PENDING_TEAM_REPORTS = 3;

export async function reportReview(req, res) {
  const { id } = req.params;
  const { reason } = reportReviewSchema.parse(req.body);

  const review = await prisma.review.findUnique({
    where: { id },
    include: { vendor: { select: { id: true, companyName: true, userId: true } } },
  });
  if (!review) throw new AppError("Comentario no encontrado.", 404);
  if (review.userId === req.user.id) throw new AppError("No puedes reportar tu propio comentario.", 400);
  assertReportable(review);

  // Quien reporta desde el panel de la tienda actúa por ella: mismas reglas que responder una reseña (sección "Reseñas" con
  // nivel "Modificar", tienda no bloqueada y, para el personal, plan con usuarios del equipo). Antes la ruta solo pedía
  // sesión y el personal de solo lectura también podía ocultar reseñas. El personal no es un cliente: solo reporta reseñas
  // de la tienda para la que trabaja.
  const reporterIsVendorOwner = !!review.vendor && review.vendor.userId === req.user.id;
  const reporterIsStaff = req.user.role === "VENDOR_STAFF";
  if (reporterIsVendorOwner || reporterIsStaff) {
    await requireVendorWrite("resenas")(req, null, () => {});
    if (reporterIsStaff && req.vendorStaff?.vendorId !== review.vendorId) {
      throw new AppError("Solo puedes reportar comentarios de la tienda para la que trabajas.", 403);
    }
  }
  const reporterIsTeam = reporterIsVendorOwner || reporterIsStaff;

  // Contar los topes y marcar el reporte van en una sola transacción, detrás de candados de Postgres por cuenta y por
  // tienda: sin ellos, varios reportes a la vez (de la misma cuenta, o del mismo equipo sobre reseñas distintas) pasaban
  // los dos conteos antes de que ninguno guardara y superaban el tope. Los candados se sueltan solos al cerrar la
  // transacción. Siempre se toma primero el de la cuenta y después el de la tienda, así dos reportes no se traban entre sí.
  const count = await prisma.$transaction(async (tx) => {
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`review-report:user:${req.user.id}`})::bigint)`;
    if (reporterIsTeam && review.vendorId) {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`review-report:vendor:${review.vendorId}`})::bigint)`;
    }

    const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const reportedToday = await tx.review.count({ where: { reportedById: req.user.id, reportedAt: { gte: since } } });
    if (reportedToday >= REPORTS_PER_DAY) {
      throw new AppError(`Ya reportaste ${REPORTS_PER_DAY} comentarios en las últimas 24 horas. Podrás reportar otro más tarde.`, 429);
    }
    if (reporterIsTeam && review.vendorId) {
      const staff = await tx.vendorStaff.findMany({ where: { vendorId: review.vendorId }, select: { userId: true } });
      const teamIds = [review.vendor.userId, ...staff.map((s) => s.userId)].filter(Boolean);
      const pendingFromTeam = await tx.review.count({
        where: { vendorId: review.vendorId, reportStatus: "REPORTED", reportedById: { in: teamIds } },
      });
      if (pendingFromTeam >= MAX_PENDING_TEAM_REPORTS) {
        throw new AppError(
          `Tu tienda ya tiene ${MAX_PENDING_TEAM_REPORTS} comentarios reportados esperando revisión. Podrás reportar otro cuando el equipo de la plataforma los revise.`,
          429
        );
      }
    }

    // Solo si nadie lo reportó entretanto: dos reportes a la vez del mismo comentario pisaban al primero (y su motivo).
    const result = await tx.review.updateMany({
      where: { id, reportStatus: null },
      data: {
        isHidden: true,
        reportStatus: "REPORTED",
        reportedById: req.user.id,
        reportReason: reason || null,
        reportedAt: new Date(),
      },
    });
    return result.count;
  });
  if (count === 0) throw new AppError("Este comentario ya está reportado y esperando revisión del admin.", 409);
  const updated = await prisma.review.findUnique({ where: { id } });
  if (updated.vendorId && updated.rating) await recalculateVendorRating(updated.vendorId);
  if (updated.productId && updated.rating) await recalculateProductRating(updated.productId);

  // Bloque 69 (pedido explícito): "el admin siempre debe estar notificado de
  // todas estas acciones de los vendedores y clientes también" — cubre los
  // 2 orígenes posibles con el mismo aviso, solo cambia la redacción.
  logActivity({
    actorId: req.user.id,
    actorRole: reporterIsTeam ? actorRoleForVendorAction(req) : "CUSTOMER",
    vendorId: review.vendorId ?? undefined,
    action: "review_reported",
    description: `Reportó un comentario${review.vendor ? ` en "${review.vendor.companyName}"` : ""}`,
    meta: { reviewId: id, reason: reason || null },
  });
  await notifyAdminActionNeeded(
    "Un comentario fue reportado",
    `${reporterIsTeam ? `${reporterIsStaff ? "El personal" : "El vendedor"} de "${review.vendor?.companyName}"` : "Un cliente"} reportó un comentario${
      reason ? ` (motivo: "${reason}")` : ""
    }. Quedó oculto mientras lo revisas en el panel de administración.`,
    review.vendorId ?? undefined,
    { url: `/admin/comentarios?review=${id}` }
  );

  res.json({ review: updated });
}

// --- Admin (Bloque 22) ------------------------------------------------------
// El vendedor no puede tocar esto — solo el admin oculta o borra un
// comentario. "Ocultar" es reversible (isHidden), "eliminar" es definitivo.

const ADMIN_REVIEW_INCLUDE = {
  vendor: { select: { id: true, companyName: true, slug: true } },
  product: { select: { id: true, name: true, slug: true } },
  // Bloque 69: quién reportó. El admin necesita saber si fue el
  // vendedor de la propia tienda o un cliente cualquiera para decidir.
  reportedBy: { select: { fullName: true, role: true } },
};

// Filtro por estado del reporte. NONE = nunca reportados. Sin page, pageSize ni reportStatus responde como antes (una sola
// lista), para que la pantalla actual siga funcionando mientras no pida páginas.
const adminReviewsQuerySchema = paginationQuerySchema.partial().extend({
  reportStatus: z.enum(["REPORTED", "KEPT", "SUSPENDED", "NONE"]).optional(),
});
const LEGACY_LIST_SIZE = 200;

// Cuántos hay en cada estado, para los contadores de las pestañas.
async function reviewReportCounts() {
  const [grouped, total] = await Promise.all([
    prisma.review.groupBy({ by: ["reportStatus"], _count: { _all: true } }),
    prisma.review.count(),
  ]);
  const counts = { total, REPORTED: 0, KEPT: 0, SUSPENDED: 0, NONE: 0 };
  for (const g of grouped) counts[g.reportStatus ?? "NONE"] = g._count._all;
  return counts;
}

export async function listAllReviews(req, res) {
  const query = adminReviewsQuerySchema.parse(req.query ?? {});
  const counts = await reviewReportCounts();

  if (query.page === undefined && query.pageSize === undefined && !query.reportStatus) {
    // Antes eran solo los 200 más nuevos: un comentario reportado más viejo no salía en la lista y el aviso de la campana
    // (?review=id) llevaba a una pantalla sin él. Los reportados pendientes van siempre, primero (son lo que hay que resolver).
    const [pending, latest] = await Promise.all([
      prisma.review.findMany({ where: { reportStatus: "REPORTED" }, orderBy: { reportedAt: "asc" }, include: ADMIN_REVIEW_INCLUDE, take: LEGACY_LIST_SIZE }),
      prisma.review.findMany({ orderBy: { createdAt: "desc" }, include: ADMIN_REVIEW_INCLUDE, take: LEGACY_LIST_SIZE }),
    ]);
    const pendingIds = new Set(pending.map((r) => r.id));
    return res.json({ reviews: [...pending, ...latest.filter((r) => !pendingIds.has(r.id))], counts });
  }

  const paging = paginationQuerySchema.parse({ page: query.page, pageSize: query.pageSize });
  const where = query.reportStatus === "NONE" ? { reportStatus: null } : query.reportStatus ? { reportStatus: query.reportStatus } : {};
  // Los reportados pendientes, del más antiguo al más nuevo: el que lleva más tiempo oculto se revisa primero.
  const orderBy = query.reportStatus === "REPORTED" ? { reportedAt: "asc" } : { createdAt: "desc" };
  const [reviews, total] = await Promise.all([
    prisma.review.findMany({ where, orderBy, include: ADMIN_REVIEW_INCLUDE, ...pageArgs(paging) }),
    prisma.review.count({ where }),
  ]);
  res.json({ reviews, counts, ...pageMeta(paging, total) });
}

// Un comentario suelto para el admin: el aviso de la campana lleva a ?review=id, y ese comentario puede no estar en la
// página que se cargó. Necesita la ruta GET /admin/reviews/:id en admin.routes.js.
export async function getAdminReview(req, res) {
  const review = await prisma.review.findUnique({ where: { id: req.params.id }, include: ADMIN_REVIEW_INCLUDE });
  if (!review) throw new AppError("Comentario no encontrado.", 404);
  res.json({ review });
}

// Promedio y cantidad de reseñas: un solo cálculo para todo el sitio (ver lib/ratings.js).
const recalculateVendorRating = recalcVendorRating;
const recalculateProductRating = recalcProductRating;

const toggleHiddenSchema = z.object({ isHidden: z.boolean() });

export async function setReviewHidden(req, res) {
  const { id } = req.params;
  const { isHidden } = toggleHiddenSchema.parse(req.body);

  const existing = await prisma.review.findUnique({ where: { id } });
  if (!existing) throw new AppError("Comentario no encontrado.", 404);
  // "Mostrar" no puede saltarse el reporte: un comentario reportado se vuelve a mostrar con "Mantener" (que además lo sella
  // contra nuevos reportes) y uno suspendido queda oculto hasta que se elimine. Antes "Mostrar" lo publicaba igual y el
  // reporte quedaba pendiente con el comentario a la vista.
  if (!isHidden && existing.reportStatus === "REPORTED") {
    throw new AppError("Este comentario tiene un reporte sin resolver. Usa Mantener para volver a mostrarlo.", 409);
  }
  if (!isHidden && existing.reportStatus === "SUSPENDED") {
    throw new AppError("Este comentario fue suspendido por un reporte y no se puede volver a mostrar. Solo puedes eliminarlo.", 409);
  }

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
  void deleteUploadedImages(existing.images);
  if (existing.vendorId && existing.rating) await recalculateVendorRating(existing.vendorId);
  if (existing.productId && existing.rating) await recalculateProductRating(existing.productId);

  res.json({ ok: true });
}
