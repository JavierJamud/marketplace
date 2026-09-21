import { prisma } from "../lib/prisma.js";
import { correctSearchQuery } from "../lib/ai.js";
import { productPriceTiersInclude, expireNewBadges, attachBestSellerFlag } from "./products.controller.js";
import { withComputedVendorFields, withComputedVendorFieldsList } from "../services/vendorVerification.service.js";
import { rankFeaturedProducts } from "../lib/productRanking.js";

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

// Bloque 58 (pedido explícito): además de mayúsculas/tildes, un signo de
// puntuación en un lado y no en el otro rompía el match — "Ron Santiago
// 750ml" no encontraba "Ron Santiago, 750ml" (la coma no está en la
// búsqueda) ni al revés. `regexp_replace(..., '[^a-z0-9]+', ' ', 'g')`
// pliega TODO signo/espacio no alfanumérico a un solo espacio de los dos
// lados de la comparación (columna Y término de búsqueda), así que
// puntuación, comas, puntos y espacios de más dejan de importar — solo se
// comparan letras y números reales. Se aplica siempre DESPUÉS de
// unaccent()+lower(), nunca antes (el orden importa: unaccent ya resolvió
// tildes/mayúsculas, esto solo pule lo que queda).
async function findProductIdsByName(q, limit = NAME_MATCH_LIMIT) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true AND "hiddenFromStore" = false
      AND regexp_replace(unaccent(lower(name)), '[^a-z0-9]+', ' ', 'g')
          ILIKE '%' || regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g') || '%'
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function findProductIdsByNameOrDescription(q, limit) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true AND "hiddenFromStore" = false
      AND (
        regexp_replace(unaccent(lower(name)), '[^a-z0-9]+', ' ', 'g')
          ILIKE '%' || regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g') || '%'
        OR regexp_replace(unaccent(lower(description)), '[^a-z0-9]+', ' ', 'g')
          ILIKE '%' || regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g') || '%'
      )
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function findProductIdsByTag(q, limit) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true AND "hiddenFromStore" = false AND EXISTS (
      SELECT 1 FROM unnest(tags) AS t
      WHERE regexp_replace(unaccent(lower(t)), '[^a-z0-9]+', ' ', 'g')
            ILIKE '%' || regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g') || '%'
    )
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function findVendorIdsByCompanyName(q, limit) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Vendor"
    WHERE "isBlocked" = false AND "status" = 'ACTIVE' AND "isPrivate" = false
      AND regexp_replace(unaccent(lower("companyName")), '[^a-z0-9]+', ' ', 'g')
          ILIKE '%' || regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g') || '%'
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

