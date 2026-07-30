import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { logActivity } from "../lib/activityLog.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Bloque 52: ofertas DENTRO de cada tienda (distintas de Offer, la sección
// "Ofertas" del Home — ver schema.prisma). Carpeta propia, mismo criterio de
// "assets públicos de marketing" que offers.controller.js.
export const STORE_OFFER_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "store-offers");

export const storeOfferSummarySelect = {
  id: true,
  title: true,
  description: true,
  imageUrl: true,
  isLimitedTime: true,
  expiresAt: true,
  discountCodeExclusive: true,
  active: true,
  createdAt: true,
  discountCode: {
    select: { id: true, code: true, type: true, value: true, active: true },
  },
};

// Bloque 52: sin cron aparte, mismo criterio que expireStaleOffers en
// offers.controller.js — cualquier lectura (pública o del panel) vence en
// caliente las que ya pasaron su expiresAt. Si el código fue creado
// EXCLUSIVO para la oferta, se desactiva junto con ella (ver
// discountCodeExclusive en schema.prisma); uno reusado nunca se toca acá.
export async function expireStaleStoreOffers() {
  const toExpire = await prisma.storeOffer.findMany({
    where: { active: true, isLimitedTime: true, expiresAt: { not: null, lt: new Date() } },
    select: { id: true, discountCodeId: true, discountCodeExclusive: true },
  });
  if (toExpire.length === 0) return;

  await prisma.storeOffer.updateMany({ where: { id: { in: toExpire.map((o) => o.id) } }, data: { active: false } });

  const exclusiveCodeIds = toExpire.filter((o) => o.discountCodeExclusive).map((o) => o.discountCodeId);
  if (exclusiveCodeIds.length > 0) {
    await prisma.discountCode.updateMany({ where: { id: { in: exclusiveCodeIds } }, data: { active: false } });
  }
}

export async function listMyStoreOffers(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  await expireStaleStoreOffers();
  const storeOffers = await prisma.storeOffer.findMany({
    where: { vendorId: vendor.id },
    orderBy: { createdAt: "desc" },
    select: storeOfferSummarySelect,
  });
  res.json({ storeOffers });
}

// Mismo criterio de "link externo" que addProductImageLink (products.controller.js)
// — apagable desde el admin (SiteSettings.allowProductImageLinks).
async function assertImageLinkAllowed() {
  const settings = await prisma.siteSettings.findFirst();
  if (settings && settings.allowProductImageLinks === false) {
    throw new AppError("El administrador desactivó agregar imágenes por link. Sube un archivo en su lugar.", 403);
  }
}

// Multipart siempre (aunque no venga archivo, si se pega un link) — mismo
// criterio que createOffer en offers.controller.js.
const createStoreOfferSchema = z.object({
  title: z.string().trim().min(2, "El título es obligatorio."),
  description: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().url().optional(),
  discountCodeId: z.string().min(1, "Elige o crea un código de descuento."),
  isLimitedTime: z.coerce.boolean().default(false),
  expiresAt: z.string().datetime().optional(),
  // true si discountCodeId se creó desde "Crear código nuevo para esta
  // oferta" — informativo para el auto-apagado al vencer (ver
  // expireStaleStoreOffers). Nunca se fuerza server-side, es una elección
  // del vendedor reflejada tal cual la mandó el frontend.
  discountCodeExclusive: z.coerce.boolean().default(false),
});

export async function createStoreOffer(req, res) {
  try {
    const vendor = await resolveMyVendor(req.user.id);
    // Bloque 66 (pedido explícito): ofertas de tienda solo para tiendas
    // verificadas — mismo gate que ya usa createOffer (offers.controller.js).
    if (vendor.verificationStatus !== "VERIFIED") {
      throw new AppError("Disponible solo para tiendas verificadas.", 403);
    }
    const data = createStoreOfferSchema.parse(req.body);

    if (data.isLimitedTime && !data.expiresAt) {
      throw new AppError("Una oferta por tiempo limitado necesita fecha/hora de vencimiento.", 400);
    }

    const discountCode = await prisma.discountCode.findUnique({ where: { id: data.discountCodeId } });
    if (!discountCode || discountCode.vendorId !== vendor.id) throw new AppError("Código de descuento no encontrado.", 404);

    let imageUrl;
    if (req.file) {
      imageUrl = `/uploads/store-offers/${req.file.filename}`;
    } else if (data.imageUrl) {
      await assertImageLinkAllowed();
      imageUrl = data.imageUrl;
    } else {
      throw new AppError("Sube una imagen o pega un link para la oferta.", 400);
    }

    const storeOffer = await prisma.storeOffer.create({
      data: {
        vendorId: vendor.id,
        title: data.title,
        description: data.description || null,
        imageUrl,
        discountCodeId: data.discountCodeId,
        isLimitedTime: data.isLimitedTime,
        expiresAt: data.isLimitedTime ? new Date(data.expiresAt) : null,
        discountCodeExclusive: data.isLimitedTime ? data.discountCodeExclusive : false,
      },
      select: storeOfferSummarySelect,
    });
    logActivity({
      actorId: req.user.id,
      actorRole: "VENDOR",
      vendorId: vendor.id,
      action: "store_offer_created",
      description: `Creó la oferta de tienda "${storeOffer.title}"`,
      meta: { storeOfferId: storeOffer.id },
    });
    res.status(201).json({ storeOffer });
  } catch (err) {
    if (req.file) unlink(join(STORE_OFFER_UPLOAD_DIR, req.file.filename)).catch(() => {});
    throw err;
  }
}

