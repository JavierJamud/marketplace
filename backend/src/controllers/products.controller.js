import { z } from "zod";
import jwt from "jsonwebtoken";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { slugify } from "../utils/slugify.js";
import { env } from "../config/env.js";
import { isAIAvailable } from "../lib/ai.js";
import { withComputedVendorFields } from "../services/vendorVerification.service.js";
import { logActivity } from "../lib/activityLog.js";

const REGULAR_PLAN_PRODUCT_LIMIT = 20;

const __dirname = dirname(fileURLToPath(import.meta.url));
// A diferencia de uploads/kyc (privado), las fotos de producto son públicas
// por diseño — son parte del catálogo. Organizadas por carpeta de tienda:
// uploads/products/<slug-de-la-tienda>/<archivo>.
export const PRODUCT_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "products");

// Exportado para reuso en adminProducts.controller.js — el admin edita
// cualquier producto de cualquier vendedor con las mismas reglas de forma
// (obligatoriedad de descripción, límites de tags/tallas, etc.), solo que
// sin el gate de plan/límite que sí aplica acá para el propio vendedor.
export const productSchema = z.object({
  name: z.string().min(2),
  // Bloque 51 (pedido explícito): obligatoria para TODO producto — antes era
  // opcional. z.preprocess normaliza null/undefined a "" primero para que el
  // mensaje de error sea el mismo (uno solo, claro) tanto si el campo llega
  // vacío como si no llega — y porque productSchema.partial() (updateProduct)
  // igual vuelve a marcar todo opcional, así que sin este preprocess un
  // update que reenvíe description: null pasaría de largo la validación.
  description: z.preprocess(
    (v) => v ?? "",
    z.string().trim().min(10, "La descripción es obligatoria — contale al cliente qué es este producto (mínimo 10 caracteres).")
  ),
  // Bloque 66 (pedido explícito): obligatoria — antes opcional.
  categoryId: z.string().min(1, "Elige una categoría."),
  price: z.number().positive(),
  oldPrice: z.number().positive().optional().nullable(),
  stock: z.number().int().min(0).default(0),
  // Bloque 56: "disponible siempre" — el vendedor no tiene (o no quiere
  // llevar) un stock acotado real para este producto. Con esto en true,
  // `stock` deja de ser obligatorio/relevante en todo el sistema (ver
  // assertStockModeConsistent más abajo y los bypass en orders.controller.js).
  unlimitedStock: z.boolean().optional().default(false),
  barcode: z.string().optional(),
  badge: z.string().optional().nullable(),
  // "table" no es seleccionable desde el form (VendorProducts.jsx no lo
  // ofrece como checkbox) — lo trae únicamente el menú de restaurante
  // sembrado. Sin esto en el enum, guardar CUALQUIER edición de un ítem de
  // menú fallaba 400 porque el payload reenvía el paymentMethods existente
  // tal cual, y ese array ya incluye "table".
  paymentMethods: z.array(z.enum(["whatsapp", "cod", "prepaid", "table"])).min(1),
  isFeatured: z.boolean().optional(),
  isActive: z.boolean().optional(),
  // Bloque 16: independiente de todo lo anterior — si el producto aparece en
  // el menú QR de mesa (ver tables.controller.js getTableByToken).
  availableForTableMenu: z.boolean().optional(),
  // Bloque 22: hasta 5, opcionales. Se guardan en minúscula/trim acá (no
  // solo en el frontend) para que un request directo a la API no se salte
  // la normalización que search.controller.js necesita para matchear bien.
  tags: z
    .array(z.string().trim().toLowerCase().min(1))
    .max(5, "Máximo 5 tags por producto.")
    .optional(),
  // Bloque 52: tallas (pedido explícito) — letras (S/M/L) o números
  // (calzado), tag libre igual que `tags`. Se mantienen en el case/trim tal
  // cual las escribió el vendedor (a diferencia de tags, acá SÍ importa
  // mostrarlas como el vendedor las quiso: "M" vs "42" vs "Talla única").
  sizes: z.array(z.string().trim().min(1)).max(30, "Máximo 30 tallas.").optional(),
  // { "S": 5, "M": 12, ... } — reconcileStock() de abajo la filtra contra
  // `sizes` y recalcula `stock` como la suma, así que lo que llegue acá para
  // tallas que ya no están en `sizes` simplemente se descarta.
  sizeStock: z.record(z.string(), z.number().int().min(0)).optional(),
  // Bloque 55: precios por cantidad (mayoreo) — 100% opcional. Cada fila es
  // "a partir de esta cantidad, el precio por unidad es este"; el orden y la
  // relación con `price` (siempre decreciente) se valida en
  // assertValidPriceTiers, no acá — zod solo valida la forma de cada fila.
  priceTiers: z
    .array(
      z.object({
        minQty: z.number().int().min(2, "La cantidad mínima debe ser al menos 2."),
        price: z.number().positive(),
      })
    )
    .max(10, "Máximo 10 precios por cantidad.")
    .optional(),
  // Moneda del producto — elegida por el vendedor al publicar, validada
  // contra SiteSettings.availableCurrencies. Por defecto USD.
  currency: z.enum(["CUP", "USD", "EUR", "MXN"]).optional().default("USD"),
});

