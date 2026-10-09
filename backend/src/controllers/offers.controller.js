import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { getOfferPolicy } from "./settings.controller.js";
import { withComputedVendorFields } from "../services/vendorVerification.service.js";
import { logActivity, actorRoleForVendorAction } from "../lib/activityLog.js";
import { assertPlanAllows } from "../lib/planConfig.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
// Igual criterio que PRODUCT_UPLOAD_DIR (products.controller.js): imágenes
// públicas. Carpeta plana (no por tienda) porque las CUSTOM no tienen una
// "carpeta dueña" natural y las PRODUCT reusan la URL que ya vive en la
// carpeta del producto — acá solo se guardan los archivos subidos para
// ofertas personalizadas.
export const OFFER_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "offers");

// Bloque 51: el default de duración y el cooldown entre publicaciones ahora
// son configurables por el admin (SiteSettings.offerCooldownDays/
// offerDefaultDurationDays, ver getOfferPolicy en settings.controller.js) en
// vez de constantes fijas acá. MIN/MAX sí se quedan hardcodeados — son el
// rango permitido para la duración CUSTOM que pide un vendedor puntual, algo
// distinto de "cuál es el default", que es lo que el admin configura.
const OFFER_MIN_DURATION_DAYS = 1;
const OFFER_MAX_DURATION_DAYS = 90;

export const offerSummarySelect = {
  id: true,
  contentType: true,
  orientation: true,
  title: true,
  description: true,
  tagline: true,
  discountLabel: true,
  imageUrl: true,
  htmlContent: true,
  buttonLabel: true,
  buttonUrl: true,
  couponCode: true,
  createdByAdmin: true,
  status: true,
  startsAt: true,
  expiresAt: true,
  createdAt: true,
  updatedAt: true,
  // vendor del producto incluido acá (no solo el de la oferta): en las
  // ofertas PRODUCT creadas por el admin, offer.vendor es null (no las creó
  // ningún vendedor) pero el producto destacado sigue siendo de alguno — el
  // Home necesita ESE slug para armar el link "/producto/:vendorSlug/:slug".
  product: {
    select: {
      id: true,
      name: true,
      slug: true,
      price: true,
      oldPrice: true,
      images: true,
      vendor: { select: { slug: true } },
    },
  },
};

// Bloque 50: sin cron aparte todavía — cualquier lectura pública o del panel
// primero "vence" en caliente las ACTIVE cuyo expiresAt ya pasó. expiresAt
// null (reservado a ofertas del admin sin fecha límite) queda afuera del
// filtro a propósito: esas no vencen solas.
async function expireStaleOffers() {
  await prisma.offer.updateMany({
    where: { status: "ACTIVE", expiresAt: { not: null, lt: new Date() } },
    data: { status: "EXPIRED" },
  });
}

// Público — Home.jsx. Nunca se muestra si no hay ninguna activa (el
// frontend decide no montar la sección en ese caso, ver Home.jsx).
// Bloque 297 (pedido explícito — "en la página principal solo se publican ofertas creadas por el
// administrador; las ofertas de las tiendas solo se ven dentro de las tiendas"): solo salen las
// ofertas del admin (createdByAdmin). Las de las tiendas viven en StoreOffer, dentro de cada tienda.
export async function listActiveOffers(_req, res) {
  await expireStaleOffers();
  const offers = await prisma.offer.findMany({
    where: { status: "ACTIVE", createdByAdmin: true },
    orderBy: { createdAt: "desc" },
    select: {
      ...offerSummarySelect,
      vendor: { select: { companyName: true, slug: true, verificationStatus: true } },
    },
  });
  // vendor es null en ofertas creadas por el admin (createdByAdmin) — el
  // helper ya maneja ese caso (no hay nada que computar sobre null).
  res.json({ offers: offers.map((o) => ({ ...o, vendor: withComputedVendorFields(o.vendor) })) });
}
