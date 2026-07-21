import { prisma } from "../lib/prisma.js";

// Búsqueda estructurada (pills de categoría, selector de provincia/municipio,
// sidebar de filtros de Shop, buscador de texto): la que consume el catálogo
// y la Home.
export async function structuredSearch(req, res) {
  const { q, categoryId, provinceId, municipalityId, minPrice, maxPrice, sort, onlyVerified, payment } = req.query;

  // Filtrar por categoría incluye sus subcategorías (ej. "Restaurantes" trae
  // también los productos cargados bajo "Platos fuertes"/"Entrantes"/etc.):
  // si no, filtrar por una categoría padre devuelve 0 resultados aunque haya
  // productos reales cargados en sus hijas.
  let categoryIds;
  if (categoryId) {
    const children = await prisma.category.findMany({ where: { parentId: String(categoryId) }, select: { id: true } });
    categoryIds = [String(categoryId), ...children.map((c) => c.id)];
  }

  const paymentMethods = payment ? String(payment).split(",").filter(Boolean) : undefined;

  const where = {
    isActive: true,
    name: q ? { contains: String(q), mode: "insensitive" } : undefined,
    categoryId: categoryIds ? { in: categoryIds } : undefined,
    price: minPrice || maxPrice ? { gte: minPrice ? Number(minPrice) : undefined, lte: maxPrice ? Number(maxPrice) : undefined } : undefined,
    paymentMethods: paymentMethods?.length ? { hasSome: paymentMethods } : undefined,
    vendor: {
      isBlocked: false,
      isVerified: onlyVerified === "true" ? true : undefined,
      locations: provinceId
        ? { some: { provinceId: String(provinceId), municipalityId: municipalityId ? String(municipalityId) : undefined } }
        : undefined,
    },
  };

  let products = await prisma.product.findMany({
    where,
    include: {
      vendor: {
        select: {
          companyName: true,
          slug: true,
          isVerified: true,
          isBlocked: true,
          color: true,
          whatsapp: true,
          locations: { include: { province: true, municipality: true }, take: 1 },
        },
      },
    },
    take: 60,
    orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
  });

  if (sort === "price-asc") products = [...products].sort((a, b) => Number(a.price) - Number(b.price));
  if (sort === "price-desc") products = [...products].sort((a, b) => Number(b.price) - Number(a.price));
  if (sort === "rating") {
    const agg = await prisma.review.groupBy({
      by: ["productId"],
      where: { productId: { in: products.map((p) => p.id) }, rating: { not: null } },
      _avg: { rating: true },
    });
    const ratingByProduct = Object.fromEntries(agg.map((a) => [a.productId, a._avg.rating ?? 0]));
    products = [...products].sort((a, b) => (ratingByProduct[b.id] ?? 0) - (ratingByProduct[a.id] ?? 0));
  }
  // Relevancia (default): tiendas verificadas primero, luego lo ya ordenado arriba.
  if (!sort || sort === "relevance") {
    products = [...products].sort((a, b) => (b.vendor.isVerified ? 1 : 0) - (a.vendor.isVerified ? 1 : 0));
  }

  // Si no hay resultados en la provincia elegida, sugerí provincias vecinas
  // (tabla ProvinceAdjacency real, no hardcodeado) en vez de dejar la
  // pantalla vacía sin explicación.
  let nearbyProvinces = [];
  if (products.length === 0 && provinceId) {
    const adjacencies = await prisma.provinceAdjacency.findMany({
      where: { provinceAId: String(provinceId) },
      include: { provinceB: { select: { id: true, name: true } } },
    });
    nearbyProvinces = adjacencies.map((a) => a.provinceB);
  }

  res.json({ products, nearbyProvinces });
}

// --- Bloque 22: autocompletado en vivo -------------------------------------
// Endpoint aparte de structuredSearch de arriba (no una variante): acá hace
// falta rankear por CALIDAD de coincidencia (nombre exacto > tag > descripción),
// no solo filtrar, y buscar contra tags — cosa que la Postgres no puede
// hacer con un simple .contains() de Prisma sobre un String[] (eso solo
// matchea un elemento EXACTO del array, no una subcadena dentro de un
// elemento), así que ese pedazo usa una query SQL cruda (parametrizada por
// el template tag de Prisma — sin riesgo de inyección).
const AUTOCOMPLETE_LIMIT = 8;
const AUTOCOMPLETE_MIN_CHARS = 2;

