import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { rankFeaturedProducts } from "../lib/productRanking.js";
import { resolveUnitPrice } from "../lib/pricing.js";
import { isVendorOpenNow } from "../services/schedule.service.js";
import { liveCounters } from "../lib/partnerUsage.js";
import { PARTNER_SCOPES } from "../lib/partnerScopes.js";
import {
  absUrl,
  siteUrl,
  visibleVendorWhere,
  visibleProductWhere,
  productInclude,
  productDto,
  storeInclude,
  storeDto,
  reviewDto,
} from "../lib/partnerDto.js";

// API pública de socios, solo lectura (más validar un carrito). Cada respuesta lleva
// { data, meta? }. Lo que ve un socio es lo mismo que ve un visitante de Baznova, más sus
// propias tiendas privadas.

const MAX_PAGE_SIZE = 50;
const RANK_POOL = 300;
const idLike = z.string().min(1).max(60);
const bool = z.enum(["true", "false"]).transform((v) => v === "true");

const pageSchema = z.object({
  page: z.coerce.number().int().min(1).max(10000).default(1),
  pageSize: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(20),
});

function meta(p, total) {
  return { total, page: p.page, pageSize: p.pageSize, pageCount: Math.max(1, Math.ceil(total / p.pageSize)) };
}

const productQuerySchema = pageSchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  categoryId: idLike.optional(),
  storeSlug: z.string().min(1).max(120).optional(),
  provinceId: idLike.optional(),
  municipalityId: idLike.optional(),
  minPrice: z.coerce.number().min(0).max(1e9).optional(),
  maxPrice: z.coerce.number().min(0).max(1e9).optional(),
  currency: z.enum(["CUP", "USD"]).optional(),
  onlyVerified: bool.optional(),
  inStock: bool.optional(),
  sort: z.enum(["relevance", "newest", "price-asc", "price-desc", "rating"]).default("relevance"),
});

async function categoryIdsWithChildren(categoryId) {
  const children = await prisma.category.findMany({ where: { parentId: categoryId }, select: { id: true } });
  return [categoryId, ...children.map((c) => c.id)];
}

async function buildProductWhere(partnerId, f) {
  const base = visibleProductWhere(partnerId);
  const and = [...base.AND];
  if (f.q) {
    const q = f.q;
    and.push({
      OR: [
        { name: { contains: q, mode: "insensitive" } },
        { description: { contains: q, mode: "insensitive" } },
        { tags: { has: q.toLowerCase() } },
        { vendor: { companyName: { contains: q, mode: "insensitive" } } },
      ],
    });
  }
  if (f.provinceId) {
    and.push({
      vendor: { locations: { some: { provinceId: f.provinceId, municipalityId: f.municipalityId ?? undefined } } },
    });
  }
  const where = {
    ...base,
    AND: and,
    categoryId: f.categoryId ? { in: await categoryIdsWithChildren(f.categoryId) } : undefined,
    price: f.minPrice !== undefined || f.maxPrice !== undefined ? { gte: f.minPrice, lte: f.maxPrice } : undefined,
    currency: f.currency,
  };
  if (f.storeSlug) where.vendor = { ...base.vendor, slug: f.storeSlug };
  if (f.onlyVerified) where.vendor = { ...where.vendor, verificationStatus: "VERIFIED" };
  return where;
}

// El ranking de un mismo filtro cambia despacio (ventas, clics y reseñas se acumulan de a poco):
// se guarda 30 s en memoria, y las solicitudes simultáneas iguales comparten un solo cálculo.
const POOL_TTL_MS = 30_000;
const POOL_MAX_ENTRIES = 200;
const poolCache = new Map();
function rankedPool(where) {
  const cacheKey = JSON.stringify(where);
  const hit = poolCache.get(cacheKey);
  if (hit && Date.now() - hit.at < POOL_TTL_MS) return hit.promise;
  const promise = computeRankedPool(where);
  poolCache.set(cacheKey, { at: Date.now(), promise });
  promise.catch(() => poolCache.delete(cacheKey));
  if (poolCache.size > POOL_MAX_ENTRIES) {
    const now = Date.now();
    for (const [k, v] of poolCache) if (now - v.at >= POOL_TTL_MS) poolCache.delete(k);
    if (poolCache.size > POOL_MAX_ENTRIES) poolCache.delete(poolCache.keys().next().value);
  }
  return promise;
}

