import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { getOfferPolicy } from "./settings.controller.js";
import { withComputedVendorFields } from "../services/vendorVerification.service.js";
import { logActivity } from "../lib/activityLog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Igual criterio que PRODUCT_UPLOAD_DIR (products.controller.js): imágenes
// públicas. Carpeta plana (no por tienda) porque las CUSTOM no tienen una
// "carpeta dueña" natural y las PRODUCT reusan la URL que ya vive en la
// carpeta del producto — acá solo se guardan los archivos subidos para
// ofertas personalizadas.
export const OFFER_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "offers");

// Bloque 51: el default de duración y el cooldown entre publicaciones ahora
// son configurables por el admin (SiteSettings.offerCooldownDays/
// offerDefaultDurationDays, ver getOfferPolicy en settings.controller.js) en
// vez de constantes fijas acá. MIN/MAX sí se quedan hardcodeados — son el
// rango permitido para la duración CUSTOM que pide un vendedor puntual, algo
// distinto de "cuál es el default", que es lo que el admin configura.
const OFFER_MIN_DURATION_DAYS = 1;
const OFFER_MAX_DURATION_DAYS = 90;

export const offerSummarySelect = {
  id: true,
  contentType: true,
  orientation: true,
  title: true,
  description: true,
  tagline: true,
  discountLabel: true,
  imageUrl: true,
  htmlContent: true,
  createdByAdmin: true,
  status: true,
  startsAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  // vendor del producto incluido acá (no solo el de la oferta): en las
  // ofertas PRODUCT creadas por el admin, offer.vendor es null (no las creó
  // ningún vendedor) pero el producto destacado sigue siendo de alguno — el
  // Home necesita ESE slug para armar el link "/producto/:vendorSlug/:slug".
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      oldPrice: true,
      images: true,
      vendor: { select: { slug: true } },
    },
  },
};

// Bloque 50: sin cron aparte todavía — cualquier lectura pública o del panel
// primero "vence" en caliente las ACTIVE cuyo expiresAt ya pasó. expiresAt
// null (reservado a ofertas del admin sin fecha límite) queda afuera del
// filtro a propósito: esas no vencen solas.
async function expireStaleOffers() {
  await prisma.offer.updateMany({
    where: { status: "ACTIVE", expiresAt: { not: null, lt: new Date() } },
    data: { status: "EXPIRED" },
  });
}

// Cuándo puede el vendedor publicar/republicar su PRÓXIMA oferta — contra su
// Offer más reciente (createdAt desc), sin importar el status. `excludeId`
// se usa al republicar: la oferta que se está por reactivar es, ella misma,
// la más reciente del vendedor, así que hay que ignorarla o el cooldown se
// dispararía siempre contra sí misma.
async function cooldownStatus(vendorId, { excludeId, cooldownDays } = {}) {
  const lastOffer = await prisma.offer.findFirst({
    where: { vendorId, ...(excludeId ? { id: { not: excludeId } } : {}) },
    orderBy: { createdAt: "desc" },
    select: { createdAt: true },
  });
  const nextAvailableAt = lastOffer
    ? new Date(lastOffer.createdAt.getTime() + cooldownDays * 24 * 60 * 60 * 1000)
    : null;
  return { nextAvailableAt, canCreateNow: !nextAvailableAt || nextAvailableAt <= new Date() };
}

async function assertCooldownOk(vendorId, opts) {
  const { canCreateNow, nextAvailableAt } = await cooldownStatus(vendorId, opts);
  if (!canCreateNow) {
    const fmt = nextAvailableAt.toLocaleDateString("es-CU", { day: "2-digit", month: "long" });
    throw new AppError(`Debes esperar entre cada oferta nueva. Puedes publicar/republicar a partir del ${fmt}.`, 409);
  }
}

// Público — Home.jsx. Nunca se muestra si no hay ninguna activa (el
// frontend decide no montar la sección en ese caso, ver Home.jsx). Incluye
// ofertas de vendedores Y del admin (vendor null cuando createdByAdmin).
export async function listActiveOffers(_req, res) {
  await expireStaleOffers();
  const offers = await prisma.offer.findMany({
    where: { status: "ACTIVE" },
    orderBy: { createdAt: "desc" },
    select: {
      ...offerSummarySelect,
      vendor: { select: { companyName: true, slug: true, verificationStatus: true } },
    },
  });
  // vendor es null en ofertas creadas por el admin (createdByAdmin) — el
  // helper ya maneja ese caso (no hay nada que computar sobre null).
  res.json({ offers: offers.map((o) => ({ ...o, vendor: withComputedVendorFields(o.vendor) })) });
}

