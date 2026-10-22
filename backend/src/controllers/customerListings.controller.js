import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { deleteUploadedImages } from "../lib/uploadFiles.js";
import { activeCodes, assertActiveCurrency } from "../lib/catalog.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getListingPolicy, getSiteTimezone } from "./settings.controller.js";
import { startOfDayInTimezone } from "../lib/timezone.js";
import { listingZoneWhere } from "../lib/vendorZone.js";
import { resolveRealCountryLocation } from "../services/registrationLocation.service.js";
import { recordLocationSuggestions } from "../services/locationSuggestions.service.js";

// Feature "venta rápida": un cliente SIN tienda publica un número limitado de
// anuncios simples desde su panel. Mirror deliberadamente reducido de
// products.controller.js — mismo estilo/convenciones, pero solo los 4
// campos que el pedido original listó explícitamente (imagen/título/
// descripción/precio), sin categoría/tags/stock/tallas/métodos de pago.
// Bloque 237 (pedido explícito): tope activo, tope diario y días de vida ya
// no son constantes acá — son configurables desde el admin (ver
// getListingPolicy/updateListingPolicy en settings.controller.js).

const __dirname = dirname(fileURLToPath(import.meta.url));
// Públicas por diseño (igual que las de producto) — organizadas por carpeta
// de dueño, no de tienda (este cliente no tiene una).
export const CUSTOMER_LISTING_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "customer-listings");

export const LISTING_NAME_MAX = 80;
export const LISTING_DESCRIPTION_MAX = 1000;
export const LISTING_TAGS_MAX = 8;

const tierSchema = z.object({ minQty: z.number().int().min(2, "La cantidad mínima es 2."), price: z.number().positive() });

export const customerListingSchema = z.object({
  name: z.string().trim().min(2, "El título es obligatorio.").max(LISTING_NAME_MAX, `El título admite hasta ${LISTING_NAME_MAX} caracteres.`),
  description: z.preprocess(
    (v) => v ?? "",
    z
      .string()
      .trim()
      .min(10, "Cuéntale al comprador qué es (mínimo 10 caracteres).")
      .max(LISTING_DESCRIPTION_MAX, `La descripción admite hasta ${LISTING_DESCRIPTION_MAX} caracteres.`)
  ),
  price: z.number().positive(),
  currency: z.string().trim().min(1).max(12).optional(),
  tags: z
    .array(z.string().trim().min(2).max(24))
    .max(LISTING_TAGS_MAX, `Máximo ${LISTING_TAGS_MAX} palabras clave.`)
    .optional()
    .transform((arr) => (arr ? [...new Set(arr.map((x) => x.toLowerCase()))] : undefined)),
  condition: z.enum(["NEW", "USED", "REFURBISHED"]).nullish(),
  quantity: z.number().int().min(1).max(9999).nullish(),
  priceTiers: z.array(tierSchema).max(3, "Máximo 3 precios por cantidad.").nullish(),
  showOwnerName: z.boolean().optional(),
  locationNote: z.string().trim().max(80, "La zona admite hasta 80 caracteres.").nullish(),
  // Dónde se ofrece el artículo. Sin estos datos se toma el lugar del perfil del dueño.
  countryId: z.string().trim().min(1).optional(),
  provinceId: z.string().trim().min(1).nullish(),
  municipalityId: z.string().trim().min(1).nullish(),
  municipalityOther: z.string().trim().min(2).max(80).nullish(),
  stateOther: z.string().trim().min(1).max(80).nullish(),
});

// Lugar del anuncio: el que eligió el dueño al publicar o, si no eligió ninguno, el de su perfil. Siempre país y provincia o estado.
async function resolveListingLocation(input, ownerId) {
  if (input.countryId) {
    const loc = await resolveRealCountryLocation({
      countryId: input.countryId,
      provinceId: input.provinceId || undefined,
      municipalityId: input.municipalityId || undefined,
      municipalityOther: input.municipalityOther || undefined,
      stateOther: input.stateOther || undefined,
    });
    return {
      columns: { countryId: loc.country.id, provinceId: loc.province?.id ?? null, municipalityId: loc.municipality?.id ?? null, stateOther: loc.stateOther ?? null },
      suggestions: loc.suggestions,
    };
  }
  const owner = await prisma.user.findUnique({ where: { id: ownerId }, select: { registrationCountryId: true, provinceId: true, municipalityId: true, stateOther: true, province: { select: { countryId: true } } } });
  const countryId = owner?.registrationCountryId ?? owner?.province?.countryId ?? null;
  if (!countryId || (!owner?.provinceId && !owner?.stateOther?.trim())) {
    throw new AppError("Indica el país y la provincia o estado donde ofreces el artículo.", 400, { needsLocation: true });
  }
  return { columns: { countryId, provinceId: owner.provinceId ?? null, municipalityId: owner.municipalityId ?? null, stateOther: owner.stateOther ?? null }, suggestions: [] };
}