async function computeRankedPool(where) {
  const pool = await prisma.product.findMany({
    where,
    include: productInclude,
    take: RANK_POOL,
    orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
  });
  const agg = await prisma.review.groupBy({
    by: ["productId"],
    where: { productId: { in: pool.map((p) => p.id) }, rating: { not: null }, isHidden: false },
    _avg: { rating: true },
    _count: { rating: true },
  });
  const stats = new Map(agg.map((a) => [a.productId, { avgRating: a._avg.rating ?? 0, reviewCount: a._count.rating }]));
  return rankFeaturedProducts(pool, stats);
}

export async function listProducts(req, res) {
  const f = productQuerySchema.parse(req.query);
  const where = await buildProductWhere(req.partner.id, f);

  if (f.sort === "relevance") {
    const ranked = await rankedPool(where);
    const start = (f.page - 1) * f.pageSize;
    return res.json({ data: ranked.slice(start, start + f.pageSize).map(productDto), meta: { ...meta(f, ranked.length), rankedPoolLimit: RANK_POOL } });
  }
  const orderBy =
    f.sort === "price-asc" ? [{ price: "asc" }]
    : f.sort === "price-desc" ? [{ price: "desc" }]
    : f.sort === "rating" ? [{ rating: "desc" }, { reviewCount: "desc" }]
    : [{ createdAt: "desc" }];
  const [total, rows] = await Promise.all([
    prisma.product.count({ where }),
    prisma.product.findMany({ where, include: productInclude, orderBy, skip: (f.page - 1) * f.pageSize, take: f.pageSize }),
  ]);
  res.json({ data: rows.map(productDto), meta: meta(f, total) });
}

const featuredQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(MAX_PAGE_SIZE).default(12),
  categoryId: idLike.optional(),
  storeSlug: z.string().min(1).max(120).optional(),
});

export async function listFeatured(req, res) {
  const f = featuredQuerySchema.parse(req.query);
  const where = await buildProductWhere(req.partner.id, f);
  const ranked = await rankedPool(where);
  res.json({ data: ranked.slice(0, f.limit).map(productDto) });
}

export async function getProduct(req, res) {
  const product = await prisma.product.findFirst({
    where: { ...visibleProductWhere(req.partner.id), id: req.params.id },
    include: productInclude,
  });
  if (!product) throw new AppError("Producto no encontrado.", 404);
  res.json({ data: productDto(product) });
}

