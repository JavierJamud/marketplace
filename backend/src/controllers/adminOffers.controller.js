import { z } from "zod";
import { join } from "node:path";
import { unlink } from "node:fs/promises";
import DOMPurify from "isomorphic-dompurify";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { offerSummarySelect, OFFER_UPLOAD_DIR } from "./offers.controller.js";

// Bloque 51: sección "Ofertas" del panel admin. A diferencia de
// offers.controller.js (vendedor, solo PRODUCT/CUSTOM, siempre sujeto al
// cooldown semanal y al vencimiento), acá el admin puede:
// - Crear con HTML insertado (exclusivo de este controller, pedido explícito).
// - No poner fecha de vencimiento (expiresAt null = no vence sola), así la
//   sección de ofertas de Home nunca se queda vacía por vencimiento
//   automático — salvo que el propio admin le ponga una duración.
// - Moderar CUALQUIER oferta (suya o de un vendedor): cambiar status
//   (SUSPENDED = ocultarla sin borrarla) o borrarla directamente.

const statusFilterSchema = z.enum(["ACTIVE", "EXPIRED", "REMOVED", "SUSPENDED"]).optional();

export async function listAllOffers(req, res) {
  const status = statusFilterSchema.parse(req.query.status);
  const offers = await prisma.offer.findMany({
    where: status ? { status } : undefined,
    orderBy: { createdAt: "desc" },
    select: {
      ...offerSummarySelect,
      vendor: { select: { id: true, companyName: true, slug: true, isVerified: true } },
    },
  });
  res.json({ offers });
}

const createAdminOfferSchema = z.object({
  contentType: z.enum(["PRODUCT", "CUSTOM", "HTML"]),
  orientation: z.enum(["VERTICAL", "HORIZONTAL"]).default("HORIZONTAL"),
  title: z.string().trim().min(2, "El título es obligatorio."),
  description: z.string().trim().max(300).optional().nullable(),
  tagline: z.string().trim().max(120).optional().nullable(),
  discountLabel: z.string().trim().max(30).optional().nullable(),
  productId: z.string().optional(),
  imageUrl: z.string().optional(),
  htmlContent: z.string().optional(),
  // Sin duración = no vence (default de las ofertas de admin). Si el admin
  // sí quiere que venza sola, manda esto.
  durationDays: z.coerce.number().int().min(1).max(365).optional(),
});

export async function createAdminOffer(req, res) {
  try {
    const data = createAdminOfferSchema.parse(req.body);

    let productId = null;
    let imageUrl = null;
    let htmlContent = null;

    if (data.contentType === "PRODUCT") {
      if (!data.productId || !data.imageUrl) throw new AppError("Elige un producto y una imagen.", 400);
      // Sin filtro por vendorId a propósito: el admin puede destacar el
      // producto de CUALQUIER tienda del sitio, no solo la suya.
      const product = await prisma.product.findUnique({ where: { id: data.productId } });
      if (!product) throw new AppError("Producto no encontrado.", 404);
      if (!product.images.includes(data.imageUrl)) {
        throw new AppError("La imagen debe ser una de las que ya tiene cargadas ese producto.", 400);
      }
      productId = product.id;
      imageUrl = data.imageUrl;
    } else if (data.contentType === "CUSTOM") {
      if (!req.file) throw new AppError("Sube una imagen para la oferta personalizada.", 400);
      imageUrl = `/uploads/offers/${req.file.filename}`;
    } else {
      if (!data.htmlContent?.trim()) throw new AppError("Pega el HTML de la oferta.", 400);
      htmlContent = DOMPurify.sanitize(data.htmlContent);
    }

    const startsAt = new Date();
    const expiresAt = data.durationDays ? new Date(startsAt.getTime() + data.durationDays * 24 * 60 * 60 * 1000) : null;

    const offer = await prisma.offer.create({
      data: {
        vendorId: null,
        productId,
        contentType: data.contentType,
        orientation: data.orientation,
        title: data.title,
        description: data.description || null,
        tagline: data.tagline || null,
        discountLabel: data.discountLabel || null,
        imageUrl,
        htmlContent,
        createdByAdmin: true,
        startsAt,
        expiresAt,
      },
      select: offerSummarySelect,
    });
    res.status(201).json({ offer });
  } catch (err) {
    if (req.file) unlink(join(OFFER_UPLOAD_DIR, req.file.filename)).catch(() => {});
    throw err;
  }
}

const updateAdminOfferSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().max(300).optional().nullable(),
  tagline: z.string().trim().max(120).optional().nullable(),
  discountLabel: z.string().trim().max(30).optional().nullable(),
  orientation: z.enum(["VERTICAL", "HORIZONTAL"]).optional(),
  imageUrl: z.string().optional(),
  htmlContent: z.string().optional(),
  // El admin puede mover el status de CUALQUIER oferta — así se implementa
  // "modificar, eliminar, suspender y ocultar" tanto propias como de
  // vendedores que no cumplan las políticas (SUSPENDED = oculta, reversible).
  status: z.enum(["ACTIVE", "EXPIRED", "REMOVED", "SUSPENDED"]).optional(),
  durationDays: z.coerce.number().int().min(1).max(365).optional(),
  clearExpiry: z.coerce.boolean().optional(),
});

export async function updateAdminOffer(req, res) {
  try {
    const { id } = req.params;
    const existing = await prisma.offer.findUnique({ where: { id } });
    if (!existing) throw new AppError("Oferta no encontrada.", 404);

    const data = updateAdminOfferSchema.parse(req.body);
    const patch = {};

    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description || null;
    if (data.tagline !== undefined) patch.tagline = data.tagline || null;
    if (data.discountLabel !== undefined) patch.discountLabel = data.discountLabel || null;
    if (data.orientation !== undefined) patch.orientation = data.orientation;
    if (data.status !== undefined) patch.status = data.status;

    if (existing.contentType === "HTML" && data.htmlContent !== undefined) {
      patch.htmlContent = data.htmlContent.trim() ? DOMPurify.sanitize(data.htmlContent) : null;
    }

    if (existing.contentType === "CUSTOM" && req.file) {
      patch.imageUrl = `/uploads/offers/${req.file.filename}`;
      if (existing.imageUrl) unlink(join(OFFER_UPLOAD_DIR, existing.imageUrl.split("/").pop())).catch(() => {});
    } else if (existing.contentType === "PRODUCT" && data.imageUrl) {
      const product = existing.productId ? await prisma.product.findUnique({ where: { id: existing.productId } }) : null;
      if (!product || !product.images.includes(data.imageUrl)) {
        throw new AppError("La imagen debe ser una de las que ya tiene cargadas ese producto.", 400);
      }
      patch.imageUrl = data.imageUrl;
    }

    if (data.clearExpiry) {
      patch.expiresAt = null;
    } else if (data.durationDays) {
      patch.expiresAt = new Date(Date.now() + data.durationDays * 24 * 60 * 60 * 1000);
    }

    const offer = await prisma.offer.update({ where: { id }, data: patch, select: offerSummarySelect });
    res.json({ offer });
  } catch (err) {
    if (req.file) unlink(join(OFFER_UPLOAD_DIR, req.file.filename)).catch(() => {});
    throw err;
  }
}

export async function deleteAdminOffer(req, res) {
  const { id } = req.params;
  const existing = await prisma.offer.findUnique({ where: { id } });
  if (!existing) throw new AppError("Oferta no encontrada.", 404);

  await prisma.offer.delete({ where: { id } });

  // Solo las CUSTOM tienen un archivo propio en uploads/offers — las
  // PRODUCT apuntan a un archivo que pertenece al producto (no se toca).
  if (existing.contentType === "CUSTOM" && existing.imageUrl) {
    unlink(join(OFFER_UPLOAD_DIR, existing.imageUrl.split("/").pop())).catch(() => {});
  }
  res.json({ ok: true });
}