const LOCATION_KEYS = ["countryId", "provinceId", "municipalityId", "municipalityOther", "stateOther"];

// Los precios por cantidad tienen que bajar a medida que sube la cantidad y ser menores al precio por unidad.
export function validateTiers(price, tiers) {
  if (!tiers?.length) return null;
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  let previous = Number(price);
  const seen = new Set();
  for (const t of sorted) {
    if (seen.has(t.minQty)) throw new AppError("Hay dos precios para la misma cantidad.", 400);
    seen.add(t.minQty);
    if (t.price >= previous) throw new AppError("Cada precio por cantidad debe ser menor que el anterior y que el precio por unidad.", 400);
    previous = t.price;
  }
  return sorted;
}

// Lo que ve el público: el nombre del dueño solo sale si él lo permitió; el teléfono sí (el contacto es el objetivo del anuncio).
export function toPublicListing(l) {
  // ownerId tampoco sale: con el nombre oculto serviría para enlazar varios anuncios a la misma persona.
  const { owner, ownerId, countryId, provinceId, municipalityId, ...rest } = l;
  return {
    ...rest,
    // El lugar del anuncio (no el del perfil del dueño): país, provincia o estado y municipio donde se ofrece.
    location: { country: l.country?.name ?? null, province: l.province?.name ?? l.stateOther ?? null, municipality: l.municipality?.name ?? null },
    owner: { phone: owner?.phone ?? null, province: l.province ?? (l.stateOther ? { name: l.stateOther } : owner?.province ?? null), name: l.showOwnerName ? owner?.fullName ?? null : null },
  };
}

const assertCurrencyAllowed = (currency) => assertActiveCurrency(currency);

// --- Panel de cliente: mis anuncios -----------------------------------------

// Cuántos anuncios creó este dueño desde que arrancó el día calendario
// "hoy" en la zona horaria del negocio — misma cuenta que usa createListing
// para el tope diario, reutilizada acá para que el panel pueda armar el
// botón bloqueado + la cuenta regresiva sin duplicar la lógica de "qué día
// es" del backend.
async function countListingsCreatedToday(ownerId, timezone) {
  const dayStart = startOfDayInTimezone(new Date(), timezone);
  return prisma.customerListing.count({ where: { ownerId, createdAt: { gte: dayStart } } });
}

export async function listMyListings(req, res) {
  const [listings, policy, timezone] = await Promise.all([
    prisma.customerListing.findMany({ where: { ownerId: req.user.id }, orderBy: { createdAt: "desc" } }),
    getListingPolicy(),
    getSiteTimezone(),
  ]);
  const dayStart = startOfDayInTimezone(new Date(), timezone);
  const createdToday = await countListingsCreatedToday(req.user.id, timezone);
  res.json({
    listings,
    limit: policy.maxActive,
    dailyLimit: policy.maxNewPerDay,
    createdToday,
    // Instante en que el cupo diario vuelve a 0 — el frontend calcula
    // horas/minutos restantes y la hora exacta a partir de esta fecha,
    // nunca al revés (ver CustomerPanel.jsx).
    nextDailyResetAt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000),
  });
}

