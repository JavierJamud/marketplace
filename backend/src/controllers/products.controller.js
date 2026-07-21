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

const REGULAR_PLAN_PRODUCT_LIMIT = 20;

const __dirname = dirname(fileURLToPath(import.meta.url));
// A diferencia de uploads/kyc (privado), las fotos de producto son públicas
// por diseño — son parte del catálogo. Organizadas por carpeta de tienda:
// uploads/products/<slug-de-la-tienda>/<archivo>.
export const PRODUCT_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "products");

const productSchema = z.object({
  name: z.string().min(2),
  description: z.string().optional().nullable(),
  categoryId: z.string().optional(),
  price: z.number().positive(),
  oldPrice: z.number().positive().optional().nullable(),
  stock: z.number().int().min(0).default(0),
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
});

export async function getProductBySlug(req, res) {
  const { vendorSlug, productSlug } = req.params;

  const vendor = await prisma.vendor.findUnique({ where: { slug: vendorSlug } });
  if (!vendor || vendor.isBlocked) throw new AppError("Producto no encontrado.", 404);

  const product = await prisma.product.findFirst({
    where: { vendorId: vendor.id, slug: productSlug, isActive: true },
    include: {
      options: true,
      category: true,
      vendor: {
        select: {
          id: true,
          companyName: true,
          slug: true,
          isVerified: true,
          whatsapp: true,
          color: true,
          orderDestination: true,
          locations: { include: { province: true, municipality: true }, take: 1 },
        },
      },
      reviews: { where: { rating: { not: null } }, orderBy: { createdAt: "desc" }, take: 20 },
    },
  });
  if (!product) throw new AppError("Producto no encontrado.", 404);

  const ratingAgg = await prisma.review.aggregate({
    where: { productId: product.id, rating: { not: null } },
    _avg: { rating: true },
    _count: { rating: true },
  });

  const related = await prisma.product.findMany({
    where: { categoryId: product.categoryId, isActive: true, id: { not: product.id } },
    include: { vendor: { select: { companyName: true, slug: true, isVerified: true } } },
    take: 4,
  });

  // Bloque 25: mismo flag que getVendorBySlug — StoreChatWidget se monta
  // acá con product.vendor, así que necesita su propio aiAvailable en vez
  // de depender de que el cliente haya pasado antes por Store.jsx.
  const aiAvailable = product.vendor.isVerified ? await isAIAvailable() : false;

  res.json({
    product: {
      ...product,
      vendor: { ...product.vendor, aiAvailable },
      rating: ratingAgg._avg.rating ? Math.round(ratingAgg._avg.rating * 10) / 10 : null,
      reviewCount: ratingAgg._count.rating,
    },
    related,
  });
}

export async function lookupByBarcode(req, res) {
  const { barcode } = req.params;
  const product = await prisma.product.findFirst({ where: { barcode }, include: { vendor: true } });
  if (!product) throw new AppError("Producto no encontrado.", 404);
  res.json({ product });
}

// --- Panel de vendedor: CRUD de MIS productos (vendorId siempre resuelto
// desde el usuario autenticado, nunca desde el body/params del cliente) -----

export async function listMyProducts(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const products = await prisma.product.findMany({
    where: { vendorId: vendor.id },
    include: {
      category: true,
      options: true,
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
  const data = productSchema.parse(req.body);

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
  }

  let slug = slugify(data.name);
  const slugTaken = await prisma.product.findUnique({ where: { vendorId_slug: { vendorId: vendor.id, slug } } });
  if (slugTaken) slug = `${slug}-${Date.now().toString(36)}`;

  const product = await prisma.product.create({
    data: { ...data, vendorId: vendor.id, slug },
  });
  res.status(201).json({ product });
}

export async function updateProduct(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const { id } = req.params;

  const existing = await prisma.product.findUnique({ where: { id } });
  if (!existing || existing.vendorId !== vendor.id) throw new AppError("Producto no encontrado.", 404);

  const data = productSchema.partial().parse(req.body);
  if (vendor.planType === "REGULAR" && data.paymentMethods) data.paymentMethods = ["whatsapp"];
  const product = await prisma.product.update({ where: { id }, data });
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
  if (!req.files?.length) throw new AppError("Subí al menos una imagen.", 400);

  const newUrls = req.files.map((f) => `/uploads/products/${req.uploadVendorSlug}/${f.filename}`);
  const product = await prisma.product.update({
    where: { id: req.uploadProduct.id },
    data: { images: [...req.uploadProduct.images, ...newUrls] },
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

  const product = await prisma.product.update({
    where: { id },
    data: { images: existing.images.filter((u) => u !== url) },
  });

  // Best-effort: borra el archivo físico también, no bloquea la respuesta si falla.
  const filename = url.split("/").pop();
  unlink(join(PRODUCT_UPLOAD_DIR, vendor.slug, filename)).catch(() => {});

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