// Bloque 58: misma normalización de puntuación que las búsquedas literales
// de arriba, para que una coma/punto de más o de menos no le baje la
// similitud a un match que en el fondo es el mismo texto.
async function findProductIdsByTrigram(q, limit) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true
      AND similarity(regexp_replace(unaccent(lower(name)), '[^a-z0-9]+', ' ', 'g'), regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g')) > ${TRIGRAM_THRESHOLD}
    ORDER BY similarity(regexp_replace(unaccent(lower(name)), '[^a-z0-9]+', ' ', 'g'), regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g')) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function findVendorIdsByTrigram(q, limit) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Vendor"
    WHERE "isBlocked" = false AND "status" = 'ACTIVE' AND "isPrivate" = false
      AND similarity(regexp_replace(unaccent(lower("companyName")), '[^a-z0-9]+', ' ', 'g'), regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g')) > ${TRIGRAM_THRESHOLD}
    ORDER BY similarity(regexp_replace(unaccent(lower("companyName")), '[^a-z0-9]+', ' ', 'g'), regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g')) DESC
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
  await expireNewBadges();

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
    // Bloque 157: "solo para pedido de mesa" — nunca aparece en Home ni en
    // el catálogo, sin importar qué tan bien rankee.
    hiddenFromStore: false,
    categoryId: categoryIds ? { in: categoryIds } : undefined,
    price: minPrice || maxPrice ? { gte: minPrice ? Number(minPrice) : undefined, lte: maxPrice ? Number(maxPrice) : undefined } : undefined,
    paymentMethods: paymentMethods?.length ? { hasSome: paymentMethods } : undefined,
    // Bloque 82 (pedido explícito, bug real reportado en vivo): un producto
    // agotado (sin `unlimitedStock`, `stock` 0) no debe aparecer en Home ni
    // en el catálogo — solo se muestra en su propia tienda, en la sección
    // "Próximamente disponibles" (Store.jsx, Bloque 23, que consulta
    // getVendorBySlug directo, sin pasar por acá — a propósito no se toca).
    OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }],
    vendor: {
      isBlocked: false,
      status: "ACTIVE",
      isPrivate: false,
      verificationStatus: onlyVerified === "true" ? "VERIFIED" : undefined,
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
        verificationStatus: true,
        isBlocked: true,
        color: true,
        whatsapp: true,
        locations: { include: { province: true, municipality: true }, take: 1 },
      },
    },
    // Bloque 49: ProductCard.jsx muestra el rubro como chip — antes no
    // viajaba en esta consulta (solo el vendedor).
    category: { select: { name: true } },
    ...productPriceTiersInclude,
  };

  async function fetchByIds(ids) {
    if (ids.length === 0) return [];
    return prisma.product.findMany({ where: { ...baseWhere, id: { in: ids } }, include: includeOpts, take: 60 });
  }

  let products;
  const cleanQ = q ? String(q).trim() : "";
  if (!cleanQ) {
    // Bloque 98: el pool candidato sube de 60 a 300 — el orden real ya no lo
    // decide este orderBy (queda solo como criterio de qué candidatos
    // entran cuando hay más de 300 que calzan el filtro), lo decide
    // rankFeaturedProducts más abajo con el catálogo completo disponible.
    products = await prisma.product.findMany({ where: baseWhere, include: includeOpts, take: 300, orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }] });
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
  // Bloque 98 (pedido explícito): "relevancia" (default, y lo que alimenta
  // "Destacados" de la Home cuando no hay texto de búsqueda) deja de ser
  // solo "tiendas verificadas primero" — ahora es el score compuesto real
  // de lib/productRanking.js (ventas confirmadas, clics, clics desde
  // búsqueda, tiempo promedio en la página, completitud del contenido y
  // calificación, con piso de calidad — nunca promueve algo de mala
  // calidad, más estricto todavía si la tienda no está verificada). Se
  // recorta a 60 DESPUÉS de rankear, no antes — con el pool de 300 de
  // arriba, un producto viejo con buen desempeño real no queda afuera solo
  // por no ser de los 60 más recientes.
  if (!sort || sort === "relevance") {
    const reviewAgg = await prisma.review.groupBy({
      by: ["productId"],
      where: { productId: { in: products.map((p) => p.id) }, rating: { not: null } },
      _avg: { rating: true },
      _count: { rating: true },
    });
    const reviewStatsByProductId = new Map(
      reviewAgg.map((a) => [a.productId, { avgRating: a._avg.rating ?? 0, reviewCount: a._count.rating }])
    );
    products = rankFeaturedProducts(products, reviewStatsByProductId).slice(0, 60);
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

  const withBestSeller = await attachBestSellerFlag(products);
  res.json({ products: withBestSeller.map((p) => ({ ...p, vendor: withComputedVendorFields(p.vendor) })), nearbyProvinces });
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

  const vendorSelect = { companyName: true, slug: true, verificationStatus: true };
  // Bloque 64: products:{some} es la regla de visibilidad (independiente de
  // verificationStatus) — sin productos publicados, ni la tienda ni sus
  // productos aparecen acá.
  const vendorWhere = {
    isBlocked: false,
    status: "ACTIVE",
    isPrivate: false,
    products: { some: { isActive: true, hiddenFromStore: false } },
    ...(onlyVerified ? { verificationStatus: "VERIFIED" } : {}),
  };

  // Bloque 52: unaccent() de los dos lados (antes Prisma "contains" +
  // mode:"insensitive", que ignora mayúsculas pero nunca tildes — mismo bug
  // que structuredSearch de arriba, mismo fix). Este es el dropdown en vivo
  // (280ms de debounce en SearchBar.jsx) — sin llamada a IA acá a propósito,
  // tiene que sentirse instantáneo mientras el cliente todavía está
  // escribiendo; la corrección con IA queda para /search (Enter/resultados).
  // Bloque 82: mismo criterio que structuredSearch — un producto agotado no
  // debe aparecer en el dropdown de búsqueda en vivo (solo en su tienda, ver
  // "Próximamente disponibles").
  const inStockWhere = { OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }] };

  const nameOrDescIds = await findProductIdsByNameOrDescription(q, 40);
  const nameOrDescMatches = nameOrDescIds.length
    ? await prisma.product.findMany({ where: { id: { in: nameOrDescIds }, vendor: vendorWhere, ...inStockWhere }, include: { vendor: { select: vendorSelect } } })
    : [];

  const tagIds = await findProductIdsByTag(q, 40);
  const alreadyHaveIds = new Set(nameOrDescMatches.map((p) => p.id));
  const tagOnlyIds = tagIds.filter((id) => !alreadyHaveIds.has(id));
  const tagOnlyMatches = tagOnlyIds.length
    ? await prisma.product.findMany({ where: { id: { in: tagOnlyIds }, vendor: vendorWhere, ...inStockWhere }, include: { vendor: { select: vendorSelect } } })
    : [];

  let candidates = [...nameOrDescMatches, ...tagOnlyMatches].filter((p) => !p.vendor.isBlocked);

  // Fallback de trigramas — mismo criterio que structuredSearch: si ni
  // siquiera unaccent()+ILIKE encontró nada (probable typo), mostrar lo más
  // parecido directo de la base en vez de un dropdown vacío.
  let fuzzy = false;
  if (candidates.length === 0) {
    const fuzzyIds = await findProductIdsByTrigram(q, 40);
    if (fuzzyIds.length) {
      const fuzzyProducts = await prisma.product.findMany({ where: { id: { in: fuzzyIds }, vendor: vendorWhere, ...inStockWhere }, include: { vendor: { select: vendorSelect } } });
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
        .map((p) => ({ p, tier: matchTier(p, lowerQ), featured: p.isFeatured || p.vendor.verificationStatus === "VERIFIED" }))
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
    ? await prisma.vendor.findMany({ where: { ...vendorWhere, id: { in: vendorIds } }, select: { id: true, companyName: true, slug: true, verificationStatus: true, color: true }, take: 20 })
    : [];
  let vendors;
  if (vendorMatches.length > 0) {
    vendors = vendorMatches.sort((a, b) => vendorMatchTier(a, lowerQ) - vendorMatchTier(b, lowerQ)).slice(0, AUTOCOMPLETE_VENDOR_LIMIT);
  } else {
    const fuzzyVendorIds = await findVendorIdsByTrigram(q, 20);
    const fuzzyVendors = fuzzyVendorIds.length
      ? await prisma.vendor.findMany({ where: { ...vendorWhere, id: { in: fuzzyVendorIds } }, select: { id: true, companyName: true, slug: true, verificationStatus: true, color: true } })
      : [];
    vendors = reorderByIds(fuzzyVendors, fuzzyVendorIds).slice(0, AUTOCOMPLETE_VENDOR_LIMIT);
  }

  res.json({ products, vendors: withComputedVendorFieldsList(vendors), hasMore: ranked.length > AUTOCOMPLETE_LIMIT });
}
