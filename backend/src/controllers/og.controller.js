import { currencyLabel } from "../lib/catalog.js";
import { prisma } from "../lib/prisma.js";
import { resolveVendorSlug } from "../lib/vendorSlug.js";
import { env } from "../config/env.js";
import { renderStoreOgImage } from "../lib/ogImage.js";
import { publicSocialLinks } from "../lib/socialLinks.js";

// Imagen de vista previa (1200x630) de cada tienda al compartir su enlace. Las páginas para rastreadores (título, descripción,
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
    // El logo se pide al propio servidor: así funciona igual en desarrollo y en producción.
    const logoUrl = vendor.logoUrl ? (/^https?:\/\//.test(vendor.logoUrl) ? vendor.logoUrl : `http://127.0.0.1:${env.port}${vendor.logoUrl}`) : null;
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