export async function createListing(req, res) {
  const { countryId: _c, provinceId: _p, municipalityId: _m, municipalityOther: _mo, stateOther: _s, ...data } = customerListingSchema.parse(req.body);
  data.currency = data.currency ?? (await activeCodes("CURRENCY"))[0];
  await assertCurrencyAllowed(data.currency);

  // Los compradores contactan por WhatsApp con el teléfono de la cuenta: sin teléfono el anuncio no serviría de nada.
  const owner = await prisma.user.findUnique({ where: { id: req.user.id }, select: { phone: true } });
  if (!owner?.phone?.trim()) {
    throw new AppError("Agrega tu teléfono en tu perfil para publicar: los compradores te contactan por WhatsApp.", 400, { needsProfile: true, missing: ["teléfono"] });
  }
  // Y el lugar donde ofreces el artículo (el del perfil por defecto): los compradores ven los anuncios según su lugar de entrega.
  const location = await resolveListingLocation(req.body, req.user.id);

  const policy = await getListingPolicy();

  const activeCount = await prisma.customerListing.count({ where: { ownerId: req.user.id } });
  if (activeCount >= policy.maxActive) {
    throw new AppError(`Alcanzaste el máximo de ${policy.maxActive} anuncios de venta rápida. Elimina uno para publicar otro.`, 403);
  }

  // Tope diario (pedido explícito) — día calendario en la zona horaria del
  // negocio, no una ventana fija de 24hs. Nunca se "acumula" cupo de un día
  // para el siguiente: cada día calendario arranca en 0, sin guardar nada.
  const timezone = await getSiteTimezone();
  const createdToday = await countListingsCreatedToday(req.user.id, timezone);
  if (createdToday >= policy.maxNewPerDay) {
    throw new AppError(`Ya publicaste ${policy.maxNewPerDay} anuncio(s) hoy. Intenta de nuevo mañana.`, 429);
  }

  const now = new Date();
  const tiers = validateTiers(data.price, data.priceTiers);
  const listing = await prisma.customerListing.create({
    data: {
      ...data,
      ...location.columns,
      priceTiers: tiers ?? undefined,
      ownerId: req.user.id,
      // Igual que Product: se crea siempre en pausa, sin fotos — la primera
      // imagen es lo que lo activa (ver addListingImages).
      isActive: false,
      // Fijados UNA sola vez con la política vigente en este instante — ver
      // comentario largo de expiresAt/publicVisibleUntil en schema.prisma.
      expiresAt: new Date(now.getTime() + policy.expiryDays * 24 * 60 * 60 * 1000),
      publicVisibleUntil: new Date(now.getTime() + policy.publicVisibilityDays * 24 * 60 * 60 * 1000),
    },
  });
  void recordLocationSuggestions(location.suggestions);
  res.status(201).json({ listing });
}

export async function updateListing(req, res) {
  const { id } = req.params;
  const existing = await prisma.customerListing.findUnique({ where: { id } });
  if (!existing || existing.ownerId !== req.user.id) throw new AppError("Anuncio no encontrado.", 404);

  const { countryId: _c, provinceId: _p, municipalityId: _m, municipalityOther: _mo, stateOther: _s, ...data } = customerListingSchema.partial().parse(req.body);
  if (data.currency && data.currency !== existing.currency) await assertCurrencyAllowed(data.currency);
  // Si cambia el lugar, se valida completo (país, provincia o estado, municipio) y se guardan los cuatro campos juntos.
  let location = null;
  if (LOCATION_KEYS.some((k) => req.body?.[k] !== undefined)) {
    location = await resolveListingLocation(req.body, req.user.id);
    Object.assign(data, location.columns);
  }
  // Los precios por cantidad se validan contra el precio vigente (el nuevo, si también cambia).
  if (data.priceTiers !== undefined || data.price !== undefined) {
    const tiers = data.priceTiers !== undefined ? data.priceTiers : existing.priceTiers;
    data.priceTiers = validateTiers(data.price ?? existing.price, tiers) ?? (data.priceTiers === null ? null : undefined);
  }

  // expiresAt/publicVisibleUntil nunca se tocan acá a propósito — los dos se
  // fijan una sola vez al crear, con la política vigente en ese momento.
  const listing = await prisma.customerListing.update({ where: { id }, data });
  if (location) void recordLocationSuggestions(location.suggestions);
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

  // Se borran también las fotos del disco, con sus miniaturas.
  await deleteUploadedImages(existing.images);

  await prisma.customerListing.delete({ where: { id } });
  res.json({ ok: true });
}

// --- Imágenes ----------------------------------------------------------------