function matchTier(product, lowerQ) {
  const name = product.name.toLowerCase();
  if (name === lowerQ) return 0;
  if (name.includes(lowerQ)) return 1;
  if (product.tags?.some((t) => t.includes(lowerQ))) return 2;
  return 3; // solo matchea por descripción
}

// Bloque 30: coincidencias por NOMBRE DE TIENDA — dropdown separado del de
// productos (forma distinta: sin precio/imagen de producto, va a /tienda/:slug
// en vez de /producto/...). Mismo ranking simple que matchTier pero sobre
// companyName (no hay tags/descripción de tienda que buscar acá).
function vendorMatchTier(vendor, lowerQ) {
  const name = vendor.companyName.toLowerCase();
  if (name === lowerQ) return 0;
  if (name.startsWith(lowerQ)) return 1;
  return 2;
}

const AUTOCOMPLETE_VENDOR_LIMIT = 4;

export async function autocompleteSearch(req, res) {
  const q = String(req.query.q ?? "").trim();
  const onlyVerified = req.query.onlyVerified === "true";
  if (q.length < AUTOCOMPLETE_MIN_CHARS) return res.json({ products: [], vendors: [], hasMore: false });
  const lowerQ = q.toLowerCase();

  const vendorSelect = { companyName: true, slug: true, isVerified: true };
  // Bloque 30: onlyVerified filtra qué TIENDAS pueden aparecer (ni sus
  // productos ni la tienda misma) — antes isVerified solo desempataba
  // orden, nunca excluía nada.
  const vendorWhere = { isBlocked: false, ...(onlyVerified ? { isVerified: true } : {}) };

  const nameOrDescMatches = await prisma.product.findMany({
    where: {
      isActive: true,
      vendor: vendorWhere,
      OR: [{ name: { contains: q, mode: "insensitive" } }, { description: { contains: q, mode: "insensitive" } }],
    },
    include: { vendor: { select: vendorSelect } },
    take: 40,
  });

  const tagMatchRows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true AND EXISTS (
      SELECT 1 FROM unnest(tags) AS t WHERE t ILIKE ${`%${lowerQ}%`}
    )
    LIMIT 40
  `;
  const alreadyHaveIds = new Set(nameOrDescMatches.map((p) => p.id));
  const tagOnlyIds = tagMatchRows.map((r) => r.id).filter((id) => !alreadyHaveIds.has(id));
  const tagOnlyMatches = tagOnlyIds.length
    ? await prisma.product.findMany({ where: { id: { in: tagOnlyIds }, vendor: vendorWhere }, include: { vendor: { select: vendorSelect } } })
    : [];

  const candidates = [...nameOrDescMatches, ...tagOnlyMatches].filter((p) => !p.vendor.isBlocked);

  // "Destacados aparecen primero, siempre" (Bloque 22) se interpreta como
  // desempate DENTRO de cada nivel de calidad de match, no por encima de él
  // — si no, un producto destacado pero irrelevante ganaría a una
  // coincidencia exacta de nombre, que es justo lo que la búsqueda no
  // debería hacer. isFeatured es el mismo flag "destacado" que ya usa
  // structuredSearch arriba; isVerified de la tienda es el fallback (mismo
  // criterio que el resto del sitio) cuando el producto no está marcado.
  const ranked = candidates
    .map((p) => ({ p, tier: matchTier(p, lowerQ), featured: p.isFeatured || p.vendor.isVerified }))
    .sort((a, b) => a.tier - b.tier || Number(b.featured) - Number(a.featured))
    .map((x) => x.p);

  const products = ranked.slice(0, AUTOCOMPLETE_LIMIT).map((p) => ({
    id: p.id,
    name: p.name,
    slug: p.slug,
    price: p.price,
    image: p.images?.[0] ?? null,
    vendor: { companyName: p.vendor.companyName, slug: p.vendor.slug },
  }));

  const vendorMatches = await prisma.vendor.findMany({
    where: { ...vendorWhere, companyName: { contains: q, mode: "insensitive" } },
    select: { id: true, companyName: true, slug: true, isVerified: true, color: true },
    take: 20,
  });
  const vendors = vendorMatches
    .sort((a, b) => vendorMatchTier(a, lowerQ) - vendorMatchTier(b, lowerQ))
    .slice(0, AUTOCOMPLETE_VENDOR_LIMIT);

  res.json({ products, vendors, hasMore: ranked.length > AUTOCOMPLETE_LIMIT });
}
