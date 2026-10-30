import { allCodes } from "../lib/catalog.js";
import { prisma } from "../lib/prisma.js";
import { VENDOR_SHIPPING_SELECT } from "../lib/shippingSelect.js";
import { correctSearchQuery } from "../lib/ai.js";
import { productPriceTiersInclude, expireNewBadges, attachBestSellerFlag } from "./products.controller.js";
import { withComputedVendorFields, withComputedVendorFieldsList } from "../services/vendorVerification.service.js";
import { rankFeaturedProducts, rotationSeed, planFeaturedChecker } from "../lib/productRanking.js";
import { fetchRankingPool, loadRankingSignals } from "../services/productRankingSignals.service.js";
import { getAllPlanConfigs } from "../lib/planConfig.js";
import { recordSearchTerm, getTrendingSearches, getTrendingSearchesForZone } from "../lib/trendingSearches.js";
import { vendorZoneWhere } from "../lib/vendorZone.js";
import { ratingScore } from "../lib/ratings.js";

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
export async function findProductIdsByName(q, limit = NAME_MATCH_LIMIT) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true AND "hiddenFromStore" = false AND "overQuota" = false
      AND regexp_replace(unaccent(lower(name)), '[^a-z0-9]+', ' ', 'g')
          ILIKE '%' || regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g') || '%'
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function findProductIdsByNameOrDescription(q, limit) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true AND "hiddenFromStore" = false AND "overQuota" = false
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
    WHERE "isActive" = true AND "hiddenFromStore" = false AND "overQuota" = false AND EXISTS (
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
// exacto. Se usa word_similarity (la palabra escrita contra la palabra más parecida del nombre) y
// un umbral de 0.55: "zapatilas" encuentra "Zapatillas" y "audifonoz" encuentra "Audífonos", pero
// una búsqueda que no se parece a nada ("laptop", "xyzabc") devuelve cero resultados y el sitio
// muestra "no hay resultados" en vez de productos que no tienen que ver (antes era 0.15 sobre el
// nombre completo y salían productos sin relación).
const TRIGRAM_THRESHOLD = 0.55;

// Bloque 58: misma normalización de puntuación que las búsquedas literales
// de arriba, para que una coma/punto de más o de menos no le baje la
// similitud a un match que en el fondo es el mismo texto.
export async function findProductIdsByTrigram(q, limit) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Product"
    WHERE "isActive" = true
      AND word_similarity(regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g'), regexp_replace(unaccent(lower(name)), '[^a-z0-9]+', ' ', 'g')) > ${TRIGRAM_THRESHOLD}
    ORDER BY word_similarity(regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g'), regexp_replace(unaccent(lower(name)), '[^a-z0-9]+', ' ', 'g')) DESC
    LIMIT ${limit}
  `;
  return rows.map((r) => r.id);
}

async function findVendorIdsByTrigram(q, limit) {
  const rows = await prisma.$queryRaw`
    SELECT id FROM "Vendor"
    WHERE "isBlocked" = false AND "status" = 'ACTIVE' AND "isPrivate" = false
      AND word_similarity(regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g'), regexp_replace(unaccent(lower("companyName")), '[^a-z0-9]+', ' ', 'g')) > ${TRIGRAM_THRESHOLD}
    ORDER BY word_similarity(regexp_replace(unaccent(lower(${q})), '[^a-z0-9]+', ' ', 'g'), regexp_replace(unaccent(lower("companyName")), '[^a-z0-9]+', ' ', 'g')) DESC
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

// Tienda que el público puede ver en los listados.
const PUBLIC_VENDOR_WHERE = { isBlocked: false, status: "ACTIVE", isPrivate: false };

// Producto que el público puede ver en la portada, el catálogo y la búsqueda. Lo usan la búsqueda y las opciones de filtro,
// para que un filtro nunca ofrezca algo que la búsqueda después no muestra.
const PUBLIC_PRODUCT_WHERE = {
  isActive: true,
  // Bloque 157: "solo para pedido de mesa" — nunca aparece en Home ni en
  // el catálogo, sin importar qué tan bien rankee.
  hiddenFromStore: false,
  // Bloque 208 y 304: un restaurante con menú oculto (solo se ve escaneando el QR de la mesa) no debe salir en el
  // catálogo ni en la búsqueda, igual que ya no sale en su propia página.
  NOT: { availableForTableMenu: true, vendor: { menuPublic: false } },
  // Bloque 52: excedente del cupo de productos del plan — sigue existiendo
  // para el vendedor, nunca en un listado público (ver planConfig.js).
  overQuota: false,
  // Bloque 82 (pedido explícito, bug real reportado en vivo): un producto
  // agotado (sin `unlimitedStock`, `stock` 0) no debe aparecer en Home ni
  // en el catálogo — solo se muestra en su propia tienda, en la sección
  // "Próximamente disponibles" (Store.jsx, Bloque 23, que consulta
  // getVendorBySlug directo, sin pasar por acá — a propósito no se toca).
  OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }],
};

// Busca el texto fuera del lugar elegido. `where` es la misma condición de la búsqueda pero sin el lugar. Devuelve cuántos
// productos hay, en qué lugares (provincia o estado; si la tienda no tiene, su país), ordenados por cantidad, y, si se pide
// `include`, los primeros productos para mostrarlos. null si tampoco hay nada en otro lugar.
const ELSEWHERE_SHOWN = 12;
const placeSelect = {
  country: { select: { id: true, name: true } },
  province: { select: { id: true, name: true, country: { select: { id: true, name: true } } } },
};
async function searchElsewhere(q, where, include, findIds = findProductIdsByName) {
  const matchIn = (ids) =>
    ids.length ? prisma.product.findMany({ where: { ...where, id: { in: ids } }, select: { id: true, vendor: { select: { locations: { select: placeSelect, take: 1 } } } } }) : [];
  let ids = await findIds(q);
  let rows = await matchIn(ids);
  if (!rows.length) {
    ids = await findProductIdsByTrigram(q, 60);
    rows = await matchIn(ids);
  }
  if (!rows.length) return null;

  const places = new Map();
  for (const r of rows) {
    const loc = r.vendor.locations[0];
    const country = loc?.country ?? loc?.province?.country;
    if (!country) continue;
    const key = loc.province?.id ?? country.id;
    if (!places.has(key)) {
      places.set(key, {
        countryId: country.id,
        provinceId: loc.province?.id ?? null,
        name: loc.province?.name ?? country.name,
        countryName: country.name,
        count: 0,
      });
    }
    places.get(key).count++;
  }

  const shownIds = reorderByIds(rows, ids).slice(0, ELSEWHERE_SHOWN).map((r) => r.id);
  const shown = include ? reorderByIds(await prisma.product.findMany({ where: { id: { in: shownIds } }, include }), shownIds) : [];
  return {
    total: rows.length,
    places: [...places.values()].sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, "es")).slice(0, 6),
    products: shown,
  };
}

