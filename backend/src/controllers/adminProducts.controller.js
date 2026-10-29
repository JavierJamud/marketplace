import { productVisibility, VENDOR_VISIBILITY_SELECT } from "../lib/publicVisibility.js";
import { productSalesHistory } from "../lib/productSales.js";
import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { deleteUploadedImages } from "../lib/uploadFiles.js";
import {
  productSchema,
  reconcileStock,
  assertPaymentMethodsAllowed,
  assertBadgeAllowed,
  expireNewBadges,
  extractPriceTiers,
  replacePriceTiers,
  assertValidPriceTiers,
  assertStockModeConsistent,
  productPriceTiersInclude,
} from "./products.controller.js";
import { logActivity } from "../lib/activityLog.js";
import { adminNoticeToVendor } from "../lib/notify.js";
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
  status: z.enum(["all", "active", "paused", "hidden", "out", "low", "noimage", "featured"]).default("all"),
  sort: z.enum(["recent", "sales", "views", "clicks", "rating", "stock", "price"]).default("recent"),
  dir: z.enum(["asc", "desc"]).default("desc"),
});

// Oculto al público aunque no esté en pausa: lo mismo que filtran las páginas públicas (ver lib/publicVisibility.js).
const HIDDEN_WHERE = {
  OR: [
    { suspendedAt: { not: null } },
    { overQuota: true },
    { hiddenFromStore: true },
    { vendor: { OR: [{ isBlocked: true }, { deletedAt: { not: null } }, { status: { not: "ACTIVE" } }] } },
  ],
};