// Bloque 55: saca `priceTiers` del objeto ya parseado por zod (Prisma no
// acepta un array plano bajo el nombre de una relación, necesita la sintaxis
// de nested write `{ create: [...] }`) — se maneja aparte en cada
// create/update. Devuelve `undefined` si el payload no traía la clave (caso
// típico de un update parcial que no toca los precios por cantidad).
export function extractPriceTiers(data) {
  const priceTiers = data.priceTiers;
  delete data.priceTiers;
  return priceTiers;
}

// Devuelve las monedas habilitadas por el admin (SiteSettings).
async function getAvailableCurrencies() {
  const s = await prisma.siteSettings.findFirst({ select: { availableCurrencies: true } });
  return s?.availableCurrencies ?? ["USD", "CUP", "EUR", "MXN"];
}

// Reglas de negocio (no expresables limpio en zod): cantidades únicas y
// crecientes, con el precio bajando estrictamente a medida que sube la
// cantidad — nunca igual o mayor al escalón anterior (ni al precio base).
// Devuelve la lista ya ordenada por minQty asc, lista para guardar.
export function assertValidPriceTiers(basePrice, tiers) {
  if (!tiers || tiers.length === 0) return [];
  const sorted = [...tiers].sort((a, b) => a.minQty - b.minQty);
  const seenQty = new Set();
  let lastPrice = Number(basePrice);
  for (const t of sorted) {
    if (seenQty.has(t.minQty)) {
      throw new AppError(`Ya hay un precio para ${t.minQty} unidades — no puede repetirse.`, 400);
    }
    seenQty.add(t.minQty);
    if (Number(t.price) >= lastPrice) {
      throw new AppError(
        `El precio a partir de ${t.minQty} unidades (${t.price}) debe ser menor que el precio anterior (${lastPrice}).`,
        400
      );
    }
    lastPrice = Number(t.price);
  }
  return sorted;
}

// Reemplaza TODOS los precios por cantidad de un producto dentro de una
// transacción — mismo criterio de "reemplazo completo" que updateOrderItems
// en orders.controller.js. Usado por updateProduct (vendedor) y
// updateAdminProduct (admin).
export async function replacePriceTiers(tx, productId, basePrice, rawTiers) {
  const tiers = assertValidPriceTiers(basePrice, rawTiers);
  await tx.productPriceTier.deleteMany({ where: { productId } });
  if (tiers.length > 0) {
    await tx.productPriceTier.createMany({ data: tiers.map((t) => ({ productId, minQty: t.minQty, price: t.price })) });
  }
  return tiers;
}

// Fragmento de `include` reusable — los tiers siempre se devuelven
// ordenados por cantidad ascendente, listos para pintar sin reordenar en el frontend.
export const productPriceTiersInclude = { priceTiers: { orderBy: { minQty: "asc" } } };

// Cuando el producto tiene tallas, `stock` deja de ser un número que el
// vendedor edita a mano — se vuelve la suma derivada de sizeStock, para que
// TODO el código existente que ya lee Product.stock (carrito, dashboard,
// bajo stock, límite de plan, menú QR) siga funcionando sin tener que
// enterarse de tallas. Solo corre si `sizes` viene en el payload (nunca en
// un update parcial que no toca tallas).
export function reconcileStock(data) {
  if (data.sizes === undefined) return data;
  if (data.sizes.length === 0) {
    data.sizeStock = null;
    return data;
  }
  const filtered = {};
  for (const size of data.sizes) filtered[size] = Math.max(0, Math.trunc(Number(data.sizeStock?.[size] ?? 0)));
  data.sizeStock = filtered;
  data.stock = Object.values(filtered).reduce((sum, n) => sum + n, 0);
  return data;
}