// Panel de vendedor — todas las suyas (activas, expiradas, retiradas,
// suspendidas), para que la sección "Ofertas" muestre el historial completo.
export async function listMyOffers(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  await expireStaleOffers();
  const offers = await prisma.offer.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    select: offerSummarySelect,
  });

  const policy = await getOfferPolicy();
  const { canCreateNow, nextAvailableAt } = await cooldownStatus(vendor.id, { cooldownDays: policy.cooldownDays });
  res.json({ offers, canCreateNow, nextAvailableAt, cooldownDays: policy.cooldownDays, defaultDurationDays: policy.defaultDurationDays });
}

// Multipart siempre (aunque no venga archivo) para que CUSTOM y PRODUCT
// compartan el mismo endpoint/form — por eso los campos numéricos/enum
// llegan como string y se coercionan acá.
const createOfferSchema = z.object({
  contentType: z.enum(["PRODUCT", "CUSTOM"]),
  orientation: z.enum(["VERTICAL", "HORIZONTAL"]).default("HORIZONTAL"),
  title: z.string().trim().min(2, "El título es obligatorio."),
  description: z.string().trim().max(300).optional().nullable(),
  tagline: z.string().trim().max(120).optional().nullable(),
  discountLabel: z.string().trim().max(30).optional().nullable(),
  productId: z.string().optional(),
  imageUrl: z.string().optional(),
  // Sin default fijo acá a propósito — si el vendedor no manda una duración
  // custom, createOffer() usa el default configurado por el admin
  // (getOfferPolicy), no un número hardcodeado en este schema.
  durationDays: z.coerce.number().int().min(OFFER_MIN_DURATION_DAYS).max(OFFER_MAX_DURATION_DAYS).optional(),
});

// El vendedor solo elige entre PRODUCT (imagen ya cargada del producto) o
// CUSTOM (imagen propia). El insertado de HTML queda reservado EXCLUSIVAMENTE
// a las ofertas del admin (adminOffers.controller.js) — pedido explícito.
export async function createOffer(req, res) {
  try {
    const vendor = await resolveMyVendor(req.user.id);
    if (vendor.verificationStatus !== "VERIFIED") {
      throw new AppError("Disponible solo para tiendas verificadas.", 403);
    }

    const data = createOfferSchema.parse(req.body);
    const policy = await getOfferPolicy();
    await assertCooldownOk(vendor.id, { cooldownDays: policy.cooldownDays });

    let productId = null;
    let imageUrl = null;

    if (data.contentType === "PRODUCT") {
      if (!data.productId || !data.imageUrl) throw new AppError("Elige un producto y una imagen.", 400);
      const product = await prisma.product.findUnique({ where: { id: data.productId } });
      if (!product || product.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);
      if (!product.images.includes(data.imageUrl)) {
        throw new AppError("La imagen debe ser una de las que ya tiene cargadas este producto.", 400);
      }
      productId = product.id;
      imageUrl = data.imageUrl;
    } else {
      if (!req.file) throw new AppError("Sube una imagen para la oferta personalizada.", 400);
      imageUrl = `/uploads/offers/${req.file.filename}`;
    }

    const startsAt = new Date();
    const durationDays = data.durationDays ?? policy.defaultDurationDays;
    const expiresAt = new Date(startsAt.getTime() + durationDays * 24 * 60 * 60 * 1000);

    const offer = await prisma.offer.create({
      data: {
        vendorId: vendor.id,
        productId,
        contentType: data.contentType,
        orientation: data.orientation,
        title: data.title,
        description: data.description || null,
        tagline: data.tagline || null,
        discountLabel: data.discountLabel || null,
        imageUrl,
        startsAt,
        expiresAt,
      },
      select: offerSummarySelect,
    });
    logActivity({
      actorId: req.user.id,
      actorRole: "VENDOR",
      vendorId: vendor.id,
      action: "offer_created",
      description: `Creó la oferta "${offer.title}"`,
      meta: { offerId: offer.id },
    });
    res.status(201).json({ offer });
  } catch (err) {
    // Multer ya escribió el archivo a disco antes de que corriera este
    // handler — si algo falla después (cooldown, validación, etc.) no debe
    // quedar huérfano.
    if (req.file) unlink(join(OFFER_UPLOAD_DIR, req.file.filename)).catch(() => {});
    throw err;
  }
}

const updateOfferSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().max(300).optional().nullable(),
  tagline: z.string().trim().max(120).optional().nullable(),
  discountLabel: z.string().trim().max(30).optional().nullable(),
  orientation: z.enum(["VERTICAL", "HORIZONTAL"]).optional(),
  imageUrl: z.string().optional(),
  durationDays: z.coerce.number().int().min(OFFER_MIN_DURATION_DAYS).max(OFFER_MAX_DURATION_DAYS).optional(),
  // true = además de editar campos, reactivar una oferta EXPIRED/REMOVED
  // (vuelve a chequear el cooldown semanal, igual que crear una nueva).
  republish: z.coerce.boolean().optional(),
});

// Editar (cualquier status propio salvo SUSPENDED, que es admin-only) y,
// opcionalmente, republicar una oferta vencida/retirada — pedido explícito:
// "las ofertas vencidas se podrán editar o modificar incluso hasta volver a
// publicarlas, siempre que el sistema esté activa" (= siempre que el
// cooldown semanal lo permita en ese momento).
export async function updateOffer(req, res) {
  try {
    const vendor = await resolveMyVendor(req.user.id);
    const { id } = req.params;

    const existing = await prisma.offer.findUnique({ where: { id } });
    if (!existing || existing.vendorId !== vendor.id) throw new AppError("Oferta no encontrada.", 404);
    if (existing.status === "SUSPENDED") {
      throw new AppError("Esta oferta fue suspendida por el equipo de la plataforma y no se puede editar.", 403);
    }

    const data = updateOfferSchema.parse(req.body);
    const policy = await getOfferPolicy();
    const patch = {};

    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description || null;
    if (data.tagline !== undefined) patch.tagline = data.tagline || null;
    if (data.discountLabel !== undefined) patch.discountLabel = data.discountLabel || null;
    if (data.orientation !== undefined) patch.orientation = data.orientation;

    if (existing.contentType === "CUSTOM" && req.file) {
      patch.imageUrl = `/uploads/offers/${req.file.filename}`;
      // Best-effort: limpia la imagen anterior, ya no la referencia nadie.
      if (existing.imageUrl) unlink(join(OFFER_UPLOAD_DIR, existing.imageUrl.split("/").pop())).catch(() => {});
    } else if (existing.contentType === "PRODUCT" && data.imageUrl) {
      const product = await prisma.product.findUnique({ where: { id: existing.productId } });
      if (!product || !product.images.includes(data.imageUrl)) {
        throw new AppError("La imagen debe ser una de las que ya tiene cargadas este producto.", 400);
      }
      patch.imageUrl = data.imageUrl;
    }

    if (data.republish && existing.status !== "ACTIVE") {
      await assertCooldownOk(vendor.id, { excludeId: id, cooldownDays: policy.cooldownDays });
      const durationDays = data.durationDays || policy.defaultDurationDays;
      patch.status = "ACTIVE";
      patch.startsAt = new Date();
      patch.expiresAt = new Date(Date.now() + durationDays * 24 * 60 * 60 * 1000);
    } else if (data.durationDays && existing.status === "ACTIVE") {
      // Ajustar duración de una oferta YA activa: recalcula expiresAt desde
      // su startsAt original, no desde ahora.
      patch.expiresAt = new Date(new Date(existing.startsAt).getTime() + data.durationDays * 24 * 60 * 60 * 1000);
    }

    const offer = await prisma.offer.update({ where: { id }, data: patch, select: offerSummarySelect });
    res.json({ offer });
  } catch (err) {
    if (req.file) unlink(join(OFFER_UPLOAD_DIR, req.file.filename)).catch(() => {});
    throw err;
  }
}

// El vendedor la retira antes de tiempo — no libera el límite semanal
// (sigue contando como la oferta de esa semana, pedido explícito del bloque).
export async function removeOffer(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;

  const offer = await prisma.offer.findUnique({ where: { id } });
  if (!offer || offer.vendorId !== vendor.id) throw new AppError("Oferta no encontrada.", 404);
  if (offer.status !== "ACTIVE") throw new AppError("Esta oferta ya no está activa.", 409);

  const updated = await prisma.offer.update({ where: { id }, data: { status: "REMOVED" }, select: offerSummarySelect });
  res.json({ offer: updated });
}
