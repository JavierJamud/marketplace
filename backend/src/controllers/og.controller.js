import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { renderStoreOgImage } from "../lib/ogImage.js";

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

export async function renderStoreOgImagePng(req, res) {
  const { slug } = req.params;
  const cached = imageCache.get(slug);
  let png = cached && cached.expires > Date.now() ? cached.png : null;

  if (!png) {
    const vendor = await prisma.vendor.findUnique({
      where: { slug },
      select: {
        id: true,
        companyName: true,
        logoUrl: true,
        color: true,
        verificationStatus: true,
        isBlocked: true,
        status: true,
        isPrivate: true,
        businessCategory: { select: { name: true } },
        locations: { take: 1, select: { stateOther: true, province: { select: { name: true } }, municipality: { select: { name: true } }, country: { select: { name: true } } } },
      },
    });
    if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE" || vendor.isPrivate) return res.redirect(302, `${CANONICAL_FRONTEND_URL}/og-baznova-3.png`);

    const loc = vendor.locations[0];
    const place = loc ? loc.province?.name ?? loc.stateOther ?? loc.country?.name ?? null : null;
    // El logo se pide al propio servidor: así funciona igual en desarrollo y en producción.
    const logoUrl = vendor.logoUrl ? (/^https?:\/\//.test(vendor.logoUrl) ? vendor.logoUrl : `http://127.0.0.1:${env.port}${vendor.logoUrl}`) : null;
    png = await renderStoreOgImage({
      id: vendor.id,
      companyName: vendor.companyName,
      color: vendor.color,
      logoUrl,
      category: vendor.businessCategory?.name ?? null,
      place,
      verified: vendor.verificationStatus === "VERIFIED",
    });
    if (imageCache.size >= IMAGE_CACHE_MAX) imageCache.delete(imageCache.keys().next().value);
    imageCache.set(slug, { png, expires: Date.now() + IMAGE_TTL_MS });
  }

  res.set({ "Content-Type": "image/png", "Cache-Control": "public, max-age=600" });
  res.send(png);
}