const updateStoreOfferSchema = z.object({
  title: z.string().trim().min(2).optional(),
  description: z.string().trim().max(500).optional().nullable(),
  imageUrl: z.string().url().optional(),
  discountCodeId: z.string().optional(),
  isLimitedTime: z.coerce.boolean().optional(),
  expiresAt: z.string().datetime().optional(),
  discountCodeExclusive: z.coerce.boolean().optional(),
  // Retirar/reactivar manualmente — independiente del auto-vencimiento.
  active: z.coerce.boolean().optional(),
});

export async function updateStoreOffer(req, res) {
  try {
    const vendor = await resolveMyVendor(req.user.id);
    const { id } = req.params;
    const data = updateStoreOfferSchema.parse(req.body);

    const existing = await prisma.storeOffer.findUnique({ where: { id } });
    if (!existing || existing.vendorId !== vendor.id) throw new AppError("Oferta no encontrada.", 404);

    const patch = {};
    if (data.title !== undefined) patch.title = data.title;
    if (data.description !== undefined) patch.description = data.description || null;
    if (data.active !== undefined) patch.active = data.active;

    if (data.discountCodeId !== undefined) {
      const discountCode = await prisma.discountCode.findUnique({ where: { id: data.discountCodeId } });
      if (!discountCode || discountCode.vendorId !== vendor.id) throw new AppError("Código de descuento no encontrado.", 404);
      patch.discountCodeId = data.discountCodeId;
    }

    if (req.file) {
      patch.imageUrl = `/uploads/store-offers/${req.file.filename}`;
      if (existing.imageUrl?.startsWith("/uploads/store-offers/")) {
        unlink(join(STORE_OFFER_UPLOAD_DIR, existing.imageUrl.split("/").pop())).catch(() => {});
      }
    } else if (data.imageUrl !== undefined) {
      await assertImageLinkAllowed();
      patch.imageUrl = data.imageUrl;
    }

    const isLimitedTime = data.isLimitedTime !== undefined ? data.isLimitedTime : existing.isLimitedTime;
    if (data.isLimitedTime !== undefined) patch.isLimitedTime = data.isLimitedTime;
    if (isLimitedTime) {
      const expiresAtInput = data.expiresAt ?? (existing.expiresAt ? existing.expiresAt.toISOString() : undefined);
      if (!expiresAtInput) throw new AppError("Una oferta por tiempo limitado necesita fecha/hora de vencimiento.", 400);
      if (data.expiresAt !== undefined) patch.expiresAt = new Date(data.expiresAt);
      if (data.discountCodeExclusive !== undefined) patch.discountCodeExclusive = data.discountCodeExclusive;
    } else if (data.isLimitedTime !== undefined) {
      patch.expiresAt = null;
      patch.discountCodeExclusive = false;
    }

    const storeOffer = await prisma.storeOffer.update({ where: { id }, data: patch, select: storeOfferSummarySelect });
    res.json({ storeOffer });
  } catch (err) {
    if (req.file) unlink(join(STORE_OFFER_UPLOAD_DIR, req.file.filename)).catch(() => {});
    throw err;
  }
}

// --- Admin (auditoría de seguridad) -----------------------------------------
// Antes no existía ninguna supervisión de admin sobre las ofertas de tienda
// (distinto de Offer/Home, que sí tiene adminOffers.controller.js) — un
// admin no tenía forma de suspender una oferta abusiva de un vendedor sin
// entrar a Prisma Studio. Reusa el mismo campo `active` que ya usa el propio
// vendedor para retirar/reactivar — no hace falta un estado SUSPENDED
// aparte para esto.

export async function listAllStoreOffersAdmin(_req, res) {
  await expireStaleStoreOffers();
  const storeOffers = await prisma.storeOffer.findMany({
    orderBy: { createdAt: "desc" },
    select: { ...storeOfferSummarySelect, vendor: { select: { id: true, companyName: true, slug: true } } },
  });
  res.json({ storeOffers });
}

const adminSetActiveSchema = z.object({ active: z.boolean() });

export async function setStoreOfferActiveAdmin(req, res) {
  const { id } = req.params;
  const { active } = adminSetActiveSchema.parse(req.body);

  const existing = await prisma.storeOffer.findUnique({ where: { id } });
  if (!existing) throw new AppError("Oferta no encontrada.", 404);

  const storeOffer = await prisma.storeOffer.update({ where: { id }, data: { active }, select: storeOfferSummarySelect });
  res.json({ storeOffer });
}