function statusWhere(status) {
  switch (status) {
    // "Activos" = los que el público de verdad puede ver (antes contaba también los de tiendas bloqueadas o eliminadas).
    case "active":
      return { isActive: true, NOT: HIDDEN_WHERE };
    case "hidden":
      return { isActive: true, ...HIDDEN_WHERE };
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

  // Una categoría principal abarca también sus subcategorías: los productos se cargan casi siempre en la hija, así que
  // filtrar solo por el id de la principal dejaba la lista vacía.
  let categoryWhere;
  if (categoryId) {
    const children = await prisma.category.findMany({ where: { parentId: categoryId }, select: { id: true } });
    categoryWhere = children.length > 0 ? { in: [categoryId, ...children.map((c) => c.id)] } : categoryId;
  }
  const scope = { vendorId: vendorId || undefined, categoryId: categoryWhere };
  // Estado y búsqueda van en un AND: los dos pueden traer su propio OR ("Ocultos al público" lo trae) y, sueltos en el
  // mismo objeto, el de la búsqueda pisaba al del estado.
  const where = {
    ...scope,
    AND: [
      statusWhere(status),
      q ? { OR: [{ name: { contains: q, mode: "insensitive" } }, { vendor: { companyName: { contains: q, mode: "insensitive" } } }] } : {},
    ],
  };

  // Los contadores de la tira de resumen respetan la tienda y el rubro, pero
  // NO el estado ni la búsqueda: cada tarjeta es a la vez un filtro, así que
  // su número tiene que quedarse quieto mientras se cambia de filtro.
  const [products, total, kpiTotal, kpiActive, kpiPaused, kpiHidden, kpiOut, kpiLow, kpiNoImage, kpiFeatured] = await Promise.all([
    prisma.product.findMany({
      where,
      include: {
        vendor: { select: { id: true, companyName: true, slug: true, verificationStatus: true, currency: true, ...VENDOR_VISIBILITY_SELECT } },
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
    prisma.product.count({ where: { ...scope, ...statusWhere("hidden") } }),
    prisma.product.count({ where: { ...scope, ...statusWhere("out") } }),
    prisma.product.count({ where: { ...scope, ...statusWhere("low") } }),
    prisma.product.count({ where: { ...scope, ...statusWhere("noimage") } }),
    prisma.product.count({ where: { ...scope, ...statusWhere("featured") } }),
  ]);

  res.json({
    // `visibility`: si el público lo ve y, si no, por qué (el admin ya no ve "Activo" en algo que nadie puede ver).
    products: products.map((p) => ({ ...p, visibility: productVisibility(p, p.vendor), vendor: withComputedVendorFields(p.vendor) })),
    kpis: { all: kpiTotal, active: kpiActive, paused: kpiPaused, hidden: kpiHidden, out: kpiOut, low: kpiLow, noimage: kpiNoImage, featured: kpiFeatured },
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

// Ventas de cualquier producto (mismo historial que ve su tienda).
export async function getAdminProductSales(req, res) {
  const history = await productSalesHistory(req.params.id);
  if (!history) throw new AppError("Producto no encontrado.", 404);
  res.json(history);
}

// Valor comparable de una columna para saber si el guardado la cambió de verdad: el Decimal de Prisma pasa a número
// (el formulario manda números) y las fechas a texto; tallas y stock por talla se comparan como JSON.
function comparableValue(value) {
  if (value == null) return null;
  if (typeof value.toNumber === "function") return value.toNumber();
  if (value instanceof Date) return value.toISOString();
  return value;
}

// Campos que el guardado cambió respecto de lo que había. El modal del admin manda siempre todos los campos, así que
// las claves recibidas no dicen qué se tocó. La moneda no cuenta: la pone el servidor (sigue a la de la tienda).
function changedProductFields(data, existing) {
  return Object.keys(data).filter(
    (k) => k !== "currency" && data[k] !== undefined && JSON.stringify(comparableValue(data[k])) !== JSON.stringify(comparableValue(existing[k])),
  );
}

// Precios por cantidad en una forma comparable (orden por cantidad y precio como número).
const tiersKey = (tiers) => JSON.stringify([...(tiers ?? [])].sort((a, b) => a.minQty - b.minQty).map((t) => [t.minQty, Number(t.price)]));

// Mismo schema/reglas de forma que el propio vendedor (products.controller.js),
// pero sin resolveMyVendor: el :id de la URL manda, no hay dueño implícito.
export async function updateAdminProduct(req, res) {
  const { id } = req.params;
  const existing = await prisma.product.findUnique({ where: { id }, include: productPriceTiersInclude });
  if (!existing) throw new AppError("Producto no encontrado.", 404);

  const parsed = productSchema.partial().parse(req.body);
  const hasTiersInPayload = parsed.priceTiers !== undefined;
  const rawTiers = extractPriceTiers(parsed);
  // Con tallas, el stock es la suma de cada talla (ver reconcileStock) y se edita desde el panel de la tienda. Un
  // `stock` suelto, sin las tallas, no se acepta: pisaría la suma y, con ventas entre que se abrió el formulario y se
  // guardó, devolvería unidades ya vendidas.
  if (parsed.sizes === undefined && (existing.sizes?.length ?? 0) > 0) {
    delete parsed.stock;
    delete parsed.sizeStock;
  }
  const data = reconcileStock(parsed);
  assertStockModeConsistent(data.sizes ?? existing.sizes, data.unlimitedStock ?? existing.unlimitedStock);
  await assertPaymentMethodsAllowed(data.paymentMethods);
  if (data.badge !== undefined) await assertBadgeAllowed(data.badge);
  // Bloque 65: mismo criterio que updateProduct del propio vendedor — la
  // moneda del producto siempre sigue a la de su tienda, nunca un valor
  // aparte (acá de paso re-normaliza cualquier producto viejo que haya
  // quedado con una moneda distinta a la de su tienda).
  const vendor = await prisma.vendor.findUnique({ where: { id: existing.vendorId }, select: { currency: true } });
  data.currency = vendor.currency;

  const basePrice = data.price ?? existing.price;

  // Misma regla que updateProduct de la tienda: si estaba agotado y el guardado le devuelve stock, las solicitudes de
  // "avísame cuando repongas" de este ciclo se cierran.
  const wasOutOfStock = !existing.unlimitedStock && existing.stock <= 0;
  const isRestocked = wasOutOfStock && ((data.unlimitedStock ?? existing.unlimitedStock) || (data.stock ?? existing.stock) > 0);

  const product = await prisma.$transaction(async (tx) => {
    if (hasTiersInPayload) {
      await replacePriceTiers(tx, id, basePrice, rawTiers);
    } else if (data.price !== undefined && Number(data.price) !== Number(existing.price)) {
      // Cambió el precio sin tocar los precios por cantidad: los que ya había tienen que seguir por debajo del nuevo
      // precio, si no quedaría un precio de mayoreo más caro que el de una unidad (igual que en products.controller.js).
      // Solo si el precio cambió de verdad: el modal manda siempre `price`, y un producto viejo con tramos ya inválidos
      // no dejaría al admin corregir ningún otro campo (justo el caso en que le toca arreglar datos).
      const currentTiers = await tx.productPriceTier.findMany({ where: { productId: id } });
      if (currentTiers.length > 0) assertValidPriceTiers(data.price, currentTiers.map((t) => ({ minQty: t.minQty, price: Number(t.price) })));
    }
    if (isRestocked) await tx.productRequest.deleteMany({ where: { productId: id } });
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
  // Queda en el historial de la tienda quién cambió qué (solo los campos que cambiaron de verdad); el aviso a la tienda
  // sale solo si el admin marcó "Avisar a la tienda" (cabecera X-Notify-Vendor, ver adminNoticeToVendor). Un guardado
  // sin cambios no deja registro ni avisa: no hay nada que contar.
  const fields = changedProductFields(data, existing);
  if (hasTiersInPayload && tiersKey(existing.priceTiers) !== tiersKey(product.priceTiers)) fields.push("priceTiers");
  if (fields.length > 0) {
    logActivity({
      actorId: req.user.id,
      actorRole: "ADMIN",
      vendorId: existing.vendorId,
      action: "admin_product_updated",
      description: `Un admin editó el producto "${existing.name}"`,
      meta: { productId: id, fields },
    });
    await adminNoticeToVendor(existing.vendorId, "Editamos un producto tuyo", `El equipo de la plataforma actualizó "${product.name}". Puedes revisarlo en Productos.`);
  }
  res.json({ product });
}

export async function deleteAdminProduct(req, res) {
  const { id } = req.params;
  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing) throw new AppError("Producto no encontrado.", 404);

  await prisma.product.delete({ where: { id } });
  void deleteUploadedImages(existing.images);
  logActivity({
    actorId: req.user.id,
    actorRole: "ADMIN",
    vendorId: existing.vendorId,
    action: "admin_product_deleted",
    description: `Un admin eliminó el producto "${existing.name}"`,
    meta: { productId: id },
  });
  await adminNoticeToVendor(existing.vendorId, "Eliminamos un producto tuyo", `El equipo de la plataforma eliminó "${existing.name}".`);
  res.json({ ok: true });
}