// Bloque 56: "disponible siempre" (unlimitedStock) y tallas son mutuamente
// excluyentes — cada talla necesita su propio stock real (sizeStock), así
// que no tiene sentido combinarlas con "no llevo stock de este producto".
// Recibe el estado FINAL (ya mezclado con lo existente si es un update
// parcial), no solo lo que trae este request puntual.
export function assertStockModeConsistent(finalSizes, finalUnlimitedStock) {
  if (finalUnlimitedStock && finalSizes?.length > 0) {
    throw new AppError("Un producto con tallas no puede marcarse como \"disponible siempre\" — cada talla necesita su propio stock.", 400);
  }
}

// Bloque 52: "whatsapp" y "table" son fijos (siempre disponibles / solo
// vienen del menú QR sembrado, nunca elegibles a mano) — "cod"/"prepaid" son
// los ÚNICOS que el admin puede prender/apagar globalmente desde AdminOffers-
// adyacente (settings.controller.js → productPaymentMethods). Sin esto, un
// vendedor podría guardar un canal que el admin ya desactivó para todo el
// sitio (ej. si dejó de tener sentido "transferencia CUP" en algún momento).
export async function assertPaymentMethodsAllowed(paymentMethods) {
  if (!paymentMethods) return;
  const settings = await prisma.siteSettings.findFirst();
  const allowed = new Set(["whatsapp", "table", ...(settings?.productPaymentMethods ?? ["cod", "prepaid"])]);
  const rejected = paymentMethods.filter((m) => !allowed.has(m));
  if (rejected.length) {
    throw new AppError(`El método de pago "${rejected[0]}" ya no está disponible en la plataforma.`, 400);
  }
}

// Bloque 66 (pedido explícito): catálogo de etiquetas administrable, mismo
// patrón que assertPaymentMethodsAllowed arriba. "Nuevo" es un valor fijo del
// sistema — siempre permitido, nunca vive en availableProductBadges (se
// fuerza server-side al crear, ver createProduct, y nunca lo puede
// desactivar el admin). null/"" (sin etiqueta) también se deja pasar.
export async function assertBadgeAllowed(badge) {
  if (!badge) return;
  const settings = await prisma.siteSettings.findFirst();
  const allowed = new Set(["Nuevo", ...(settings?.availableProductBadges ?? [])]);
  if (!allowed.has(badge)) {
    throw new AppError(`La etiqueta "${badge}" ya no está disponible en la plataforma.`, 400);
  }
}

// Bloque 66: expiración perezosa de la etiqueta "Nuevo" — mismo criterio que
// expireStaleStoreOffers/expireStaleOffers (sin cron propio, se vence en
// caliente en cada lectura relevante). Contada desde `activatedAt` (cuándo
// el producto salió a la venta de verdad, no cuándo se creó el registro).
// vendorId acota la vencida a una sola tienda cuando quien llama ya sabe
// cuál es (listMyProducts/getVendorBySlug); sin vendorId vence global
// (structuredSearch/listAllProducts, que abarcan varias tiendas a la vez).
export async function expireNewBadges(vendorId) {
  const settings = await prisma.siteSettings.findFirst();
  const durationDays = settings?.newBadgeDurationDays ?? 14;
  const cutoff = new Date(Date.now() - durationDays * 24 * 60 * 60 * 1000);
  await prisma.product.updateMany({
    where: { badge: "Nuevo", activatedAt: { not: null, lt: cutoff }, ...(vendorId ? { vendorId } : {}) },
    data: { badge: null },
  });
}

const BESTSELLER_WINDOW_DAYS = 30;