export async function listProductReviews(req, res) {
  const p = pageSchema.parse(req.query);
  const product = await prisma.product.findFirst({ where: { ...visibleProductWhere(req.partner.id), id: req.params.id }, select: { id: true } });
  if (!product) throw new AppError("Producto no encontrado.", 404);
  const where = { productId: product.id, rating: { not: null }, isHidden: false };
  const [total, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  res.json({ data: rows.map(reviewDto), meta: meta(p, total) });
}

// ---- Tiendas --------------------------------------------------------------------------------

const storeQuerySchema = pageSchema.extend({
  q: z.string().trim().min(1).max(100).optional(),
  provinceId: idLike.optional(),
  municipalityId: idLike.optional(),
  businessCategoryId: idLike.optional(),
  onlyVerified: bool.optional(),
  isRestaurant: bool.optional(),
});

function storeWhere(partnerId, f = {}) {
  return {
    ...visibleVendorWhere(partnerId),
    // Una tienda sin productos publicados no se lista (igual que en el sitio).
    products: { some: { isActive: true, hiddenFromStore: false, overQuota: false } },
    companyName: f.q ? { contains: f.q, mode: "insensitive" } : undefined,
    businessCategoryId: f.businessCategoryId,
    verificationStatus: f.onlyVerified ? "VERIFIED" : undefined,
    isRestaurant: f.isRestaurant,
    locations: f.provinceId ? { some: { provinceId: f.provinceId, municipalityId: f.municipalityId ?? undefined } } : undefined,
  };
}

const productCountSelect = { _count: { select: { products: { where: { isActive: true, hiddenFromStore: false, overQuota: false } } } } };

export async function listStores(req, res) {
  const f = storeQuerySchema.parse(req.query);
  const where = storeWhere(req.partner.id, f);
  const [total, rows] = await Promise.all([
    prisma.vendor.count({ where }),
    prisma.vendor.findMany({
      where,
      include: { ...storeInclude, ...productCountSelect },
      orderBy: [{ createdAt: "desc" }],
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
    }),
  ]);
  // Verificadas primero dentro de la página, igual que el catálogo del sitio.
  rows.sort((a, b) => (b.verificationStatus === "VERIFIED" ? 1 : 0) - (a.verificationStatus === "VERIFIED" ? 1 : 0));
  res.json({ data: rows.map((v) => storeDto(v, { productCount: v._count.products })), meta: meta(f, total) });
}

async function findStore(partnerId, slug) {
  const store = await prisma.vendor.findFirst({
    where: { ...storeWhere(partnerId), slug },
    include: { ...storeInclude, ...productCountSelect, schedules: true },
  });
  if (!store) throw new AppError("Tienda no encontrada.", 404);
  return store;
}

export async function getStore(req, res) {
  const v = await findStore(req.partner.id, req.params.slug);
  const { isOpen, nextOpenLabel } = isVendorOpenNow(v.schedules, v.timezone);
  res.json({ data: storeDto(v, { productCount: v._count.products, isOpenNow: isOpen, nextOpenLabel: nextOpenLabel ?? null, timezone: v.timezone }) });
}

export async function listStoreProducts(req, res) {
  await findStore(req.partner.id, req.params.slug);
  req.query.storeSlug = req.params.slug;
  return listProducts(req, res);
}

export async function listStoreReviews(req, res) {
  const p = pageSchema.parse(req.query);
  const v = await findStore(req.partner.id, req.params.slug);
  const where = { vendorId: v.id, rating: { not: null }, isHidden: false };
  const [total, rows] = await Promise.all([
    prisma.review.count({ where }),
    prisma.review.findMany({ where, orderBy: { createdAt: "desc" }, skip: (p.page - 1) * p.pageSize, take: p.pageSize }),
  ]);
  res.json({ data: rows.map(reviewDto), meta: meta(p, total) });
}

export async function listStoreOffers(req, res) {
  const v = await findStore(req.partner.id, req.params.slug);
  const now = new Date();
  const offers = await prisma.storeOffer.findMany({
    where: {
      vendorId: v.id,
      active: true,
      AND: [
        { OR: [{ startsAt: null }, { startsAt: { lte: now } }] },
        { OR: [{ isLimitedTime: false }, { expiresAt: { gt: now } }] },
      ],
    },
    orderBy: { createdAt: "desc" },
    include: { discountCode: true },
  });
  res.json({
    data: offers.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      startsAt: o.startsAt,
      expiresAt: o.expiresAt,
      // El código exclusivo solo se entrega dentro de Baznova.
      discount: o.discountCodeExclusive
        ? null
        : { code: o.discountCode.code, type: o.discountCode.type, value: Number(o.discountCode.value), minPurchase: o.discountCode.minPurchase === null ? null : Number(o.discountCode.minPurchase) },
      store: { slug: v.slug, name: v.companyName, url: `${siteUrl()}/tienda/${v.slug}` },
    })),
  });
}

// ---- Ofertas del sitio y catálogo ---------------------------------------------------------------

export async function listSiteOffers(_req, res) {
  const now = new Date();
  const offers = await prisma.offer.findMany({
    where: { status: "ACTIVE", createdByAdmin: true, startsAt: { lte: now }, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] },
    orderBy: { createdAt: "desc" },
    select: {
      id: true, title: true, description: true, tagline: true, discountLabel: true, imageUrl: true,
      buttonLabel: true, buttonUrl: true, couponCode: true, startsAt: true, expiresAt: true, contentType: true,
      product: { select: { id: true, name: true, slug: true, price: true, oldPrice: true, images: true, vendor: { select: { slug: true } } } },
    },
  });
  res.json({
    data: offers.map((o) => ({
      id: o.id,
      title: o.title,
      description: o.description,
      tagline: o.tagline,
      discountLabel: o.discountLabel,
      imageUrl: absUrl(o.imageUrl),
      buttonLabel: o.buttonLabel,
      buttonUrl: o.buttonUrl,
      couponCode: o.couponCode,
      startsAt: o.startsAt,
      expiresAt: o.expiresAt,
      product: o.product
        ? { id: o.product.id, name: o.product.name, price: Number(o.product.price), oldPrice: o.product.oldPrice === null ? null : Number(o.product.oldPrice), image: absUrl(o.product.images?.[0]), url: `${siteUrl()}/producto/${o.product.vendor.slug}/${o.product.slug}` }
        : null,
    })),
  });
}

export async function listCategories(_req, res) {
  const categories = await prisma.category.findMany({
    where: { parentId: null },
    orderBy: { name: "asc" },
    select: { id: true, name: true, slug: true, children: { orderBy: { name: "asc" }, select: { id: true, name: true, slug: true } } },
  });
  res.json({ data: categories });
}

