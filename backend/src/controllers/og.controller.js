import { currencyLabel } from "../lib/catalog.js";
import { prisma } from "../lib/prisma.js";
import { resolveVendorSlug } from "../lib/vendorSlug.js";
import { env } from "../config/env.js";
import { renderStoreOgImage, renderProductOgImage } from "../lib/ogImage.js";
import { effectiveShipping } from "../lib/shipping.js";
import { publicSocialLinks } from "../lib/socialLinks.js";
import { brandingLogoDiskPath, productImageDiskPath } from "../lib/uploadFiles.js";

// Imagen de vista previa (1200x630) de cada tienda y de cada producto al compartir su enlace. Las páginas para rastreadores (título, descripción,
// datos estructurados) viven en seoPages.controller.js.

function absoluteUrl(path) {
  if (!path) return null;
  return /^https?:\/\//.test(path) ? path : `${env.backendUrl}${path}`;
}

// env.frontendUrl puede traer varios orígenes separados por coma; para armar un enlace real se toma el primero.
const CANONICAL_FRONTEND_URL = env.frontendUrl.split(",")[0].trim();

// Las imágenes se arman con sharp (algo de CPU), así que se guardan unos minutos en memoria por tienda.
const IMAGE_TTL_MS = 10 * 60 * 1000;
const IMAGE_CACHE_MAX = 200;
const imageCache = new Map();

// Envío de toda la tienda para la franja (igual que la cabecera): solo si la tienda tiene envío propio.
function storeShippingText(v) {
  const money = (n) => `${Number(n).toLocaleString("es-CU")} ${currencyLabel(v.storeShippingCurrency)}`;
  if (v.storeShippingMode === "COORDINATE") return "Envío a coordinar";
  if (v.storeShippingMode !== "FIXED") return null;
  const local = Number(v.storeShippingLocal);
  const other = Number(v.storeShippingOther);
  return local === other ? `Envío ${money(local)} por pedido` : `Envío desde ${money(Math.min(local, other))} por pedido`;
}

