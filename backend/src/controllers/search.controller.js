import { prisma } from "../lib/prisma.js";
import { correctSearchQuery } from "../lib/ai.js";

// Bloque 52 (bug real reportado en vivo): "CAFE"/"cafe" no encontraba
// "Café" — Prisma "contains" + mode:"insensitive" compila a ILIKE de
// Postgres, que ignora mayúsculas pero NUNCA pliega acentos (compara byte a
// byte). El mismo bug ya se había diagnosticado y arreglado en el buscador
// interno del asistente de IA (Bloque 40, ver assistant.controller.js) con
// unaccent() — acá se aplica el mismo fix al buscador real (SearchBar.jsx),
// que nunca lo había tenido. IDs por raw SQL (unaccent() no es algo que
// Prisma sepa generar), el resto de los filtros (categoría/precio/ubicación)
// se aplican después con el query builder normal de Prisma sobre esos IDs.
const NAME_MATCH_LIMIT = 500;

async function findProductIdsByName(q, limit = NAME_MATCH_LIMIT) {
  const pattern = `%${q}%`;
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true AND unaccent(name) ILIKE unaccent(${pattern})
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function findProductIdsByNameOrDescription(q, limit) {
  const pattern = `%${q}%`;
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true
      AND (unaccent(name) ILIKE unaccent(${pattern}) OR unaccent(description) ILIKE unaccent(${pattern}))
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function findProductIdsByTag(q, limit) {
  const pattern = `%${q}%`;
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true AND EXISTS (
      SELECT 1 FROM unnest(tags) AS t WHERE unaccent(t) ILIKE unaccent(${pattern})
    )
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function findVendorIdsByCompanyName(q, limit) {
  const pattern = `%${q}%`;
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Vendor"
    WHERE "isBlocked" = false AND unaccent("companyName") ILIKE unaccent(${pattern})
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

// Bloque 52: ÚLTIMO recurso — "resultados más cercanos a lo que el cliente
// buscó sin importar cómo lo escribió" (pedido explícito), para el caso de
// un typo real (no solo tilde/mayúscula, que unaccent()+ILIKE de arriba ya
// resuelve). pg_trgm (extensión habilitada en la migración
// 20260727020000) mide similitud entre trigramas de caracteres — tolera
// una letra de más/menos/cambiada sin que el cliente escriba el nombre
// exacto. Umbral bajo (0.15) a propósito: mejor mostrar algo aproximado que
// nada, el cliente decide si le sirve.
const TRIGRAM_THRESHOLD = 0.15;

async function findProductIdsByTrigram(q, limit) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true AND similarity(unaccent(name), unaccent(${q})) > ${TRIGRAM_THRESHOLD}
    ORDER BY similarity(unaccent(name), unaccent(${q})) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function findVendorIdsByTrigram(q, limit) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Vendor"
    WHERE "isBlocked" = false AND similarity(unaccent("companyName"), unaccent(${q})) > ${TRIGRAM_THRESHOLD}
    ORDER BY similarity(unaccent("companyName"), unaccent(${q})) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

// findMany({ where: { id: { in: ids } } }) NO conserva el orden de ids — hace
// falta reordenar a mano para que el ranking de similarity()/relevancia
// sobreviva al fetch completo (con includes) vía Prisma normal.
function reorderByIds(rows, ids) {
  const order = new Map(ids.map((id, i) => [id, i]));
  return [...rows].sort((a, b) => order.get(a.id) - order.get(b.id));
}

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

  // Todo lo que NO es el texto libre de búsqueda — se reusa igual en los 3
  // intentos (literal → corregido por IA → aproximado por trigramas), el id
  // filter se agrega aparte en cada intento.
  const baseWhere = {
    isActive: true,
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
  const includeOpts = {
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
    // Bloque 49: ProductCard.jsx muestra el rubro como chip — antes no
    // viajaba en esta consulta (solo el vendedor).
    category: { select: { name: true } },
  };

  async function fetchByIds(ids) {
    if (ids.length === 0) return [];
    return prisma.product.findMany({ where: { ...baseWhere, id: { in: ids } }, include: includeOpts, take: 60 });
  }

  let products;
  const cleanQ = q ? String(q).trim() : "";
  if (!cleanQ) {
    products = await prisma.product.findMany({ where: baseWhere, include: includeOpts, take: 60, orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }] });
  } else {
    // Intento 1: literal, sin importar mayúsculas/tildes.
    products = await fetchByIds(await findProductIdsByName(cleanQ));

    // Intento 2: si no hubo nada Y hay un proveedor de IA activo, le
    // pedimos que interprete/corrija el término (probable typo) y
    // reintentamos la búsqueda literal con esa corrección.
    if (products.length === 0) {
      const corrected = await correctSearchQuery(cleanQ);
      if (corrected && corrected.trim().toLowerCase() !== cleanQ.toLowerCase()) {
        products = await fetchByIds(await findProductIdsByName(corrected));
      }
    }

    // Intento 3: sin IA disponible o sin resultado igual — última red de
    // contención, resultados aproximados por similitud de trigramas
    // directo contra la base, sin importar cómo lo escribió el cliente.
    if (products.length === 0) {
      const fuzzyIds = await findProductIdsByTrigram(cleanQ, 60);
      if (fuzzyIds.length) {
        const fuzzyProducts = await prisma.product.findMany({ where: { ...baseWhere, id: { in: fuzzyIds } }, include: includeOpts });
        products = reorderByIds(fuzzyProducts, fuzzyIds);
      }
    }
  }

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
  const vendorWhere = { isBlocked: false, ...(onlyVerified ? { isVerified: true } : {}) };

  // Bloque 52: unaccent() de los dos lados (antes Prisma "contains" +
  // mode:"insensitive", que ignora mayúsculas pero nunca tildes — mismo bug
  // que structuredSearch de arriba, mismo fix). Este es el dropdown en vivo
  // (280ms de debounce en SearchBar.jsx) — sin llamada a IA acá a propósito,
  // tiene que sentirse instantáneo mientras el cliente todavía está
  // escribiendo; la corrección con IA queda para /search (Enter/resultados).
  const nameOrDescIds = await findProductIdsByNameOrDescription(q, 40);
  const nameOrDescMatches = nameOrDescIds.length
    ? await prisma.product.findMany({ where: { id: { in: nameOrDescIds }, vendor: vendorWhere }, include: { vendor: { select: vendorSelect } } })
    : [];

  const tagIds = await findProductIdsByTag(q, 40);
  const alreadyHaveIds = new Set(nameOrDescMatches.map((p) => p.id));
  const tagOnlyIds = tagIds.filter((id) => !alreadyHaveIds.has(id));
  const tagOnlyMatches = tagOnlyIds.length
    ? await prisma.product.findMany({ where: { id: { in: tagOnlyIds }, vendor: vendorWhere }, include: { vendor: { select: vendorSelect } } })
    : [];

  let candidates = [...nameOrDescMatches, ...tagOnlyMatches].filter((p) => !p.vendor.isBlocked);

  // Fallback de trigramas — mismo criterio que structuredSearch: si ni
  // siquiera unaccent()+ILIKE encontró nada (probable typo), mostrar lo más
  // parecido directo de la base en vez de un dropdown vacío.
  let fuzzy = false;
  if (candidates.length === 0) {
    const fuzzyIds = await findProductIdsByTrigram(q, 40);
    if (fuzzyIds.length) {
      const fuzzyProducts = await prisma.product.findMany({ where: { id: { in: fuzzyIds }, vendor: vendorWhere }, include: { vendor: { select: vendorSelect } } });
      candidates = reorderByIds(fuzzyProducts.filter((p) => !p.vendor.isBlocked), fuzzyIds);
      fuzzy = true;
    }
  }

  // El ranking por tier de calidad de match (matchTier) solo tiene sentido
  // sobre coincidencias literales — los resultados de trigramas ya vienen
  // ordenados por similitud real, reordenarlos por tier de substring los
  // arruinaría (casi ninguno va a "incluir" literalmente lo que escribió el
  // cliente, es justo por eso que llegaron por este camino).
  const ranked = fuzzy
    ? candidates
    : candidates
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

  const vendorIds = await findVendorIdsByCompanyName(q, 20);
  let vendorMatches = vendorIds.length
    ? await prisma.vendor.findMany({ where: { ...vendorWhere, id: { in: vendorIds } }, select: { id: true, companyName: true, slug: true, isVerified: true, color: true }, take: 20 })
    : [];
  let vendors;
  if (vendorMatches.length > 0) {
    vendors = vendorMatches.sort((a, b) => vendorMatchTier(a, lowerQ) - vendorMatchTier(b, lowerQ)).slice(0, AUTOCOMPLETE_VENDOR_LIMIT);
  } else {
    const fuzzyVendorIds = await findVendorIdsByTrigram(q, 20);
    const fuzzyVendors = fuzzyVendorIds.length
      ? await prisma.vendor.findMany({ where: { ...vendorWhere, id: { in: fuzzyVendorIds } }, select: { id: true, companyName: true, slug: true, isVerified: true, color: true } })
      : [];
    vendors = reorderByIds(fuzzyVendors, fuzzyVendorIds).slice(0, AUTOCOMPLETE_VENDOR_LIMIT);
  }

  res.json({ products, vendors, hasMore: ranked.length > AUTOCOMPLETE_LIMIT });
}