export async function resolveListingForUpload(req, res, next) {
  const { id } = req.params;
  const listing = await prisma.customerListing.findUnique({ where: { id } });
  if (!listing || listing.ownerId !== req.user.id) throw new AppError("Anuncio no encontrado.", 404);
  req.uploadListing = listing;
  req.maxListingImages = (await getListingPolicy()).maxImages;
  next();
}

export async function addListingImages(req, res) {
  if (!req.files?.length) throw new AppError("Sube al menos una imagen.", 400);

  const existingCount = req.uploadListing.images.length;
  if (existingCount + req.files.length > req.maxListingImages) {
    // El archivo ya se guardó al pasar por multer: se descarta para no dejar fotos huérfanas.
    await Promise.all(req.files.flatMap((f) => [unlink(f.path), unlink(f.path.replace(/\.webp$/, "-thumb.webp"))].map((p) => p.catch(() => {}))));
    throw new AppError(`Máximo ${req.maxListingImages} fotos por anuncio.`, 400);
  }

  const newUrls = req.files.map((f) => `/uploads/customer-listings/${req.user.id}/${f.filename}`);
  const wasEmpty = existingCount === 0;
  const listing = await prisma.customerListing.update({
    where: { id: req.uploadListing.id },
    data: {
      images: [...req.uploadListing.images, ...newUrls],
      // Una venta rápida suspendida por un reporte no se reactiva subiendo fotos de nuevo.
      ...(wasEmpty && !req.uploadListing.suspendedAt ? { isActive: true, activatedAt: req.uploadListing.activatedAt ?? new Date() } : {}),
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

  void deleteUploadedImages([url]);
  res.json({ listing });
}

// --- Público -------------------------------------------------------------

// Datos del dueño que se muestran: nombre, teléfono (el contacto por WhatsApp es la razón de ser del anuncio) y su provincia.
const PUBLIC_OWNER = { select: { fullName: true, phone: true, province: { select: { name: true } } } };
// El lugar del anuncio con sus nombres (país, provincia o estado y municipio).
const PUBLIC_LOCATION = { country: { select: { name: true } }, province: { select: { name: true } }, municipality: { select: { name: true } } };

export async function listPublicListings(req, res) {
  // ?limit=N (máx. 24) para la portada; sin límite, la página completa de venta rápida.
  const limit = Math.min(Math.max(Number(req.query.limit) || 0, 0), 24) || undefined;
  const listings = await prisma.customerListing.findMany({
    // Bloque 237: ciclo de vida en 2 etapas — a los publicVisibilityDays
    // días el anuncio deja de mostrarse acá aunque siga existiendo y
    // siga siendo del dueño (ver listMyListings, que no filtra por esto).
    where: {
      isActive: true,
      isSold: false,
      publicVisibleUntil: { gte: new Date() },
      // Ni suspendidas por un reporte ni de una cuenta bloqueada o eliminada.
      suspendedAt: null,
      owner: { isSuspended: false, deletedAt: null },
      // Mismo lugar que eligió el comprador para todo el sitio, según el lugar propio de cada anuncio.
      ...listingZoneWhere(req.query),
    },
    include: { owner: PUBLIC_OWNER, ...PUBLIC_LOCATION },
    orderBy: { createdAt: "desc" },
    take: limit,
  });
  res.json({ listings: listings.map(toPublicListing) });
}

export async function getPublicListing(req, res) {
  const { id } = req.params;
  const listing = await prisma.customerListing.findFirst({
    where: { id, isActive: true, publicVisibleUntil: { gte: new Date() }, suspendedAt: null, owner: { isSuspended: false, deletedAt: null } },
    include: { owner: PUBLIC_OWNER, ...PUBLIC_LOCATION },
  });
  if (!listing) throw new AppError("Anuncio no encontrado.", 404);
  // Analítica para el admin al revisar un reporte: visitas a la ficha (sin bloquear la respuesta).
  void prisma.customerListing.update({ where: { id }, data: { viewCount: { increment: 1 } } }).catch(() => {});
  res.json({ listing: toPublicListing(listing) });
}

// Clic en "contactar" de la ficha pública (WhatsApp): analítica para el admin al revisar un reporte.
export async function trackListingContact(req, res) {
  await prisma.customerListing.updateMany({ where: { id: req.params.id, isActive: true }, data: { contactClickCount: { increment: 1 } } });
  res.json({ ok: true });
}
