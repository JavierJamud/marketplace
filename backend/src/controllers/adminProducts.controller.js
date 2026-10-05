import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import {
  productSchema,
  reconcileStock,
  assertPaymentMethodsAllowed,
  assertBadgeAllowed,
  expireNewBadges,
  extractPriceTiers,
  replacePriceTiers,
  productPriceTiersInclude,
} from "./products.controller.js";
import { withComputedVendorFields } from "../services/vendorVerification.service.js";
import { paginationQuerySchema, pageArgs, pageMeta } from "../lib/pagination.js";
import { completenessScore } from "../lib/productRanking.js";

// Bloque 52 (pedido explícito): "todo lo que agrega el vendedor debe tener
// supervisión y conexión visual o de edición para el administrador en todo
// momento" — antes no existía NINGUNA pantalla admin para ver/editar
// productos individuales (solo estadísticas agregadas por tienda en
// AdminVendors.jsx). Mismo criterio de moderación que adminOffers.controller.js:
// el admin puede tocar el producto de CUALQUIER vendedor, sin los límites de
// plan que sí aplican en products.controller.js (ese gate es para que el
// propio vendedor no se pase de su cupo, no tiene sentido para el admin).

// Bloque 241 (pedido explícito): la lista dejó de ser "los últimos 200" sin
// avisar — ahora pagina en el servidor, filtra por estado/rubro y ordena por
// las métricas reales que ya viven como columnas de Product (salesCount,
// viewCount, clickCount, rating...), así que "más vendidos" es un simple
// orderBy sobre un dato verdadero, no un cálculo nuevo.
const LOW_STOCK_THRESHOLD = 3; // mismo umbral que ProductCard.jsx y vendors.controller.js

const listQuerySchema = paginationQuerySchema.extend({
  q: z.string().trim().max(100).optional(),
  vendorId: z.string().optional(),
  categoryId: z.string().optional(),
  status: z.enum(["all", "active", "paused", "out", "low", "noimage", "featured"]).default("all"),
  sort: z.enum(["recent", "sales", "views", "clicks", "rating", "stock", "price"]).default("recent"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

function statusWhere(status) {
  switch (status) {
    case "active":
      return { isActive: true };
    case "paused":
      return { isActive: false };
    case "out":
      return { stock: 0, unlimitedStock: false };
    case "low":
      return { stock: { gt: 0, lte: LOW_STOCK_THRESHOLD }, unlimitedStock: false };
    case "noimage":
      return { images: { isEmpty: true } };
    case "featured":
      return { isFeatured: true };
    default:
      return {};
  }
}

function orderByFor(sort, dir) {
  const map = {
    recent: [{ createdAt: dir }],
    sales: [{ salesCount: dir }],
    views: [{ viewCount: dir }],
    clicks: [{ clickCount: dir }],
    rating: [{ rating: dir }, { reviewCount: dir }],
    stock: [{ stock: dir }],
    price: [{ price: dir }],
  };
  // `id` como desempate: sin un orden total, una página puede repetir o
  // saltarse filas entre una consulta y la siguiente cuando hay empates
  // (muchos productos con 0 ventas, por ejemplo).
  return [...map[sort], { id: "asc" }];
}

export async function listAllProducts(req, res) {
  const query = listQuerySchema.parse(req.query);
  const { q, vendorId, categoryId, status, sort, dir } = query;
  await expireNewBadges(vendorId || undefined);

  const scope = { vendorId: vendorId || undefined, categoryId: categoryId || undefined };
  const where = {
    ...scope,
    ...statusWhere(status),
    ...(q
      ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { vendor: { companyName: { contains: q, mode: "insensitive" } } }] }
      : {}),
  };

  // Los contadores de la tira de resumen respetan la tienda y el rubro, pero
  // NO el estado ni la búsqueda: cada tarjeta es a la vez un filtro, así que
  // su número tiene que quedarse quieto mientras se cambia de filtro.
  const [products, total, kpiTotal, kpiActive, kpiPaused, kpiOut, kpiLow, kpiNoImage, kpiFeatured] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        vendor: { select: { id: true, companyName: true, slug: true, verificationStatus: true, currency: true } },
        category: { select: { id: true, name: true } },
        ...productPriceTiersInclude,
      },
      orderBy: orderByFor(sort, dir),
      ...pageArgs(query),
    }),
    prisma.product.count({ where }),
    prisma.product.count({ where: scope }),
    prisma.product.count({ where: { ...scope, ...statusWhere("active") } }),
    prisma.product.count({ where: { ...scope, ...statusWhere("paused") } }),
    prisma.product.count({ where: { ...scope, ...statusWhere("out") } }),
    prisma.product.count({ where: { ...scope, ...statusWhere("low") } }),
    prisma.product.count({ where: { ...scope, ...statusWhere("noimage") } }),
    prisma.product.count({ where: { ...scope, ...statusWhere("featured") } }),
  ]);

  res.json({
    products: products.map((p) => ({ ...p, vendor: withComputedVendorFields(p.vendor) })),
    kpis: { all: kpiTotal, active: kpiActive, paused: kpiPaused, out: kpiOut, low: kpiLow, noimage: kpiNoImage, featured: kpiFeatured },
    ...pageMeta(query, total),
  });
}