// El plan de la tienda solo se carga para el ranking: no viaja en la respuesta pública (el autocompletado tampoco lo manda).
function publicVendor(vendor) {
  if (!vendor) return vendor;
  const { planType: _planType, ...rest } = vendor;
  return withComputedVendorFields(rest);
}

// Búsqueda estructurada (pills de categoría, selector de provincia/municipio,
// sidebar de filtros de Shop, buscador de texto): la que consume el catálogo
// y la Home.
export async function structuredSearch(req, res) {
  const { q, categoryId, countryId, provinceId, municipalityId, minPrice, maxPrice, sort, onlyVerified, payment, accepts, currency, discount, wholesale, badge, minRating } = req.query;
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

  // Forma de coordinar el pago que ofrece la TIENDA (contra entrega, en línea, efectivo). Acepta también los nombres antiguos de
  // los enlaces del chat: "prepaid" es pago en línea y "whatsapp" no restringe nada (toda tienda coordina por WhatsApp).
  const checkoutOptions = payment
    ? [...new Set(String(payment).split(",").map((m) => (m === "prepaid" ? "online" : m)).filter((m) => /^[a-z0-9_]{1,40}$/.test(m)))]
    : [];
  // Métodos de pago que la tienda dice aceptar (Zelle, Tropipay, tarjeta...), tal como los carga en su configuración.
  const acceptedMethods = accepts ? String(accepts).split(",").map((m) => m.trim()).filter(Boolean).slice(0, 12) : [];
  const currencyFilter = (await allCodes("CURRENCY")).includes(String(currency)) ? String(currency) : undefined;
  const ratingMin = Number(minRating) > 0 ? Math.min(5, Number(minRating)) : undefined;

  // Todo lo que NO es el texto libre de búsqueda — se reusa igual en los 3
  // intentos (literal → corregido por IA → aproximado por trigramas), el id
  // filter se agrega aparte en cada intento.
  const baseWhere = {
    isActive: true,
    // Bloque 157: "solo para pedido de mesa" — nunca aparece en Home ni en
    // el catálogo, sin importar qué tan bien rankee.
    hiddenFromStore: false,
    // Bloque 208 y 304: un restaurante con menú oculto (solo se ve escaneando el QR de la mesa) no debe salir en el
    // catálogo ni en la búsqueda, igual que ya no sale en su propia página.
    NOT: { availableForTableMenu: true, vendor: { menuPublic: false } },
    // Bloque 52: excedente del cupo de productos del plan — sigue existiendo
    // para el vendedor, nunca en un listado público (ver planConfig.js).
    overQuota: false,
    categoryId: categoryIds ? { in: categoryIds } : undefined,
    price: minPrice || maxPrice ? { gte: minPrice ? Number(minPrice) : undefined, lte: maxPrice ? Number(maxPrice) : undefined } : undefined,
    currency: currencyFilter,
    oldPrice: discount === "true" ? { not: null } : undefined,
    priceTiers: wholesale === "true" ? { some: {} } : undefined,
    badge: badge ? String(badge) : undefined,
    rating: ratingMin ? { gte: ratingMin } : undefined,
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
      checkoutPaymentOptions: checkoutOptions.length ? { hasSome: checkoutOptions } : undefined,
      acceptedPaymentMethods: acceptedMethods.length ? { hasSome: acceptedMethods } : undefined,
      locations: vendorZoneWhere({ countryId, provinceId, municipalityId }),
    },
  };
  const includeOpts = {
    vendor: {
      select: {
        companyName: true,
        slug: true,
        verificationStatus: true,
        // Para el empujón de "Destacada en la portada" del plan (planFeaturedChecker en productRanking.js).
        planType: true,
        isBlocked: true,
        color: true,
        whatsapp: true,
        ...VENDOR_SHIPPING_SELECT,
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
    // 2026-10-24: los candidatos ya no son solo los 300 más nuevos (ver fetchRankingPool).
    products = await fetchRankingPool({ where: baseWhere, include: includeOpts, size: 300 });
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
  if (sort === "sales") products = [...products].sort((a, b) => (b.salesCount ?? 0) - (a.salesCount ?? 0));
  if (sort === "newest") products = [...products].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
  if (sort === "rating") {
    // Mismas reglas que el resto de la plataforma (lib/ratings.js): solo reseñas visibles (una oculta por un reporte no
    // cuenta) y el puntaje ponderado, para que un producto con una sola reseña de 5 no pase delante de uno con muchas de 4,8.
    const agg = await prisma.review.groupBy({
      by: ["productId"],
      where: { productId: { in: products.map((p) => p.id) }, rating: { not: null }, isHidden: false },
      _avg: { rating: true },
      _count: { rating: true },
    });
    const scoreByProduct = Object.fromEntries(agg.map((a) => [a.productId, ratingScore(a._avg.rating ?? 0, a._count.rating)]));
    const scoreOf = (p) => scoreByProduct[p.id] ?? ratingScore(0, 0);
    products = [...products].sort((a, b) => scoreOf(b) - scoreOf(a));
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
  // 2026-10-24 (pedido del dueño): también cuentan carritos, favoritos y pedidos recientes, y sin texto buscado (portada y
  // catálogo sin búsqueda) el orden rota con la semilla de la visita (ver rotate en productRanking.js). Con texto buscado no
  // rota: ahí manda encontrar lo pedido, no turnar.
  if (!sort || sort === "relevance") {
    const { reviewStats, engagement } = await loadRankingSignals(products.map((p) => p.id));
    // El beneficio "Destacada en la portada" del plan (featuredInHome) empuja también con texto buscado, igual que en el
    // autocompletado. Los planes salen de la caché de 5 s de planConfig.js: apagarlo en el admin se nota casi al instante.
    const isPlanFeatured = planFeaturedChecker(await getAllPlanConfigs());
    const options = cleanQ ? { isPlanFeatured } : { seed: rotationSeed(req.query.seed), isPlanFeatured };
    products = rankFeaturedProducts(products, reviewStats, engagement, options).slice(0, 60);
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

  // Si el texto buscado no está en el lugar elegido pero sí en otro, se le dice al cliente dónde (con los mismos filtros, solo
  // sin el lugar), en vez de dejarlo con una pantalla vacía. Nunca se mezcla con resultados de su zona: solo cuando no hay ninguno.
  let elsewhere = null;
  if (products.length === 0 && cleanQ && vendorZoneWhere({ countryId, provinceId, municipalityId })) {
    const anyZoneWhere = { ...baseWhere, vendor: { ...baseWhere.vendor, locations: undefined } };
    elsewhere = await searchElsewhere(cleanQ, anyZoneWhere, includeOpts);
    if (elsewhere) elsewhere.products = elsewhere.products.map((p) => ({ ...p, vendor: publicVendor(p.vendor) }));
  }

  const withBestSeller = await attachBestSellerFlag(products);
  if (cleanQ) recordSearchTerm(cleanQ, withBestSeller.length);
  res.json({ products: withBestSeller.map((p) => ({ ...p, vendor: publicVendor(p.vendor) })), nearbyProvinces, elsewhere });
}

// Lo más buscado por los clientes (ya filtrado y redactado por IA). Lo lee la portada.
export async function trendingSearches(req, res) {
  const { countryId, provinceId, municipalityId } = req.query;
  const zone = provinceId || countryId ? { countryId, provinceId, municipalityId } : null;
  res.set("Cache-Control", "public, max-age=300");
  res.json({ items: zone ? await getTrendingSearchesForZone(zone) : await getTrendingSearches() });
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
  if (q.length < AUTOCOMPLETE_MIN_CHARS) return res.json({ products: [], vendors: [], categories: [], hasMore: false });
  const lowerQ = q.toLowerCase();

  const vendorSelect = { companyName: true, slug: true, verificationStatus: true, planType: true };
  // Bloque 64: products:{some} es la regla de visibilidad (independiente de
  // verificationStatus) — sin productos publicados, ni la tienda ni sus
  // productos aparecen acá.
  const vendorWhere = {
    isBlocked: false,
    status: "ACTIVE",
    isPrivate: false,
    products: { some: { isActive: true, hiddenFromStore: false, overQuota: false } },
    ...(onlyVerified ? { verificationStatus: "VERIFIED" } : {}),
    // El desplegable de búsqueda también respeta el lugar de compra elegido.
    locations: vendorZoneWhere(req.query),
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
  // Bloque 52 (decisión confirmada — "las dos cosas"): el empuje por
  // "destacada" ya no es solo por estar verificada — el plan actual tiene
  // que tener featuredInHome encendido. Los 2 planes se piden una sola vez
  // (ya cacheados 5s en lib/planConfig.js) para no hacer N llamadas async
  // dentro del .map() de abajo.
  const isFeaturedVendor = planFeaturedChecker(await getAllPlanConfigs());
  const ranked = fuzzy
    ? candidates
    : candidates
        .map((p) => ({ p, tier: matchTier(p, lowerQ), featured: p.isFeatured || isFeaturedVendor(p.vendor) }))
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

  // Tipos de negocio (panadería, farmacia...) cuyo nombre coincide, para ir directo a las tiendas de ese rubro. Son pocas
  // filas, así que se filtra en memoria ignorando tildes y mayúsculas.
  const fold = (s) => String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").toLowerCase();
  const foldedQ = fold(q);
  // Solo los tipos que tienen alguna tienda visible en el lugar elegido: sugerir uno vacío llevaría a una página sin tiendas.
  const categories = (await prisma.businessCategory.findMany({ where: { active: true, vendors: { some: vendorWhere } }, orderBy: { sortOrder: "asc" }, select: { id: true, name: true, icon: true } }))
    .filter((c) => fold(c.name).includes(foldedQ))
    .slice(0, 4);

  // Nada en el lugar elegido: se cuenta cuántos productos hay en otros lugares y dónde, para avisarlo en el desplegable.
  let elsewhere = null;
  const { locations: zoneOnly, ...anyZoneVendor } = vendorWhere;
  if (zoneOnly && products.length === 0 && vendors.length === 0) {
    // Mismas coincidencias que el desplegable: nombre, descripción y etiquetas.
    const sameMatches = async (text) => [...new Set([...(await findProductIdsByNameOrDescription(text, 40)), ...(await findProductIdsByTag(text, 40))])];
    elsewhere = await searchElsewhere(q, { ...PUBLIC_PRODUCT_WHERE, vendor: { ...PUBLIC_VENDOR_WHERE, ...anyZoneVendor } }, null, sameMatches);
    if (elsewhere) delete elsewhere.products;
  }

  res.json({ products, vendors: withComputedVendorFieldsList(vendors), categories, hasMore: ranked.length > AUTOCOMPLETE_LIMIT, elsewhere });
}

// --- Opciones reales de los filtros -----------------------------------------
// Los paneles de filtros del catálogo y de /tiendas solo muestran lo que de verdad existe entre las tiendas visibles del lugar
// elegido: las monedas en que venden, las formas de pago que ofrecen, los métodos que aceptan, si hay verificadas,
// restaurantes, descuentos, etiquetas y valoraciones. Así ningún filtro lleva a una pantalla vacía. Cuando una tienda nueva
// se registra con algo distinto, la opción aparece sola.
const FACET_RATINGS = [4, 3];

function unionOf(rows, field, allowed) {
  const set = new Set(rows.flatMap((r) => r[field] ?? []));
  return allowed ? allowed.filter((v) => set.has(v)) : [...set].sort();
}

export async function filterFacets(req, res) {
  // En el orden del catálogo del admin (lib/catalog.js).
  const [FACET_CURRENCIES, FACET_PAYMENTS] = await Promise.all([allCodes("CURRENCY"), allCodes("CHECKOUT_PAYMENT")]);
  const zone = vendorZoneWhere(req.query);
  const vendorWhere = { ...PUBLIC_VENDOR_WHERE, ...(zone ? { locations: zone } : {}) };
  const vendorFields = { checkoutPaymentOptions: true, acceptedPaymentMethods: true, verificationStatus: true, isRestaurant: true, rating: true };

  if (req.query.scope === "stores") {
    // Mismo universo que listVendors: tiendas visibles con al menos un producto publicado (agotado o no).
    const shownProduct = { isActive: true, hiddenFromStore: false, overQuota: false };
    const [vendors, currencies] = await Promise.all([
      prisma.vendor.findMany({ where: { ...vendorWhere, products: { some: shownProduct } }, select: vendorFields }),
      prisma.product.groupBy({ by: ["currency"], where: { ...shownProduct, vendor: vendorWhere } }),
    ]);
    return res.json({
      currencies: FACET_CURRENCIES.filter((c) => currencies.some((r) => r.currency === c)),
      payment: unionOf(vendors, "checkoutPaymentOptions", FACET_PAYMENTS),
      accepts: unionOf(vendors, "acceptedPaymentMethods"),
      hasVerified: vendors.some((v) => v.verificationStatus === "VERIFIED"),
      hasRestaurants: vendors.some((v) => v.isRestaurant),
      hasShops: vendors.some((v) => !v.isRestaurant),
      ratings: FACET_RATINGS.filter((r) => vendors.some((v) => Number(v.rating) >= r)),
    });
  }

  // Catálogo: mismo universo que structuredSearch sin filtros (productos a la venta de tiendas visibles del lugar).
  const productWhere = { ...PUBLIC_PRODUCT_WHERE, vendor: vendorWhere };
  const [vendors, currencies, badges, discounts, wholesale, ratings] = await Promise.all([
    prisma.vendor.findMany({ where: { ...vendorWhere, products: { some: PUBLIC_PRODUCT_WHERE } }, select: vendorFields }),
    prisma.product.groupBy({ by: ["currency"], where: productWhere }),
    prisma.product.groupBy({ by: ["badge"], where: { ...productWhere, badge: { not: null } } }),
    prisma.product.count({ where: { ...productWhere, oldPrice: { not: null } } }),
    prisma.product.count({ where: { ...productWhere, priceTiers: { some: {} } } }),
    Promise.all(FACET_RATINGS.map((r) => prisma.product.count({ where: { ...productWhere, rating: { gte: r } } }))),
  ]);
  res.json({
    currencies: FACET_CURRENCIES.filter((c) => currencies.some((r) => r.currency === c)),
    payment: unionOf(vendors, "checkoutPaymentOptions", FACET_PAYMENTS),
    accepts: unionOf(vendors, "acceptedPaymentMethods"),
    hasVerified: vendors.some((v) => v.verificationStatus === "VERIFIED"),
    hasDiscount: discounts > 0,
    hasWholesale: wholesale > 0,
    badges: badges.map((b) => b.badge).filter(Boolean).sort((a, b) => a.localeCompare(b, "es")),
    ratings: FACET_RATINGS.filter((_, i) => ratings[i] > 0),
  });
}