export async function listBusinessCategories(_req, res) {
  const rows = await prisma.businessCategory.findMany({ where: { active: true }, orderBy: [{ sortOrder: "asc" }, { name: "asc" }], select: { id: true, name: true, slug: true } });
  res.json({ data: rows });
}

export async function listProvinces(_req, res) {
  const rows = await prisma.province.findMany({ where: { isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, code: true, countryId: true } });
  res.json({ data: rows });
}

export async function listMunicipalities(req, res) {
  const { provinceId } = z.object({ provinceId: idLike }).parse(req.query);
  const rows = await prisma.municipality.findMany({ where: { provinceId, isActive: true }, orderBy: { name: "asc" }, select: { id: true, name: true, provinceId: true } });
  res.json({ data: rows });
}

// ---- Validar carrito ---------------------------------------------------------------------------

const cartSchema = z.object({
  items: z
    .array(z.object({ productId: idLike, quantity: z.coerce.number().int().min(1).max(10000), size: z.string().max(20).optional() }))
    .min(1)
    .max(100),
});

// No guarda nada ni crea pedidos: devuelve el precio vigente (con precios por cantidad), la
// disponibilidad y los totales por tienda y moneda. Sirve para que el carrito del socio nunca
// muestre un precio o stock desactualizado.
export async function validateCart(req, res) {
  const { items } = cartSchema.parse(req.body);
  const ids = [...new Set(items.map((i) => i.productId))];
  const products = await prisma.product.findMany({
    where: { ...visibleProductWhere(req.partner.id), id: { in: ids } },
    include: productInclude,
  });
  const byId = new Map(products.map((p) => [p.id, p]));

  const stores = new Map();
  const issues = [];
  let valid = true;
  for (const item of items) {
    const p = byId.get(item.productId);
    if (!p) {
      valid = false;
      issues.push({ productId: item.productId, problem: "unavailable", message: "El producto no existe o ya no está disponible." });
      continue;
    }
    const hasSizes = p.sizes.length > 0;
    const size = hasSizes ? item.size : undefined;
    let problem = null;
    let availableQuantity = null;
    if (hasSizes && (!size || !p.sizes.includes(size))) {
      problem = "size_required";
    } else if (!p.unlimitedStock) {
      availableQuantity = size ? Number(p.sizeStock?.[size] ?? 0) : p.stock;
      if (availableQuantity <= 0) problem = "out_of_stock";
      else if (item.quantity > availableQuantity) problem = "insufficient_stock";
    }
    const unitPrice = resolveUnitPrice(p.price, p.priceTiers, item.quantity);
    const lineTotal = Math.round(unitPrice * item.quantity * 100) / 100;
    if (problem) {
      valid = false;
      issues.push({ productId: p.id, problem, availableQuantity, message: problem === "size_required" ? "Elige una talla válida." : problem === "out_of_stock" ? "Producto agotado." : `Solo quedan ${availableQuantity} unidades.` });
    }
    let group = stores.get(p.vendor.slug);
    if (!group) {
      group = { store: { slug: p.vendor.slug, name: p.vendor.companyName, url: `${siteUrl()}/tienda/${p.vendor.slug}` }, items: [], totals: {} };
      stores.set(p.vendor.slug, group);
    }
    group.items.push({
      productId: p.id,
      name: p.name,
      size: size ?? null,
      quantity: item.quantity,
      unitPrice,
      basePrice: Number(p.price),
      currency: p.currency,
      lineTotal,
      available: !problem,
      availableQuantity,
      problem,
      url: `${siteUrl()}/producto/${p.vendor.slug}/${p.slug}`,
    });
    if (!problem) group.totals[p.currency] = Math.round(((group.totals[p.currency] ?? 0) + lineTotal) * 100) / 100;
  }
  res.json({ data: { valid, stores: [...stores.values()], issues } });
}

// ---- Info de la llave --------------------------------------------------------------------------

export async function getMe(req, res) {
  const k = req.partnerKey;
  const live = await liveCounters(k);
  res.json({
    data: {
      partner: { name: req.partner.name, code: req.partner.code },
      key: { name: k.name, kind: k.kind, prefix: k.prefix, scopes: k.scopes, allowedDomains: k.allowedDomains, allowedIps: k.allowedIps, expiresAt: k.expiresAt },
      quota: live,
      signupUrl: `${siteUrl()}/vender?socio=${encodeURIComponent(req.partner.code)}`,
      availableScopes: PARTNER_SCOPES.map(({ id, label }) => ({ id, label })),
    },
  });
}