// Bloque 66: "Más vendido" es un indicador COMPUTADO (nunca se guarda en
// `badge`) — el producto con más unidades vendidas de CADA tienda en los
// últimos 30 días, mismo criterio/ventana que `topProducts` del dashboard de
// vendedor (vendors.controller.js). Recibe una lista de productos YA
// cargada (de cualquier endpoint que liste productos de varias tiendas a la
// vez) y le agrega `isBestSeller` a cada uno sin mutar nada más. El "top" se
// calcula sobre TODAS las ventas recientes de esa tienda (no solo las de la
// lista en pantalla), así que un producto filtrado fuera de la vista actual
// nunca hace que otro se marque "más vendido" por error.
export async function attachBestSellerFlag(products) {
  const vendorIds = [...new Set(products.map((p) => p.vendorId))];
  if (vendorIds.length === 0) return products;

  const windowAgo = new Date(Date.now() - BESTSELLER_WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const topItemsRaw = await prisma.orderItem.groupBy({
    by: ["productId"],
    where: { productId: { not: null }, order: { vendorId: { in: vendorIds }, createdAt: { gte: windowAgo } } },
    _sum: { quantity: true },
  });
  if (topItemsRaw.length === 0) return products.map((p) => ({ ...p, isBestSeller: false }));

  const soldProductIds = topItemsRaw.map((t) => t.productId);
  const soldProducts = await prisma.product.findMany({ where: { id: { in: soldProductIds } }, select: { id: true, vendorId: true } });
  const vendorByProductId = new Map(soldProducts.map((p) => [p.id, p.vendorId]));

  const bestPerVendor = new Map(); // vendorId -> { productId, qty }
  for (const row of topItemsRaw) {
    const vendorId = vendorByProductId.get(row.productId);
    if (!vendorId) continue;
    const qty = row._sum.quantity ?? 0;
    const current = bestPerVendor.get(vendorId);
    if (!current || qty > current.qty) bestPerVendor.set(vendorId, { productId: row.productId, qty });
  }
  const bestSellerIds = new Set([...bestPerVendor.values()].map((b) => b.productId));
  return products.map((p) => ({ ...p, isBestSeller: bestSellerIds.has(p.id) }));
}

export async function getProductBySlug(req, res) {
  const { vendorSlug, productSlug } = req.params;

  const vendor = await prisma.vendor.findUnique({ where: { slug: vendorSlug } });
  if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE") throw new AppError("Producto no encontrado.", 404);

  const product = await prisma.product.findFirst({
    where: { vendorId: vendor.id, slug: productSlug, isActive: true },
    include: {
      options: true,
      category: true,
      ...productPriceTiersInclude,
      vendor: {
        select: {
          id: true,
          companyName: true,
          slug: true,
          verificationStatus: true,
          whatsapp: true,
          color: true,
          orderDestination: true,
          locations: { include: { province: true, municipality: true }, take: 1 },
        },
      },
      // Bloque 69 (bug real encontrado de paso): faltaba `isHidden: false`
      // acá — un comentario oculto por el admin, o recién oculto por un
      // reporte (ver reviews.controller.js), seguía apareciendo en la ficha
      // del producto. `getVendorBySlug` (vendors.controller.js) sí lo filtraba
      // desde el Bloque 22; a este endpoint se le pasó por alto.
      reviews: { where: { rating: { not: null }, isHidden: false }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!product) throw new AppError("Producto no encontrado.", 404);

  const ratingAgg = await prisma.review.aggregate({
    where: { productId: product.id, rating: { not: null }, isHidden: false },
    _avg: { rating: true },
    _count: { rating: true },
  });

  const related = await prisma.product.findMany({
    where: { categoryId: product.categoryId, isActive: true, id: { not: product.id } },
    include: { vendor: { select: { companyName: true, slug: true, verificationStatus: true } } },
    take: 4,
  });

  // Bloque 25: mismo flag que getVendorBySlug — StoreChatWidget se monta
  // acá con product.vendor, así que necesita su propio aiAvailable en vez
  // de depender de que el cliente haya pasado antes por Store.jsx.
  const aiAvailable = product.vendor.verificationStatus === "VERIFIED" ? await isAIAvailable() : false;

  res.json({
    product: {
      ...product,
      vendor: withComputedVendorFields({ ...product.vendor, aiAvailable }),
      rating: ratingAgg._avg.rating ? Math.round(ratingAgg._avg.rating * 10) / 10 : null,
      reviewCount: ratingAgg._count.rating,
    },
    related: related.map((p) => ({ ...p, vendor: withComputedVendorFields(p.vendor) })),
  });
}

export async function lookupByBarcode(req, res) {
  const { barcode } = req.params;
  const product = await prisma.product.findFirst({ where: { barcode }, include: { vendor: true } });
  if (!product) throw new AppError("Producto no encontrado.", 404);
  res.json({ product: { ...product, vendor: withComputedVendorFields(product.vendor) } });
}

// --- Panel de vendedor: CRUD de MIS productos (vendorId siempre resuelto
// desde el usuario autenticado, nunca desde el body/params del cliente) -----

export async function listMyProducts(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  await expireNewBadges(vendor.id);
  const products = await prisma.product.findMany({
    where: { vendorId: vendor.id },
    include: {
      category: true,
      options: true,
      ...productPriceTiersInclude,
      // Bloque 23: cuántas veces pidieron "avisame cuando repongas" — se
      // muestra en VendorProducts.jsx para priorizar qué producto agotado
      // reponer primero (ordenable por este número).
      _count: { select: { requests: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ products, planType: vendor.planType, limit: vendor.planType === "REGULAR" ? REGULAR_PLAN_PRODUCT_LIMIT : null });
}

export async function createProduct(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const parsed = productSchema.parse(req.body);
  const rawTiers = extractPriceTiers(parsed);
  const data = reconcileStock(parsed);
  assertStockModeConsistent(data.sizes, data.unlimitedStock);

  // Bloque 56 (pedido explícito): un producto recién creado todavía no tiene
  // fotos (necesita existir primero para poder subirlas, ver
  // resolveProductForUpload) — se crea siempre en pausa, sin importar lo que
  // haya mandado el cliente en `isActive`. addProductImages/addProductImageLink
  // lo reactivan automáticamente en cuanto tiene al menos 1 foto.
  data.isActive = false;
  // Moneda: la elige el vendedor por producto, validada contra las
  // monedas habilitadas por el admin en SiteSettings.
  const allowedCurrencies = await getAvailableCurrencies();
  const requestedCurrency = data.currency ?? "USD";
  if (!allowedCurrencies.includes(requestedCurrency)) {
    throw new AppError(`La moneda "${requestedCurrency}" no está disponible actualmente.`, 400);
  }
  data.currency = requestedCurrency;
  // Bloque 66 (pedido explícito): todo producto nuevo sale con "Nuevo" —
  // ignora cualquier valor que mande el cliente en este campo al crear.
  data.badge = "Nuevo";

  if (vendor.planType === "REGULAR") {
    const activeCount = await prisma.product.count({ where: { vendorId: vendor.id, isActive: true } });
    if (activeCount >= REGULAR_PLAN_PRODUCT_LIMIT) {
      throw new AppError(
        `Alcanzaste el límite de ${REGULAR_PLAN_PRODUCT_LIMIT} productos del Plan Regular. Verificate para pasar a Business y publicar sin límite.`,
        403
      );
    }
    // Plan Regular: solo WhatsApp como canal de pedido.
    data.paymentMethods = ["whatsapp"];
  } else {
    await assertPaymentMethodsAllowed(data.paymentMethods);
  }

  let slug = slugify(data.name);
  const slugTaken = await prisma.product.findUnique({ where: { vendorId_slug: { vendorId: vendor.id, slug } } });
  if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;

  // Bloque 55: precios por cantidad (mayoreo) — opcional, se validan contra
  // el precio base de ESTE mismo producto antes de crearlo.
  const validTiers = assertValidPriceTiers(data.price, rawTiers);

  const product = await prisma.product.create({
    data: {
      ...data,
      vendorId: vendor.id,
      slug,
      priceTiers: validTiers.length > 0 ? { create: validTiers } : undefined,
    },
    include: productPriceTiersInclude,
  });
  logActivity({
    actorId: req.user.id,
    actorRole: "VENDOR",
    vendorId: vendor.id,
    action: "product_created",
    description: `Creó el producto "${product.name}"`,
    meta: { productId: product.id },
  });
  res.status(201).json({ product });
}

export async function updateProduct(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing || existing.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);

  const parsed = productSchema.partial().parse(req.body);
  const hasTiersInPayload = parsed.priceTiers !== undefined;
  const rawTiers = extractPriceTiers(parsed);
  const data = reconcileStock(parsed);
  assertStockModeConsistent(data.sizes ?? existing.sizes, data.unlimitedStock ?? existing.unlimitedStock);
  // Bloque 65: cada guardado re-sincroniza la moneda del producto con la de
  // la tienda — así un producto viejo que haya quedado con una moneda
  // distinta (ej. la tienda la cambió después) se normaliza solo la próxima
  // vez que el vendedor lo edite y guarde, sin tocar nada en una migración.
  // Moneda: el vendedor puede cambiarla al editar, validada igual.
  if (data.currency) {
    const allowedCurrencies = await getAvailableCurrencies();
    if (!allowedCurrencies.includes(data.currency)) {
      throw new AppError(`La moneda "${data.currency}" no está disponible actualmente.`, 400);
    }
  }
  if (vendor.planType === "REGULAR" && data.paymentMethods) data.paymentMethods = ["whatsapp"];
  else await assertPaymentMethodsAllowed(data.paymentMethods);
  if (data.badge !== undefined) await assertBadgeAllowed(data.badge);

  const basePrice = data.price ?? existing.price;

  const product = await prisma.$transaction(async (tx) => {
    if (hasTiersInPayload) {
      // Reemplazo completo — mismo criterio que updateOrderItems (orders.controller.js).
      await replacePriceTiers(tx, id, basePrice, rawTiers);
    } else if (data.price !== undefined) {
      // El precio base cambió sin tocar los precios por cantidad — hay que
      // revalidar que los que ya existían sigan siendo menores al nuevo
      // precio, si no el producto queda en un estado inconsistente (un tier
      // de mayoreo más caro que el precio de 1 unidad).
      const currentTiers = await tx.productPriceTier.findMany({ where: { productId: id } });
      if (currentTiers.length > 0) {
        assertValidPriceTiers(data.price, currentTiers.map((t) => ({ minQty: t.minQty, price: Number(t.price) })));
      }
    }
    return tx.product.update({ where: { id }, data, include: productPriceTiersInclude });
  });
  res.json({ product });
}

export async function deleteProduct(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing || existing.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);

  await prisma.product.delete({ where: { id } });
  res.json({ ok: true });
}

// --- Imágenes de producto (públicas, organizadas por carpeta de tienda) ----

// Corre ANTES de multer: resuelve dueño/tienda del producto y lo cuelga en
// req para que productUpload.js sepa en qué carpeta guardar sin tener que
// hacer la consulta a la DB dentro del callback de destination de multer.
export async function resolveProductForUpload(req, res, next) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product || product.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);

  req.uploadVendorSlug = vendor.slug;
  req.uploadProduct = product;
  next();
}

export async function addProductImages(req, res) {
  if (!req.files?.length) throw new AppError("Sube al menos una imagen.", 400);

  const newUrls = req.files.map((f) => `/uploads/products/${req.uploadVendorSlug}/${f.filename}`);
  // Bloque 56: si este producto no tenía NINGUNA foto todavía, esta es la que
  // lo saca de la pausa forzada de createProduct — recién ahí sale a la venta.
  const wasEmpty = req.uploadProduct.images.length === 0;
  const product = await prisma.product.update({
    where: { id: req.uploadProduct.id },
    data: {
      images: [...req.uploadProduct.images, ...newUrls],
      ...(wasEmpty ? { isActive: true, activatedAt: req.uploadProduct.activatedAt ?? new Date() } : {}),
    },
  });
  res.status(201).json({ product });
}

const removeImageSchema = z.object({ url: z.string().min(1) });

export async function removeProductImage(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const { url } = removeImageSchema.parse(req.body);

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing || existing.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);
  if (!existing.images.includes(url)) throw new AppError("Esa imagen no pertenece a este producto.", 404);

  // Bloque 56: si esta era la última foto, el producto vuelve a pausarse —
  // nunca se vende sin al menos 1 foto.
  const nextImages = existing.images.filter((u) => u !== url);
  const product = await prisma.product.update({
    where: { id },
    data: { images: nextImages, ...(nextImages.length === 0 ? { isActive: false } : {}) },
  });

  // Best-effort: borra el archivo físico también, no bloquea la respuesta si falla.
  const filename = url.split("/").pop();
  unlink(join(PRODUCT_UPLOAD_DIR, vendor.slug, filename)).catch(() => {});

  res.json({ product });
}

const addImageLinkSchema = z.object({ url: z.string().url() });

// Bloque 49: alternativa a subir archivo — el vendedor pega un link externo.
// Apagable desde el admin (SiteSettings.allowProductImageLinks) porque un
// link es más difícil de moderar que un archivo que pasa por nuestro propio
// servidor. Un link que no responde NO bloquea el guardado (se agrega igual
// y se avisa con `warning`) — puede ser un CDN lento o que bloquea HEAD, y el
// vendedor es quien mejor sabe si el link es válido.
async function isUrlReachable(url) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 4000);
  try {
    let res = await fetch(url, { method: "HEAD", signal: controller.signal });
    if (!res.ok) res = await fetch(url, { method: "GET", signal: controller.signal });
    return res.ok;
  } catch {
    return false;
  } finally {
    clearTimeout(timeout);
  }
}