// Bloque 241 (pedido explícito — "cada producto puede mostrar su estadística
// real"): detalle bajo demanda al abrir una fila (no se calcula para las 25
// filas de la página). Todo sale de columnas o de pedidos reales; "ventas de
// los últimos 30 días" cuenta solo pedidos ENTREGADOS, mismo criterio que ya
// usa getVendorStats para "ventas totales" (un pedido nuevo o cancelado no
// es una venta).
const DAY_MS = 24 * 60 * 60 * 1000;

export async function getAdminProductStats(req, res) {
  const { id } = req.params;
  const product = await prisma.product.findUnique({
    where: { id },
    include: {
      ...productPriceTiersInclude,
      vendor: { select: { companyName: true, slug: true, currency: true } },
      _count: { select: { favorites: true, requests: true } },
    },
  });
  if (!product) throw new AppError("Producto no encontrado.", 404);

  const items = await prisma.orderItem.findMany({
    where: { productId: id, order: { status: "DELIVERED", createdAt: { gte: new Date(Date.now() - 30 * DAY_MS) } } },
    select: { quantity: true, price: true },
  });
  const units30 = items.reduce((sum, i) => sum + i.quantity, 0);
  const revenue30 = items.reduce((sum, i) => sum + Number(i.price) * i.quantity, 0);

  res.json({
    stats: {
      units30,
      revenue30,
      currency: product.currency,
      salesCount: product.salesCount,
      viewCount: product.viewCount,
      clickCount: product.clickCount,
      searchClickCount: product.searchClickCount,
      avgDwellSeconds: product.viewCount > 0 ? Math.round(product.totalDwellMs / product.viewCount / 1000) : null,
      rating: Number(product.rating),
      reviewCount: product.reviewCount,
      favoriteCount: product._count.favorites,
      requestCount: product._count.requests,
      completeness: completenessScore(product),
      lastActivityAt: product.lastActivityAt,
      createdAt: product.createdAt,
      vendor: { companyName: product.vendor.companyName, slug: product.vendor.slug },
      slug: product.slug,
    },
  });
}

// Mismo schema/reglas de forma que el propio vendedor (products.controller.js),
// pero sin resolveMyVendor: el :id de la URL manda, no hay dueño implícito.
export async function updateAdminProduct(req, res) {
  const { id } = req.params;
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new AppError("Producto no encontrado.", 404);

  const parsed = productSchema.partial().parse(req.body);
  const hasTiersInPayload = parsed.priceTiers !== undefined;
  const rawTiers = extractPriceTiers(parsed);
  const data = reconcileStock(parsed);
  await assertPaymentMethodsAllowed(data.paymentMethods);
  if (data.badge !== undefined) await assertBadgeAllowed(data.badge);
  // Bloque 65: mismo criterio que updateProduct del propio vendedor — la
  // moneda del producto siempre sigue a la de su tienda, nunca un valor
  // aparte (acá de paso re-normaliza cualquier producto viejo que haya
  // quedado con una moneda distinta a la de su tienda).
  const vendor = await prisma.vendor.findUnique({ where: { id: existing.vendorId }, select: { currency: true } });
  data.currency = vendor.currency;

  const basePrice = data.price ?? existing.price;

  const product = await prisma.$transaction(async (tx) => {
    if (hasTiersInPayload) await replacePriceTiers(tx, id, basePrice, rawTiers);
    return tx.product.update({
      where: { id },
      data,
      include: {
        vendor: { select: { companyName: true, slug: true } },
        category: { select: { name: true } },
        ...productPriceTiersInclude,
      },
    });
  });
  res.json({ product });
}

export async function deleteAdminProduct(req, res) {
  const { id } = req.params;
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new AppError("Producto no encontrado.", 404);

  await prisma.product.delete({ where: { id } });
  res.json({ ok: true });
}
