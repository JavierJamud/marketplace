import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Feature "venta rápida": un cliente SIN tienda publica hasta 5 anuncios
// simples desde su panel. Mirror deliberadamente reducido de
// products.controller.js — mismo estilo/convenciones, pero solo los 4
// campos que el pedido original listó explícitamente (imagen/título/
// descripción/precio), sin categoría/tags/stock/tallas/métodos de pago.
export const MAX_LISTINGS_PER_USER = 5;
export const LISTING_EXPIRY_DAYS = 30;

const __dirname = dirname(fileURLToPath(import.meta.url));
// Públicas por diseño (igual que las de producto) — organizadas por carpeta
// de dueño, no de tienda (este cliente no tiene una).
export const CUSTOMER_LISTING_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "customer-listings");

export const customerListingSchema = z.object({
  name: z.string().trim().min(2, "El título es obligatorio."),
  description: z.preprocess(
    (v) => v ?? "",
    z.string().trim().min(10, "Contale al comprador qué es (mínimo 10 caracteres).")
  ),
  price: z.number().positive(),
  currency: z.enum(["CUP", "USD", "EUR", "MXN"]).optional().default("USD"),
});

async function getAvailableCurrencies() {
  const s = await prisma.siteSettings.findFirst({ select: { availableCurrencies: true } });
  return s?.availableCurrencies ?? ["USD", "CUP", "EUR", "MXN"];
}

async function assertCurrencyAllowed(currency) {
  const allowed = await getAvailableCurrencies();
  if (!allowed.includes(currency)) {
    throw new AppError(`La moneda "${currency}" no está disponible actualmente.`, 400);
  }
}

// --- Panel de cliente: mis anuncios -----------------------------------------

export async function listMyListings(req, res) {
  const listings = await prisma.customerListing.findMany({
    where: { ownerId: req.user.id },
    orderBy: { createdAt: "desc" },
  });
  res.json({ listings, limit: MAX_LISTINGS_PER_USER });
}

export async function createListing(req, res) {
  const data = customerListingSchema.parse(req.body);
  await assertCurrencyAllowed(data.currency);

  const activeCount = await prisma.customerListing.count({ where: { ownerId: req.user.id } });
  if (activeCount >= MAX_LISTINGS_PER_USER) {
    throw new AppError(`Alcanzaste el máximo de ${MAX_LISTINGS_PER_USER} anuncios de venta rápida. Elimina uno para publicar otro.`, 403);
  }

  const now = new Date();
  const listing = await prisma.customerListing.create({
    data: {
      ...data,
      ownerId: req.user.id,
      // Igual que Product: se crea siempre en pausa, sin fotos — la primera
      // imagen es lo que lo activa (ver addListingImages).
      isActive: false,
      expiresAt: new Date(now.getTime() + LISTING_EXPIRY_DAYS * 24 * 60 * 60 * 1000),
    },
  });
  res.status(201).json({ listing });
}

export async function updateListing(req, res) {
  const { id } = req.params;
  const existing = await prisma.customerListing.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== req.user.id) throw new AppError("Anuncio no encontrado.", 404);

  const data = customerListingSchema.partial().parse(req.body);
  if (data.currency) await assertCurrencyAllowed(data.currency);

  // expiresAt nunca se toca acá a propósito — se fija una sola vez al crear.
  const listing = await prisma.customerListing.update({ where: { id }, data });
  res.json({ listing });
}

export async function toggleSold(req, res) {
  const { id } = req.params;
  const existing = await prisma.customerListing.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== req.user.id) throw new AppError("Anuncio no encontrado.", 404);

  const listing = await prisma.customerListing.update({
    where: { id },
    data: { isSold: !existing.isSold },
  });
  res.json({ listing });
}

export async function deleteListing(req, res) {
  const { id } = req.params;
  const existing = await prisma.customerListing.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== req.user.id) throw new AppError("Anuncio no encontrado.", 404);

  // Best-effort: borra los archivos físicos también (a diferencia de
  // deleteProduct, que hoy no lo hace — acá sí importa porque el cupo de 5
  // y el churn constante de este flujo hacen que dejar huérfanos en disco
  // sea un problema real, no solo teórico).
  await Promise.all(
    existing.images.map((url) => unlink(join(CUSTOMER_LISTING_UPLOAD_DIR, req.user.id, url.split("/").pop())).catch(() => {}))
  );

  await prisma.customerListing.delete({ where: { id } });
  res.json({ ok: true });
}

// --- Imágenes ----------------------------------------------------------------

export async function resolveListingForUpload(req, res, next) {
  const { id } = req.params;
  const listing = await prisma.customerListing.findUnique({ where: { id } });
  if (!listing || listing.ownerId !== req.user.id) throw new AppError("Anuncio no encontrado.", 404);
  req.uploadListing = listing;
  next();
}

const MAX_LISTING_IMAGES = 4;

export async function addListingImages(req, res) {
  if (!req.files?.length) throw new AppError("Sube al menos una imagen.", 400);

  const existingCount = req.uploadListing.images.length;
  if (existingCount + req.files.length > MAX_LISTING_IMAGES) {
    throw new AppError(`Máximo ${MAX_LISTING_IMAGES} fotos por anuncio.`, 400);
  }

  const newUrls = req.files.map((f) => `/uploads/customer-listings/${req.user.id}/${f.filename}`);
  const wasEmpty = existingCount === 0;
  const listing = await prisma.customerListing.update({
    where: { id: req.uploadListing.id },
    data: {
      images: [...req.uploadListing.images, ...newUrls],
      ...(wasEmpty ? { isActive: true, activatedAt: req.uploadListing.activatedAt ?? new Date() } : {}),
    },
  });
  res.status(201).json({ listing });
}

const removeImageSchema = z.object({ url: z.string().min(1) });

export async function removeListingImage(req, res) {
  const { id } = req.params;
  const { url } = removeImageSchema.parse(req.body);

  const existing = await prisma.customerListing.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== req.user.id) throw new AppError("Anuncio no encontrado.", 404);
  if (!existing.images.includes(url)) throw new AppError("Esa imagen no pertenece a este anuncio.", 404);

  const nextImages = existing.images.filter((u) => u !== url);
  const listing = await prisma.customerListing.update({
    where: { id },
    data: { images: nextImages, ...(nextImages.length === 0 ? { isActive: false } : {}) },
  });

  unlink(join(CUSTOMER_LISTING_UPLOAD_DIR, req.user.id, url.split("/").pop())).catch(() => {});
  res.json({ listing });
}

// --- Público -------------------------------------------------------------

export async function listPublicListings(req, res) {
  const listings = await prisma.customerListing.findMany({
    where: { isActive: true, isSold: false },
    include: { owner: { select: { fullName: true, phone: true } } },
    orderBy: { createdAt: "desc" },
  });
  res.json({ listings });
}

export async function getPublicListing(req, res) {
  const { id } = req.params;
  const listing = await prisma.customerListing.findFirst({
    where: { id, isActive: true },
    include: { owner: { select: { fullName: true, phone: true } } },
  });
  if (!listing) throw new AppError("Anuncio no encontrado.", 404);
  res.json({ listing });
}