export async function addProductImageLink(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const { url } = addImageLinkSchema.parse(req.body);

  const settings = await prisma.siteSettings.findFirst();
  if (settings && settings.allowProductImageLinks === false) {
    throw new AppError("El administrador desactivó agregar imágenes por link. Sube un archivo en su lugar.", 403);
  }

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing || existing.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);
  if (existing.images.includes(url)) throw new AppError("Ese link ya fue agregado a este producto.", 409);

  const wasEmpty = existing.images.length === 0;
  const reachable = await isUrlReachable(url);
  const product = await prisma.product.update({
    where: { id },
    data: {
      images: [...existing.images, url],
      ...(wasEmpty ? { isActive: true, activatedAt: existing.activatedAt ?? new Date() } : {}),
    },
  });
  res.status(201).json({
    product,
    warning: reachable ? null : "No pudimos confirmar que el link cargue una imagen. Se agregó igual, pero revisa que se vea bien en la tienda.",
  });
}

const reorderImagesSchema = z.object({ images: z.array(z.string().min(1)) });

// Bloque 49: reordenar (drag & drop en VendorProducts.jsx) — la primera de
// la lista es la portada. El body debe traer exactamente el mismo conjunto
// de URLs que ya tiene el producto, solo en otro orden.
export async function reorderProductImages(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;
  const { images } = reorderImagesSchema.parse(req.body);

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing || existing.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);

  const sameSet =
    images.length === existing.images.length && [...images].sort().join("|") === [...existing.images].sort().join("|");
  if (!sameSet) throw new AppError("El nuevo orden debe contener exactamente las mismas imágenes.", 400);

  const product = await prisma.product.update({ where: { id }, data: { images } });
  res.json({ product });
}