export async function renderStoreOgImagePng(req, res) {
  const slug = await resolveVendorSlug(req.params.slug);
  const cached = imageCache.get(slug);
  let png = cached && cached.expires > Date.now() ? cached.png : null;

  if (!png) {
    const vendor = await prisma.vendor.findUnique({
      where: { slug },
      include: {
        businessCategory: { select: { name: true, slug: true, icon: true } },
        locations: { include: { province: { select: { name: true } }, municipality: { select: { name: true } }, country: { select: { name: true } } } },
        _count: { select: { products: { where: { isActive: true, hiddenFromStore: false, overQuota: false } } } },
      },
    });
    if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE" || vendor.isPrivate) return res.redirect(302, `${CANONICAL_FRONTEND_URL}/og-baznova-3.png`);

    // Misma ubicación que la cabecera de la tienda: municipio y provincia de su primera ubicación.
    const loc = vendor.locations[0];
    const place = loc ? [loc.municipality?.name, loc.province?.name ?? loc.stateOther ?? loc.country?.name].filter(Boolean).join(", ") || null : null;
    // Solo el logo subido a /uploads/vendor-branding, leído del disco. La ruta es pública y logoUrl lo escribe la tienda:
    // el servidor nunca descarga una dirección elegida por ella (auditoría run-2). Un logo externo deja la imagen sin logo.
    const logoUrl = brandingLogoDiskPath(vendor.logoUrl);
    png = await renderStoreOgImage({
      id: vendor.id,
      companyName: vendor.companyName,
      color: vendor.color,
      logoUrl,
      category: vendor.businessCategory?.name ?? null,
      categorySlug: vendor.businessCategory?.slug ?? null,
      categoryIcon: vendor.businessCategory?.icon ?? null,
      isRestaurant: vendor.isRestaurant,
      place,
      verified: vendor.verificationStatus === "VERIFIED",
      description: vendor.description,
      socialLinks: publicSocialLinks(vendor.socialLinks),
      rating: Number(vendor.rating),
      reviewCount: vendor.reviewCount,
      productCount: vendor._count.products,
      year: new Date(vendor.createdAt).getFullYear(),
      shippingText: storeShippingText(vendor),
      payments: vendor.acceptedPaymentMethods ?? [],
    });
    if (imageCache.size >= IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(slug, { png, expires: Date.now() + IMAGE_TTL_MS });
  }

  res.set({ "Content-Type": "image/png", "Cache-Control": "public, max-age=600" });
  res.send(png);
}

const money = (n, cur) => `${Number(n).toLocaleString("es-CU")} ${currencyLabel(cur)}`;
const productImageCache = new Map();
const SITE_HOST = (() => {
  try {
    return new URL(CANONICAL_FRONTEND_URL).host.replace(/^www./, "");
  } catch {
    return "baznova.com";
  }
})();

// Mismo texto corto que la tarjeta y la ficha (frontend lib/shipping.js shippingLabel), ya con la regla de la tienda.
function productShippingText(product, vendor) {
  const s = effectiveShipping(product, vendor);
  if (s.mode === "COORDINATE") return "Envío a coordinar";
  if (s.mode === "FIXED") return s.local === s.other ? `Envío ${money(s.local, s.currency)}` : `Envío desde ${money(Math.min(s.local, s.other), s.currency)}`;
  return "Envío gratis";
}

export async function renderProductOgImageJpg(req, res) {
  const vendorSlug = await resolveVendorSlug(req.params.vendorSlug);
  const key = `${vendorSlug}/${req.params.productSlug}`;
  const cached = productImageCache.get(key);
  let jpg = cached && cached.expires > Date.now() ? cached.jpg : null;

  if (!jpg) {
    // Mismas reglas que la página del producto (seoPages.controller.js): solo lo que se ve en el sitio.
    const product = await prisma.product.findFirst({
      where: {
        slug: req.params.productSlug,
        isActive: true,
        hiddenFromStore: false,
        overQuota: false,
        vendor: { slug: vendorSlug, isBlocked: false, status: "ACTIVE", isPrivate: false },
      },
      include: {
        category: { select: { name: true } },
        vendor: {
          include: {
            businessCategory: { select: { name: true, slug: true } },
            locations: { take: 1, include: { province: { select: { name: true } }, municipality: { select: { name: true } } } },
          },
        },
      },
    });
    if (!product) return res.redirect(302, `${CANONICAL_FRONTEND_URL}/og-baznova-3.png`);

    const v = product.vendor;
    const loc = v.locations[0];
    const place = loc ? [loc.municipality?.name, loc.province?.name ?? loc.stateOther].filter(Boolean).join(", ") || null : null;
    const sizeTotal = product.sizeStock && typeof product.sizeStock === "object" ? Object.values(product.sizeStock).reduce((a, n) => a + Number(n || 0), 0) : 0;
    const price = Number(product.price);
    const old = product.oldPrice ? Number(product.oldPrice) : null;
    const hasDiscount = old && old > price;
    jpg = await renderProductOgImage({
      name: product.name,
      description: product.description,
      priceText: money(price, product.currency),
      oldPriceText: hasDiscount ? money(old, product.currency) : null,
      discount: hasDiscount ? Math.round((1 - price / old) * 100) : 0,
      inStock: product.unlimitedStock || product.stock > 0 || sizeTotal > 0,
      rating: Number(product.rating),
      reviewCount: product.reviewCount,
      shippingText: productShippingText(product, v),
      place,
      category: product.category?.name ?? null,
      // Solo la foto subida al servidor, leída del disco: una dirección externa nunca se descarga.
      photoPath: productImageDiskPath(product.images?.[0]),
      siteHost: SITE_HOST,
      store: {
        id: v.id,
        companyName: v.companyName,
        color: v.color,
        logoPath: brandingLogoDiskPath(v.logoUrl),
        verified: v.verificationStatus === "VERIFIED",
        isRestaurant: v.isRestaurant,
        category: v.businessCategory?.name ?? null,
        categorySlug: v.businessCategory?.slug ?? null,
      },
    });
    if (productImageCache.size >= IMAGE_CACHE_MAX) productImageCache.delete(productImageCache.keys().next().value);
    productImageCache.set(key, { jpg, expires: Date.now() + IMAGE_TTL_MS });
  }

  res.set({ "Content-Type": "image/jpeg", "Cache-Control": "public, max-age=600" });
  res.send(jpg);
}