// --- "Solicitar este producto" (Bloque 23) ----------------------------------
// Ruta pública (sin `authenticate`): un cliente logueado O anónimo puede
// pedir que le avisen cuando repongan un producto sin stock. Se decodifica el
// token a mano y sin lanzar, en vez de usar el middleware `authenticate`, que
// exige sesión y cortaría el flujo para el visitante anónimo.

function optionalUser(req) {
  const header = req.headers.authorization;
  const token = header?.startsWith("Bearer ") ? header.slice(7) : null;
  if (!token) return null;
  try {
    const payload = jwt.verify(token, env.jwtSecret);
    return { id: payload.sub, role: payload.role };
  } catch {
    return null;
  }
}

const productRequestSchema = z.object({ guestId: z.string().trim().min(1).max(120).optional() });

const PRODUCT_REQUEST_DEDUP_HOURS = 24;

export async function requestProductRestock(req, res) {
  const { id } = req.params;
  const { guestId } = productRequestSchema.parse(req.body);
  const user = optionalUser(req);
  if (!user && !guestId) throw new AppError("Falta identificar la solicitud.", 400);

  const product = await prisma.product.findUnique({ where: { id } });
  if (!product || !product.isActive) throw new AppError("Producto no encontrado.", 404);

  const since = new Date(Date.now() - PRODUCT_REQUEST_DEDUP_HOURS * 60 * 60 * 1000);
  const existing = await prisma.productRequest.findFirst({
    where: {
      productId: id,
      createdAt: { gte: since },
      ...(user ? { customerId: user.id } : { guestId }),
    },
  });
  if (existing) return res.status(200).json({ request: existing, duplicate: true });

  const request = await prisma.productRequest.create({
    data: {
      productId: id,
      vendorId: product.vendorId,
      customerId: user?.id ?? null,
      guestId: user ? null : guestId,
    },
  });
  res.status(201).json({ request, duplicate: false });
}
