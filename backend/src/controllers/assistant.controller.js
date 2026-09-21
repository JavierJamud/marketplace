import { z } from "zod";
import jwt from "jsonwebtoken";
import { readFile, unlink } from "node:fs/promises";
import { join, dirname, extname } from "node:path";
import { fileURLToPath } from "node:url";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { chatWithStoreAssistant } from "../lib/ai.js";
import { logError } from "../lib/errorLog.js";
import { buildFewShotBlock } from "../lib/chatTrainingExamples.js";
import { getBrandSettings } from "./settings.controller.js";
import { withComputedVendorFields } from "../services/vendorVerification.service.js";

const __dirname = dirname(fileURLToPath(import.meta.url));
export const ASSISTANT_DOC_DIR = join(__dirname, "..", "..", "uploads", "assistant-docs");

// Bloque 30: bot general del marketplace (Home) — distinto del bot por
// tienda (chat.controller.js). No pertenece a ningún vendedor: busca en
// TODO el catálogo activo, nunca ejecuta addToCart (el cliente agrega desde
// la tienda/producto real), y su "documento de negocio" es lo que el admin
// suba en AdminAssistant.jsx (varios documentos a la vez, no uno solo).
// Bloque 32: el reconocimiento de imágenes (Bloque 30) queda derogado —
// reemplazado por audio (transcripción, ver /ai/transcribe + lib/ai.js),
// que llega acá como texto plano normal, sin ninguna rama especial.

// Bloque 42 (optimización de tokens — bajado de 20 a 6): el modelo no
// tiene memoria propia entre requests, así que ESTE historial es lo único
// que evita que "se olvide" de un dato ya filtrado (zona, precio) o
// repita una pregunta — pero mandar 20 turnos completos en CADA mensaje
// de la charla es lo que más pesaba del prompt (confirmado en vivo: cuota
// diaria de Groq agotada en ~8-10 mensajes). 6 turnos (~3 idas y vueltas)
// alcanza para el filtrado progresivo actual sin arrastrar toda la charla
// — si en pruebas reales resultara corto para algún caso, subir a 8, nunca
// volver a 20.
const HISTORY_LIMIT = 6;
const CANDIDATE_LIMIT = 10;
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

function isSessionExpired(lastMessage) {
  return !!lastMessage && Date.now() - new Date(lastMessage.createdAt).getTime() > SESSION_EXPIRY_MS;
}

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

// Bloque 34 — bug real encontrado en vivo: el modelo a veces deja sintaxis
// JSON colgando dentro del STRING de un suggestedFollowUp (ej. una vez
// devolvió literalmente "Buscar otra]}:" como sugerencia) — mismo tipo de
// fuga que "[ID:...]"/"[2]" dentro de "text" (ver más abajo), solo que acá
// en un campo nuevo. Se recorta cualquier corrida de llaves/corchetes/
// comillas/dos puntos pegada al principio o final del string.
function cleanFollowUp(s) {
  return s.replace(/^[{}[\]":]+/, "").replace(/[{}[\]":]+$/, "").trim();
}

// --- Admin: documentos de entrenamiento ------------------------------------

export async function listAssistantDocuments(_req, res) {
  const documents = await prisma.assistantDocument.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ documents });
}

export async function uploadAssistantDocument(req, res) {
  if (!req.file) throw new AppError("Sube un archivo .pdf o .txt.", 400);
  const document = await prisma.assistantDocument.create({
    data: { filename: req.file.filename, originalName: req.file.originalname },
  });
  res.status(201).json({ document });
}

export async function deleteAssistantDocument(req, res) {
  const { id } = req.params;
  const document = await prisma.assistantDocument.findUnique({ where: { id } });
  if (!document) throw new AppError("Documento no encontrado.", 404);
  await unlink(join(ASSISTANT_DOC_DIR, document.filename)).catch(() => {});
  await prisma.assistantDocument.delete({ where: { id } });
  res.status(204).send();
}

// --- Búsqueda de catálogo cross-tienda --------------------------------------

// Bloque 32: se agrega "locations" (provincia/municipio real de cada
// tienda) — antes esto solo hacía falta para mostrar la tarjeta, ahora
// también es la base del filtrado geográfico progresivo (ver
// summarizeZones más abajo). take:1 porque una tienda puede cargar más de
// una ubicación de venta, pero alcanza con una representativa para el
// resumen de zonas (mismo criterio que search.controller.js).
const CANDIDATE_VENDOR_SELECT = {
  id: true,
  companyName: true,
  slug: true,
  color: true,
  verificationStatus: true,
  locations: { include: { province: true, municipality: true }, take: 1 },
};
const CANDIDATE_INCLUDE = { vendor: { select: CANDIDATE_VENDOR_SELECT }, options: { select: { name: true, values: true } } };
// Cuántos productos como máximo se traen de la base para ANALIZAR zonas —
// más ancho que CANDIDATE_LIMIT (lo que de verdad se muestra como tarjeta),
// porque hace falta ver el panorama completo (todas las provincias/
// municipios con stock) para decidir si hay que preguntar ubicación o no,
// aunque al final solo se citen unos pocos candidatos concretos.
const ZONE_POOL_LIMIT = 40;

// Bloque 30 — bug real encontrado en vivo: a diferencia de autocompleteSearch
// (search.controller.js), acá la "query" es un mensaje de chat en lenguaje
// natural ("busco audífonos inalámbricos"), no una palabra suelta de una
// barra de búsqueda — un contains() de la frase COMPLETA casi nunca
// aparece tal cual dentro de un nombre de producto ("Audífonos
// inalámbricos Pro" no contiene la subcadena "busco audífonos
// inalámbricos"), así que la búsqueda volvía SIEMPRE vacía apenas el
// cliente escribía de forma conversacional. Se extraen palabras clave
// (sacando muletillas típicas de pedido) y se busca por CUALQUIERA de
// ellas, no por la frase entera.
// Bloque 34 (fix reportado en vivo): faltaban las variantes CON TILDE de
// palabras de pregunta ("qué", "cuál", "cómo", "dónde", "están"...) — como
// el filtro compara texto en minúscula SIN plegar acentos, "qué" no
// matcheaba la entrada "que" (sin tilde) ya listada, así que colaba como
// si fuera un término de búsqueda real (ej. "¿Qué tiendas están
// verificadas?" generaba términos ["qué","tiendas","están","verificadas"]
// en vez de solo ["tiendas","verificadas"]) — no rompía nada por sí solo,
// pero ensuciaba innecesariamente cada búsqueda con ruido.
// Bloque 37 — BUG CRÍTICO encontrado en el diagnóstico (causa real de B3,
// listados vacíos pese a datos reales): faltaban verbos/palabras genéricas
// de LISTAR ("ver", "buscar" en infinitivo — solo estaba "busco"/"buscando",
// "mostrar", "todo/toda/todos/todas") y la palabra genérica "producto(s)"
// (nunca es el nombre de un producto puntual). Sin esto, "Ver todas las
// tiendas" dejaba como términos ["ver","todas"] (tras sacar "tiendas" en
// VENDOR_META_WORDS) y "Buscar productos" dejaba ["buscar","productos"] —
// ninguno matchea ningún nombre real, así que el WHERE devolvía vacío pese
// a haber 10 tiendas verificadas y 29 productos con stock reales.
// Bloque 37 (fix encontrado en la propia verificación del bloque, en vivo):
// "catálogo"/"mercancía"/"artículos" faltaban acá — quedaban como único
// término real de "Ver catálogo" y se buscaban como si fueran el NOMBRE de
// un producto (nunca lo son), dejando ese caso vacío igual que "Buscar
// productos" antes del fix. Tienen que estar en STOPWORDS (no solo en la
// señal de BROAD_LISTING_REGEX de abajo) para que el mensaje quede con
// terms:[] y active el listado amplio en vez de buscarse a sí mismo.
const STOPWORDS = new Set([
  "busco", "necesito", "quiero", "quisiera", "estoy", "buscando", "buscar", "buscas", "buscá", "encontrar",
  "encuentro", "mostrar", "mostrame", "mostrarme", "muestrame", "muéstrame", "listar", "ver", "dame", "dime",
  "decime", "comprar", "comprando", "tengo", "tienen", "tenes", "tienes", "tiene", "hay", "algo", "alguna",
  "algun", "algún", "alguno", "porfa", "porfavor", "favor", "gracias", "hola", "porfis", "de", "del", "la",
  "el", "los", "las", "un", "una", "unos", "unas", "todo", "toda", "todos", "todas", "producto", "productos",
  "catalogo", "catálogo", "mercancia", "mercancía", "articulo", "articulos", "artículo", "artículos",
  "para", "por", "que", "qué", "con", "sin", "y", "o", "en", "al", "es", "son", "me", "te", "se", "mi", "tu", "este", "esta",
  "cual", "cuál", "cuales", "cuáles", "como", "cómo", "donde", "dónde", "cuando", "cuándo", "quien", "quién",
  "estan", "están", "esta", "está", "eres", "sos", "puedo", "puede", "pueden", "podria", "podría", "hace", "hacen",
]);

function extractSearchTerms(rawText) {
  return rawText
    .toLowerCase()
    .replace(/[¿?¡!.,;:]/g, "")
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOPWORDS.has(w));
}

// Bloque 40 (bug real reportado en vivo): "unaccent()" en vez de un ILIKE
// pelado — contains()/ILIKE de Postgres compara byte a byte, NO pliega
// acentos, así que "audifonos" (sin tilde, muy común al escribir rápido)
// nunca matcheaba "Audífonos..." pese a ser exactamente el mismo producto
// real con stock. Ver migración 20260721000000 (CREATE EXTENSION unaccent).
async function searchTagMatches(terms) {
  const ids = new Set();
  for (const term of terms) {
    const pattern = `%${term}%`;
    const rows = await prisma.$queryRaw`
      SELECT id FROM "Product"
      WHERE "isActive" = true AND EXISTS (SELECT 1 FROM unnest(tags) AS t WHERE unaccent(t) ILIKE unaccent(${pattern}))
      LIMIT ${ZONE_POOL_LIMIT}
    `;
    rows.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

// Bloque 40 (mismo bug real, misma causa): nombre/descripción/categoría de
// producto también comparados con unaccent() de los dos lados — antes se
// hacía con Prisma "contains" directo (sensible a acentos). Se resuelve acá
// como IDs por separado y se fetchea el resto (vendor/options/price/etc.)
// con la query normal de Prisma, para no perder los includes tipados.
async function searchProductIdsByTerms(terms) {
  const ids = new Set();
  for (const term of terms) {
    const pattern = `%${term}%`;
    const rows = await prisma.$queryRaw`
      SELECT p.id FROM "Product" p
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE p."isActive" = true
        AND (
          unaccent(p.name) ILIKE unaccent(${pattern})
          OR unaccent(p.description) ILIKE unaccent(${pattern})
          OR unaccent(c.name) ILIKE unaccent(${pattern})
        )
      LIMIT ${ZONE_POOL_LIMIT}
    `;
    rows.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

// Bloque 32: rango de precio aproximado en el mensaje ("entre 300 y 500",
// "de 300 a 500", "300-500") — se extraen los dos números tal cual y se
// filtra Product.price directo con ellos, en la MISMA unidad que ya usa el
// resto del sitio (nunca se intenta convertir moneda ni adivinar si el
// cliente quiso decir CUP/USD — inventar una tasa de cambio sería peor que
// no filtrar por precio en absoluto).
const PRICE_RANGE_REGEX = /(\d{2,7})\s*(?:y|a|-|hasta)\s*(\d{2,7})/i;

function extractPriceRange(text) {
  const m = text.match(PRICE_RANGE_REGEX);
  if (!m) return { priceMin: null, priceMax: null };
  const a = Number(m[1]);
  const b = Number(m[2]);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return { priceMin: null, priceMax: null };
  return { priceMin: Math.min(a, b), priceMax: Math.max(a, b) };
}

// Bloque 30/32: ahora trae también "options" (variantes reales: Color,
// Talla, etc.) y la ubicación real de cada tienda — ya no se usa solo para
// armar la tarjeta, sino para el filtrado progresivo por atributo/zona (ver
// buildZoneSummary). Pool más ancho (ZONE_POOL_LIMIT) que lo que
// finalmente se muestra como candidato (CANDIDATE_LIMIT): hace falta ver
// el panorama completo de zonas antes de recortar a los pocos que se citan.
// Bloque 32: recibe "terms" YA resueltos (ver resolveSearchContext) en vez
// de una query cruda — la extracción de palabras clave ahora puede venir
// del mensaje actual O de uno anterior en la charla, así que se resuelve
// una sola vez en el handler y se comparte con el resto del contexto de
// zona, en vez de que esta función la vuelva a derivar por su cuenta.
// Bloque 37 (Parte C — cobertura completa): se suma "category.name" al OR
// — antes SOLO se buscaba en nombre/descripción/tags, así que una consulta
// por rubro real ("busco algo de Hogar", "ver Moda") nunca matcheaba porque
// ningún producto tiene literalmente esa palabra en su nombre o descripción.
// Bloque 37 (Parte B3 — bug real diagnosticado en vivo): "broadListing"
// permite listar TODO el catálogo activo (sin filtro de nombre) cuando el
// cliente pidió explícitamente "ver/buscar productos" en general sin decir
// cuál — antes esto devolvía [] siempre que no quedara ningún término tras
// sacar las muletillas, aunque hubiera 29 productos reales con stock.
// Bloque 82: mismo criterio que search.controller.js — un producto agotado
// no debe recomendarse por el asistente de IA (solo se muestra en su propia
// tienda, "Próximamente disponibles").
const IN_STOCK_WHERE = { OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }] };

async function searchCandidateProducts(terms, { priceMin, priceMax, broadListing } = {}) {
  const priceFilter = priceMin != null || priceMax != null ? { gte: priceMin ?? undefined, lte: priceMax ?? undefined } : undefined;

  if (!terms?.length) {
    if (!broadListing) return [];
    return prisma.product.findMany({
      where: { isActive: true, vendor: { isBlocked: false, status: "ACTIVE", isPrivate: false }, price: priceFilter, ...IN_STOCK_WHERE },
      include: CANDIDATE_INCLUDE,
      take: ZONE_POOL_LIMIT,
      orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
    });
  }

  const matchedIds = await searchProductIdsByTerms(terms);
  const nameOrDescMatches = matchedIds.length
    ? await prisma.product.findMany({
        where: { id: { in: matchedIds }, vendor: { isBlocked: false, status: "ACTIVE", isPrivate: false }, price: priceFilter, ...IN_STOCK_WHERE },
        include: CANDIDATE_INCLUDE,
        take: ZONE_POOL_LIMIT,
        orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
      })
    : [];

  // Más términos coincidentes = más relevante (un match de 1 palabra sobre
  // 3 pesa menos que uno que matchea las 3). normalizeForMatch (plegado de
  // acentos, ver más abajo) para que este ranking sea consistente con el
  // match accent-insensitive que ya hizo la consulta de arriba.
  function termHits(p) {
    const haystack = normalizeForMatch(`${p.name} ${p.description ?? ""}`);
    return terms.filter((t) => haystack.includes(normalizeForMatch(t))).length;
  }
  let ranked = [...nameOrDescMatches].sort((a, b) => termHits(b) - termHits(a));

  if (ranked.length < ZONE_POOL_LIMIT) {
    const haveIds = new Set(ranked.map((p) => p.id));
    const tagIds = (await searchTagMatches(terms)).filter((id) => !haveIds.has(id));
    const extra = tagIds.length
      ? await prisma.product.findMany({
          where: { id: { in: tagIds }, vendor: { isBlocked: false, status: "ACTIVE", isPrivate: false }, price: priceFilter, ...IN_STOCK_WHERE },
          include: CANDIDATE_INCLUDE,
          take: ZONE_POOL_LIMIT - ranked.length,
        })
      : [];
    ranked = [...ranked, ...extra];
  }

  return ranked;
}

// --- Búsqueda de tiendas (Bloque 34 — fix reportado en vivo) ----------------

// Bug real reportado en vivo: preguntas sobre TIENDAS ("¿qué tiendas están
// verificadas?", un chip como "Verificar tiendas por zona") caían en la
// búsqueda de PRODUCTOS de arriba, que lógicamente no encuentra nada (no son
// palabras de ningún producto) — el bot terminaba diciendo "sin resultados"
// para una pregunta que la base de datos sí puede responder perfectamente,
// solo que de una tabla distinta. Se busca SIEMPRE en Vendor también (no
// solo cuando se "detecta" intención de tienda — más simple y más robusto
// que clasificar intención a mano, mismo criterio de todo este archivo: el
// backend resuelve datos reales, el modelo decide qué mostrar con eso).
const VENDOR_SEARCH_SELECT = {
  id: true,
  companyName: true,
  slug: true,
  verificationStatus: true,
  description: true,
  category: { select: { name: true } },
  businessCategory: { select: { name: true } },
  locations: { include: { province: true, municipality: true }, take: 1 },
};

// "Verificad-" en el mensaje es una señal inequívoca de que el cliente
// quiere SOLO verificadas — filtro determinístico en la consulta (nunca se
// le confía al modelo filtrar esto de una lista mixta), no una palabra de
// búsqueda más (por eso no está en STOPWORDS: si aparece, cambia el WHERE,
// no es ruido).
function wantsVerifiedOnly(message) {
  return /verificad/i.test(message);
}

// Bug real reportado en vivo: "Verificar tiendas por zona" deja como
// términos ["verificar","zona"] (ninguno es stopword de producto) — sin
// este filtro, esas palabras META sobre la BÚSQUEDA DE TIENDAS EN SÍ se
// usaban como si fueran el nombre/rubro de una tienda real (ninguna tienda
// se llama "Verificar" ni tiene un rubro "zona"), así que el WHERE nunca
// matcheaba nada y la búsqueda volvía vacía pese a haber tiendas reales
// para mostrar. Mismo criterio que "tienda"/"tiendas" ya excluidos.
const VENDOR_META_WORDS = new Set([
  "tienda", "tiendas", "verificar", "verificad", "verificada", "verificadas", "verificado", "verificados",
  "zona", "zonas", "provincia", "provincias", "municipio", "municipios", "cerca", "cercana", "cercanas", "cercano", "cercanos",
]);

// Bloque 40 (mismo bug real de acentos): companyName/rubro comparados con
// unaccent() de los dos lados — antes "contains" de Prisma directo, sensible
// a acentos (ej. "panaderia" sin tilde no matcheaba "Panadería").
async function searchVendorIdsByTerms(terms) {
  const ids = new Set();
  for (const term of terms) {
    const pattern = `%${term}%`;
    const rows = await prisma.$queryRaw`
      SELECT v.id FROM "Vendor" v
      LEFT JOIN "Category" c ON c.id = v."categoryId"
      LEFT JOIN "BusinessCategory" bc ON bc.id = v."businessCategoryId"
      WHERE v."isBlocked" = false AND v."status" = 'ACTIVE'
        AND (
          unaccent(v."companyName") ILIKE unaccent(${pattern})
          OR unaccent(c.name) ILIKE unaccent(${pattern})
          OR unaccent(bc.name) ILIKE unaccent(${pattern})
        )
    `;
    rows.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

async function searchVendors({ terms, provinceId, municipalityId, onlyVerified }) {
  const locationFilter = municipalityId ? { some: { municipalityId } } : provinceId ? { some: { provinceId } } : undefined;
  const nameOrCategoryTerms = (terms ?? []).filter((t) => !VENDOR_META_WORDS.has(t));
  // Sin términos reales de nombre/rubro (ej. la pregunta era puramente
  // sobre zona/verificación): no forzar ningún filtro de id — mostrar lo
  // que haya para esa zona/verificación tal cual, en vez de una lista
  // vacía por un filtro de texto que no corresponde.
  const idFilter = nameOrCategoryTerms.length ? { in: await searchVendorIdsByTerms(nameOrCategoryTerms) } : undefined;
  const where = {
    isBlocked: false,
    status: "ACTIVE",
    isPrivate: false,
    // Bloque 64: regla de visibilidad, independiente de verificationStatus
    // de abajo — el bot no debe ofrecer una tienda sin catálogo.
    products: { some: { isActive: true } },
    verificationStatus: onlyVerified ? "VERIFIED" : undefined,
    locations: locationFilter,
    id: idFilter,
  };
  const vendors = await prisma.vendor.findMany({
    where,
    select: VENDOR_SEARCH_SELECT,
    take: 20,
    orderBy: { companyName: "asc" },
  });
  // Bloque 64: verificadas primero — ya no se puede ordenar por isVerified
  // en la propia query (es un enum de 8 valores, no un booleano).
  return vendors.sort((a, b) => (b.verificationStatus === "VERIFIED" ? 1 : 0) - (a.verificationStatus === "VERIFIED" ? 1 : 0));
}

// Texto de contexto — mismo criterio que candidatesText/zoneContext: única
// fuente de verdad sobre tiendas reales, el modelo nunca inventa un nombre
// de tienda que no esté acá.
// Bloque 41 (pedido explícito): numerado entre corchetes como CANDIDATOS
// — el modelo cita este número en "vendorIds" para pedir la tarjeta de UNA
// tienda puntual (nunca lista cada nombre en texto cuando el pedido es
// amplio, ver REGLAS/vendorByIndex en postMarketplaceChatMessage).
function vendorsText(vendors) {
  if (!vendors.length) return "(Sin tiendas para esta búsqueda/zona.)";
  return vendors
    .map((v, i) => {
      const loc = v.locations?.[0];
      const zone = loc?.province ? ` · zona: ${loc.municipality?.name ? `${loc.municipality.name}, ` : ""}${loc.province.name}` : "";
      const rubro = v.category?.name || v.businessCategory?.name;
      return `[${i + 1}] ${v.companyName}${v.verificationStatus === "VERIFIED" ? " (verificada)" : " (no verificada)"}${rubro ? ` · rubro: ${rubro}` : ""}${zone} · /tienda/${v.slug}`;
    })
    .join("\n");
}

// --- Filtrado geográfico progresivo (Bloque 32) -----------------------------

// Cache simple en memoria: 16 provincias + Isla de la Juventud, prácticamente
// estático (no cambia en caliente durante la vida del proceso) — evita una
// consulta a la base en cada mensaje del chat solo para esta lista chica.
let provincesCache = null;
async function getAllProvinces() {
  if (!provincesCache) provincesCache = await prisma.province.findMany({ select: { id: true, name: true } });
  return provincesCache;
}

// Plegado de acentos SOLO para esta detección de zona en lenguaje natural —
// nombres de provincias/municipios cubanos llevan acento muy seguido
// (Guantánamo, Camagüey...) y es común escribirlos sin tilde al chatear.
// No toca la búsqueda de productos (contains/ILIKE de Postgres, ya
// documentado como no acento-insensible en bloques anteriores, fuera de
// alcance de este bloque) — acá es un .includes() en JS sobre una lista
// chica (16-20 nombres), donde plegar acentos es barato y acota justo el
// problema nuevo que introduce esta función, sin tocar nada más.
function normalizeForMatch(s) {
  return s.normalize("NFD").replace(/\p{Diacritic}/gu, "").toLowerCase();
}

async function detectProvinceInText(text) {
  const provinces = await getAllProvinces();
  const norm = normalizeForMatch(text);
  return provinces.find((p) => norm.includes(normalizeForMatch(p.name))) ?? null;
}

// Bloque 32: en Cuba, la CAPITAL de varias provincias se llama exactamente
// igual que la provincia (ej. el municipio "Santiago de Cuba" dentro de la
// provincia "Santiago de Cuba") — sin este resguardo, un cliente que solo
// escribe el nombre de la provincia haría matchear ESE municipio homónimo
// de pura casualidad de texto, resolviendo la zona a la capital de una y
// saltándose la pregunta "¿capital o municipio?" que pide el escenario 4.
// Solo cuenta como respuesta explícita de la capital si el mensaje además
// dice "capital".
function detectMunicipalityMatch(municipalities, norm, provinceName) {
  const isCapitalKeyword = /\bcapital\b/.test(norm);
  return (
    municipalities.find((m) => {
      const isCapitalMuni = normalizeForMatch(m.name) === normalizeForMatch(provinceName);
      if (isCapitalMuni && !isCapitalKeyword) return false;
      return norm.includes(normalizeForMatch(m.name));
    }) ?? null
  );
}

async function detectMunicipalityInText(text, provinceId, provinceName) {
  if (!provinceId) return null;
  const municipalities = await prisma.municipality.findMany({ where: { provinceId }, select: { id: true, name: true, provinceId: true } });
  const norm = normalizeForMatch(text);
  return detectMunicipalityMatch(municipalities, norm, provinceName);
}

// Bloque 32 — bug real encontrado en vivo: a diferencia de la zona (ver
// resolveZoneFromContext, que SÍ mira el historial), esto al principio solo
// miraba el mensaje actual — con "Santiago de Cuba" (una respuesta a la
// pregunta de provincia, sin ningún término de producto) la búsqueda salía
// vacía de nuevo, aunque el producto ("ventilador de pie") ya estuviera
// clarísimo un mensaje antes en la misma charla. Mismo criterio que la
// zona: el mensaje ACTUAL manda si trae término de producto propio (así
// "mejor un freezer" sí reemplaza el filtro anterior, escenario de cambio
// de idea); si no trae ninguno, se reusan los términos/precio del último
// mensaje del cliente que sí los tenía.
// Bloque 32 — segundo bug real encontrado en vivo, mismo probe: nombres de
// lugar ("Santiago", "Cuba", "Segundo", "Frente"...) pasan el filtro de
// STOPWORDS sin problema (no son muletillas de pedido, son sustantivos
// largos como cualquier otro), así que un mensaje que en realidad es SOLO
// una respuesta de zona ("Santiago de Cuba") igual generaba "términos
// propios" no vacíos y el fallback de arriba nunca se activaba — la
// búsqueda terminaba filtrando por "santiago"/"cuba" contra nombre/
// descripción de producto y devolvía cualquier cosa que matcheara esas
// palabras sueltas (confirmado en vivo: devolvió una camiseta). Se
// descartan las palabras que ya forman parte de la provincia/municipio
// YA detectado (resolveZoneFromContext) antes de decidir si el mensaje
// "trae término de producto propio" — así una respuesta puramente de zona
// cae al fallback de historial en vez de buscarse a sí misma como si fuera
// el nombre de un producto.
function stripZoneWords(terms, ...zoneNames) {
  const zoneWords = new Set(zoneNames.filter(Boolean).flatMap((name) => normalizeForMatch(name).split(/\s+/)));
  return terms.filter((t) => !zoneWords.has(normalizeForMatch(t)));
}

// Bloque 37 (Parte B3): señal de "el cliente quiere ver productos EN
// GENERAL" (ej. "buscar productos", "ver catálogo") — se chequea sobre el
// texto CRUDO (antes de sacar muletillas), porque justamente "producto(s)"
// es de las palabras que ahora se descartan como ruido (ver STOPWORDS). Sin
// esta señal, un mensaje así quedaría con terms:[] y searchCandidateProducts
// devolvería [] pese a haber productos reales — con la señal, en cambio,
// se listan los productos reales sin filtro de nombre.
const BROAD_LISTING_REGEX = /\b(producto|productos|catalogo|catálogo|mercanc[ií]a|articulo|art[ií]culos)\b/i;

function resolveSearchContext(message, history, requestedProvince, requestedMunicipality) {
  const zoneNames = [requestedProvince?.name, requestedMunicipality?.name];
  const ownTerms = stripZoneWords(extractSearchTerms(message), ...zoneNames);
  const ownPrice = extractPriceRange(message);
  if (ownTerms.length > 0) return { terms: ownTerms, priceMin: ownPrice.priceMin, priceMax: ownPrice.priceMax, broadListing: false };

  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "user") continue;
    const priorTerms = stripZoneWords(extractSearchTerms(history[i].content), ...zoneNames);
    if (priorTerms.length > 0) {
      const priorPrice = extractPriceRange(history[i].content);
      return { terms: priorTerms, priceMin: priorPrice.priceMin, priceMax: priorPrice.priceMax, broadListing: false };
    }
  }
  return { terms: [], priceMin: ownPrice.priceMin, priceMax: ownPrice.priceMax, broadListing: BROAD_LISTING_REGEX.test(message) };
}

// Reconstruye qué zona está pidiendo el cliente EN ESTA CHARLA: primero el
// mensaje actual: si no menciona ninguna provincia/municipio (ej. el
// cliente solo contesta "Segundo Frente" a la pregunta que hizo el bot en
// el turno anterior), se busca hacia atrás en el historial reciente — sin
// esto, un mensaje de una sola palabra que solo responde "¿en qué
// municipio?" perdería la zona ya establecida en la charla.
// Bloque 37 — BUG CRÍTICO encontrado en el diagnóstico (causa real de la
// alucinación de ubicación + autocontradicción reportadas): este fallback
// escaneaba TODO el historial sin filtrar por rol, a diferencia de su
// función hermana (resolveSearchContext, que sí restringe a role==="user").
// Si el bot mencionaba alguna vez una provincia real en su propia respuesta
// (ej. al listar la zona de una tienda), un turno después este código la
// releía como si el CLIENTE la hubiera dicho, "fijando" una ubicación falsa
// en la charla — y esa ubicación falsa después se usaba para filtrar
// tiendas/productos, produciendo la contradicción tres turnos más tarde
// ("te dije Santiago" -> "no tengo información"). Nunca se puede confiar en
// texto generado por el modelo como si fuera un dato confirmado por el
// cliente — mismo principio de "nunca confíes en el modelo" ya aplicado en
// todo este archivo, ahora también para detectar zona.
async function resolveZoneFromContext(message, history) {
  const userHistory = history.filter((h) => h.role === "user");
  let province = await detectProvinceInText(message);
  for (let i = userHistory.length - 1; i >= 0 && !province; i--) {
    province = await detectProvinceInText(userHistory[i].content);
  }
  let municipality = province ? await detectMunicipalityInText(message, province.id, province.name) : null;
  for (let i = userHistory.length - 1; i >= 0 && province && !municipality; i--) {
    municipality = await detectMunicipalityInText(userHistory[i].content, province.id, province.name);
  }
  return { province, municipality };
}

// Agrupa los candidatos CON STOCK real (nunca agotado — preguntar "¿en qué
// zona?" sobre algo que no hay en NINGÚN lado no tiene sentido) por
// provincia/municipio de su tienda — esto es lo que le permite al bot saber
// si hace falta preguntar ubicación (>1 provincia), preguntar municipio
// (>1 dentro de la ya elegida), o ya hay una respuesta única y clara.
function summarizeZones(products) {
  const byProvince = new Map();
  for (const p of products) {
    if (!p.unlimitedStock && p.stock <= 0) continue;
    const loc = p.vendor.locations?.[0];
    if (!loc?.province) continue;
    if (!byProvince.has(loc.province.id)) {
      byProvince.set(loc.province.id, { id: loc.province.id, name: loc.province.name, municipalities: new Map(), productIds: new Set() });
    }
    const entry = byProvince.get(loc.province.id);
    entry.productIds.add(p.id);
    if (loc.municipality) {
      if (!entry.municipalities.has(loc.municipality.id)) {
        entry.municipalities.set(loc.municipality.id, { id: loc.municipality.id, name: loc.municipality.name, productIds: new Set() });
      }
      entry.municipalities.get(loc.municipality.id).productIds.add(p.id);
    }
  }
  return [...byProvince.values()]
    .map((p) => ({
      id: p.id,
      name: p.name,
      count: p.productIds.size,
      municipalities: [...p.municipalities.values()].map((m) => ({ id: m.id, name: m.name, count: m.productIds.size })),
    }))
    .sort((a, b) => b.count - a.count);
}

async function getAdjacentProvinceIds(provinceId) {
  const rows = await prisma.provinceAdjacency.findMany({ where: { provinceAId: provinceId }, select: { provinceBId: true } });
  return rows.map((r) => r.provinceBId);
}

// Del pool ancho (ZONE_POOL_LIMIT), los candidatos que de verdad se CITAN y
// muestran como tarjeta son solo los primeros CANDIDATE_LIMIT — si el
// cliente ya pidió una zona puntual, priorizamos que esos primeros sean de
// esa zona (o su fallback real) en vez de los más relevantes por palabra
// pero de cualquier lado del país. Sort estable: dentro de cada nivel de
// zona se mantiene el orden por relevancia de término ya calculado antes.
function prioritizeByZone(products, requestedProvince, requestedMunicipality, adjacentIds) {
  function tier(p) {
    const loc = p.vendor.locations?.[0];
    if (!loc?.province) return 3;
    if (requestedMunicipality && loc.municipality?.id === requestedMunicipality.id) return 0;
    if (requestedProvince && loc.province.id === requestedProvince.id) return 1;
    if (adjacentIds?.includes(loc.province.id)) return 2;
    return 3;
  }
  return [...products].sort((a, b) => tier(a) - tier(b));
}

// Texto de contexto de zona que se le pasa al modelo como única fuente de
// verdad — nunca ve la lista completa de provincias/municipios de Cuba
// (eso viviría cableado en el prompt, lo que el bloque pide evitar), solo
// el resultado YA resuelto de ESTA búsqueda puntual.
function buildZoneContext({ terms, priceMin, priceMax, products, requestedProvince, requestedMunicipality, adjacentIds }) {
  const filtersLine = `Filtros detectados en el pedido del cliente: ${
    priceMin != null ? `precio entre ${priceMin} y ${priceMax}` : "(sin rango de precio)"
  }; términos de búsqueda: ${terms.join(", ") || "(ninguno)"}.`;

  const zoneAskedLine = `Zona pedida por el cliente en esta charla: ${
    requestedMunicipality
      ? `municipio "${requestedMunicipality.name}" (provincia ${requestedProvince.name}).`
      : requestedProvince
        ? `provincia "${requestedProvince.name}" (sin municipio especificado todavía).`
        : "(el cliente no especificó ubicación todavía)."
  }`;

  const zones = summarizeZones(products);
  if (!zones.length) {
    return `${filtersLine}\n${zoneAskedLine}\nZONAS con stock real para esta búsqueda: ninguna — no encontramos este producto con stock en ninguna tienda del marketplace ahora mismo.`;
  }

  const zoneLines = zones.map((z) => {
    const isRequested = requestedProvince && z.id === requestedProvince.id;
    const isAdjacent = adjacentIds.includes(z.id);
    const tag = isRequested ? " [ZONA PEDIDA POR EL CLIENTE]" : isAdjacent ? " [provincia VECINA de la pedida — no es la pedida]" : "";
    const munis = z.municipalities.length
      ? ` — municipios con stock: ${z.municipalities.map((m) => `${m.name} (${m.count})`).join(", ")}`
      : "";
    let withinFlag = "";
    if (isRequested && requestedMunicipality && !z.municipalities.some((m) => m.id === requestedMunicipality.id)) {
      withinFlag = ` · SIN stock en el municipio "${requestedMunicipality.name}" (el pedido puntual del cliente) — sí hay en los municipios listados arriba de esa misma provincia.`;
    }
    return `- ${z.name}${tag}: ${z.count} resultado(s) con stock${munis}${withinFlag}`;
  });

  return `${filtersLine}\n${zoneAskedLine}\nZONAS con stock real para esta búsqueda (única fuente de verdad — nunca inventes otra tienda, zona o stock):\n${zoneLines.join("\n")}`;
}

// Bloque 32: suma zona real (provincia/municipio de la tienda) y variantes
// reales (options/tags) — antes solo alcanzaba con precio/stock/tienda
// porque no había ni pregunta de ubicación ni de atributo progresiva.
function candidatesText(products) {
  if (!products.length) return "(Sin resultados para esta búsqueda.)";
  return products
    .map((p, i) => {
      const price = fmtCUP(p.price) + (p.oldPrice ? ` (antes ${fmtCUP(p.oldPrice)})` : "");
      const stock = p.unlimitedStock ? "disponible siempre (sin límite de stock)" : p.stock > 0 ? `stock ${p.stock}` : "AGOTADO";
      const verified = p.vendor.verificationStatus === "VERIFIED" ? " · tienda verificada" : "";
      const loc = p.vendor.locations?.[0];
      const zone = loc?.province ? ` · zona: ${loc.municipality?.name ? `${loc.municipality.name}, ` : ""}${loc.province.name}` : "";
      const options = p.options?.length ? ` · variantes: ${p.options.map((o) => `${o.name}(${o.values.join("/")})`).join("; ")}` : "";
      const tags = p.tags?.length ? ` · tags: ${p.tags.join(", ")}` : "";
      return `[${i + 1}] ${p.name} · ${price} · ${stock} · tienda: ${p.vendor.companyName}${verified}${zone}${options}${tags}`;
    })
    .join("\n");
}

// Bloque 34: suma description/oldPrice (ya venían del pool sin select
// explícito, Prisma trae todos los escalares por defecto — ver
// CANDIDATE_INCLUDE) para la descripción corta y el badge de descuento del
// nuevo diseño de tarjeta.
function toCardProduct(p) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    price: p.price,
    oldPrice: p.oldPrice,
    description: p.description,
    images: p.images,
    stock: p.stock,
    unlimitedStock: p.unlimitedStock ?? false,
    vendor: withComputedVendorFields({ companyName: p.vendor.companyName, slug: p.vendor.slug, color: p.vendor.color, verificationStatus: p.vendor.verificationStatus }),
  };
}

// Bloque 41 (pedido explícito): forma que consume la tarjeta de tienda del
// chat (MarketplaceChatWidget.jsx) — se muestra SOLO cuando el modelo citó
// esa tienda puntual en "vendorIds" (pregunta sobre una tienda específica),
// nunca para un pedido amplio de "ver tiendas" (ahí va showAllStoresButton).
function toVendorCard(v) {
  const loc = v.locations?.[0];
  return {
    id: v.id,
    companyName: v.companyName,
    slug: v.slug,
    isVerified: v.verificationStatus === "VERIFIED",
    rubro: v.category?.name || v.businessCategory?.name || null,
    zone: loc?.province ? `${loc.municipality?.name ? `${loc.municipality.name}, ` : ""}${loc.province.name}` : null,
  };
}

// --- Consulta de pedidos (cross-tienda) --------------------------------------

// Bloque 31: mismo mecanismo que lookupOrderContext en chat.controller.js,
// pero SIN vendorId — el bot general puede ver pedidos de CUALQUIER tienda
// que pertenezcan a este cliente (por su email de sesión si está logueado,
// o el email/código que escriba). Mismo criterio de privacidad: nunca se
// exponen teléfono/dirección, solo código/estado/ítems/total/fecha.
const ORDER_STATUS_LABEL = { NEW: "Pendiente", PREPARING: "Vendido/Confirmado", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Rechazado" };
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const ORDER_CODE_REGEX = /\bZ-[A-Z0-9]{4,}\b/i;

// Bloque 42 (optimización de tokens): los documentos que sube el admin
// (AdminAssistant.jsx) son lo más caro del prompt y la mayoría de los
// mensajes ("hola", "busco audífonos") no los necesitan para nada. Se
// mandan SOLO cuando el mensaje ACTUAL toca un tema probable de esos
// documentos (políticas/planes/verificación/horarios/FAQ) — detección
// simple por palabras clave, mismo estilo que extractSearchTerms de
// arriba. Duplicado a propósito respecto a chat.controller.js (mismo
// criterio de siempre: los dos bots son hermanos independientes).
const DOC_RELEVANCE_REGEX =
  /pol[ií]tica|garant[ií]a|devoluci[oó]n|reembolso|env[ií]o|entrega|horario|atienden|abren|cierran|faq|preguntas frecuentes|reclamo|cambio|factura|t[eé]rminos|condiciones|privacidad|plan|verificaci[oó]n|verificad|suscripci[oó]n|vender|registr/i;

function messageNeedsDocument(message) {
  return DOC_RELEVANCE_REGEX.test(message);
}

async function resolveSessionEmail(userId) {
  if (!userId) return null;
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
  return user?.email ?? null;
}

// Sin esto, CUALQUIER mensaje de un cliente logueado (ej. "busco
// audífonos") dispararía una consulta de pedidos de fondo solo por tener
// sessionEmail disponible — el email de sesión únicamente se usa como
// fallback si el mensaje realmente parece una pregunta de pedido; un
// email/código escrito a mano en el texto siempre dispara la búsqueda
// igual, sin importar las palabras alrededor (señal inequívoca).
const ORDER_INTENT_REGEX = /pedido|orden(?!ar)|compra|confirmaci[oó]n|env[ií]o|entrega/i;

// Bloque 184 (auditoría de seguridad — hallazgo confirmado): esta ruta es
// PÚBLICA (assistant.routes.js, sin authenticate). Antes, el email escrito a
// mano en el texto tenía PRIORIDAD sobre el email de la sesión y se usaba
// tal cual en el `where`, sin compararlo con quién está preguntando. Es
// decir: cualquiera, sin login, escribiendo "estado del pedido de
// victima@gmail.com" recibía los últimos 5 pedidos de esa persona —
// código, tienda, estado, total y fecha — en cualquier tienda del
// marketplace, además de servir de oráculo para saber si un correo tiene
// cuenta acá. De ahora en más un email SOLO consulta pedidos si es el de la
// propia sesión; para un invitado, la única llave válida es el código de
// pedido (que es el dato secreto que recibió por correo).
function resolveOrderLookupEmail(message, sessionEmail) {
  const typedEmail = message.match(EMAIL_REGEX)?.[0]?.toLowerCase() ?? null;
  const ownEmail = sessionEmail?.trim().toLowerCase() ?? null;

  if (typedEmail) {
    return typedEmail === ownEmail ? { email: ownEmail } : { email: null, foreign: true };
  }
  return { email: ORDER_INTENT_REGEX.test(message) ? ownEmail : null };
}

async function lookupOrderContext(message, sessionEmail) {
  const codeMatch = message.match(ORDER_CODE_REGEX);
  const { email, foreign } = resolveOrderLookupEmail(message, sessionEmail);

  if (foreign && !codeMatch) {
    return `CONSULTA DE PEDIDO: el cliente escribió un correo que NO es el de la sesión con la que está hablando, así que no se consultó nada — los pedidos de otra persona no se muestran nunca. Pedile amablemente que inicie sesión con ese correo y revise "Mis Pedidos", o que te pase el número de pedido (formato Z-XXXX) que le llegó por correo. No inventes ningún estado.`;
  }
  if (!email && !codeMatch) return null;

  const or = [];
  if (email) or.push({ customerEmail: { equals: email, mode: "insensitive" } });
  if (codeMatch) or.push({ code: { equals: codeMatch[0].toUpperCase() } });

  const orders = await prisma.order.findMany({
    where: { OR: or },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { items: true, vendor: { select: { companyName: true } } },
  });

  if (orders.length === 0) {
    return `CONSULTA DE PEDIDO: el cliente preguntó por un pedido (email/número "${email ?? codeMatch[0]}") pero NO se encontró ningún pedido con ese dato en ninguna tienda. Dilo claramente — recién ahí, y solo ahí, sugiere revisar "Mis Pedidos" en su cuenta o contactar soporte. Nunca inventes un estado.`;
  }

  // Bloque 31: bug real encontrado en vivo — con VARIOS pedidos (este bot
  // agrega de CUALQUIER tienda, a diferencia del bot de tienda que casi
  // siempre tiene 0-1 pedido por cliente), el detalle de ítem-por-ítem de
  // cada uno hacía que la respuesta se cortara a mitad de camino por el
  // límite de tokens de salida (350) antes de listarlos todos. Formato
  // compacto (sin enumerar cada producto) para que SIEMPRE entren los 5.
  const lines = orders.map(
    (o) => `${o.code} (${o.vendor.companyName}): "${ORDER_STATUS_LABEL[o.status]}", ${o.items.length} prod., ${fmtCUP(o.total)}, ${new Date(o.createdAt).toLocaleDateString("es-CU")}.`
  );
  return `CONSULTA DE PEDIDO: el cliente preguntó por su pedido. Pedido(s) encontrado(s) con ese email/número (única fuente de verdad, no agregues ni cambies nada — puede haber pedidos de distintas tiendas):\n${lines.join("\n")}`;
}

// --- Prompt del bot general --------------------------------------------------

// Bloque 37 (Parte B5 — bug real reportado: respuestas genéricas de folleto
// sin datos concretos para "¿cuáles son los planes?", "cómo vender", "crear
// tienda"): antes esto dependía 100% de que el admin hubiera subido un
// documento con esta info (AdminAssistant.jsx) — si no lo subió, el modelo
// caía en frases genéricas de su propio entrenamiento en vez de admitir que
// no sabía. Esto fija como CONTENIDO DE REFERENCIA REAL (mismo criterio que
// el catálogo: el modelo lo consulta, nunca lo inventa) los datos reales de
// planes/verificación ya visibles en el sitio (PlanComparisonModal.jsx,
// Faq.jsx, VendorVerification.jsx) — así la respuesta es siempre concreta
// exista o no un documento adicional del admin.
const buildZeudinReference = (siteName) => `CÓMO FUNCIONA ${siteName.toUpperCase()} (referencia fija real — cita estos datos concretos cuando pregunten por planes/vender/verificación, nunca inventes otros ni respondas solo con frases genéricas de folleto):
- Cómo comprar: eliges productos de cualquier tienda del marketplace y coordinas el pedido con esa tienda (WhatsApp o panel, según cómo la tienda reciba pedidos). El carrito de ${siteName} admite productos de UNA sola tienda por pedido.
- Cómo vender / crear tienda: te registras como vendedor en ${siteName} (botón "Vender gratis"/"/vender"), cargas los datos de tu negocio y arrancas automáticamente en el Plan Regular, gratis. Puedes pasar a Business cuando quieras desde tu panel.
- Plan Regular (gratis): hasta 20 productos publicados, pedidos solo por WhatsApp, hasta 10 emails manuales a clientes por mes. Sin badge de verificación ni destacado en home.
- Plan Business (2500 CUP/mes): productos ilimitados, pedidos por WhatsApp o panel propio, emails ilimitados a clientes, badge de tienda verificada, tienda destacada en la home, recomendaciones con IA (este chat) y horarios de atención configurables.
- Verificación (badge): desde el panel del vendedor, sección "Verificación", subes una foto tuya y de tu documento de identidad. Un admin de ${siteName} revisa la documentación manualmente; si la aprueba, eliges cómo pagar la suscripción Business (tarjeta o transferencia CUP) y al confirmarse el pago la tienda queda verificada. El badge de "verificada" significa eso — una revisión de identidad real y suscripción activa, no una calificación de calidad de sus productos.
- Medios de pago entre comprador y vendedor: cada tienda define los suyos (efectivo, transferencia, Zelle, USDT, tarjeta, etc. — ver DATOS DEL NEGOCIO/TIENDAS de cada una); ${siteName} no procesa esos pagos, solo cobra la suscripción Business al vendedor.`;

// Bloque 42: los documentos admin (igual que el .txt/PDF de cada tienda en
// chat.controller.js) solo viajan en el prompt cuando el mensaje ACTUAL
// parece necesitarlos (preguntas de política/plan/verificación/etc. — ver
// messageNeedsDocument) — un saludo o "quiero comprar X" no los carga. Corte
// de 20000 a 5000 chars por el mismo motivo: son el ítem más caro del
// prompt y casi nunca hace falta el documento completo para responder.
async function loadAdminDocsParts(message) {
  if (!messageNeedsDocument(message)) return [];
  const documents = await prisma.assistantDocument.findMany({ orderBy: { createdAt: "desc" } });
  const parts = [];
  for (const doc of documents) {
    try {
      const filepath = join(ASSISTANT_DOC_DIR, doc.filename);
      if (doc.filename.toLowerCase().endsWith(".txt")) {
        const text = await readFile(filepath, "utf-8");
        parts.push({ text: `\nDocumento "${doc.originalName}" (info de la plataforma):\n${text.slice(0, 5000)}` });
      } else if (doc.filename.toLowerCase().endsWith(".pdf")) {
        const buffer = await readFile(filepath);
        parts.push({ inlineData: { mimeType: "application/pdf", data: buffer.toString("base64") } });
      }
    } catch {
      // Documento no legible (borrado del disco a mano, etc.) — el bot
      // sigue andando solo con el catálogo, no corta la conversación.
    }
  }
  return parts;
}

// Bloque 28/30: mismo criterio de brevedad/anti-alucinación de siempre, acá
// adaptado a un bot que NO pertenece a una tienda — busca en todo el
// marketplace y nunca ejecuta ninguna acción de carrito (a diferencia del
// bot de tienda), solo recomienda y deja que el cliente haga click a la
// tienda/producto real para agregar.
// Bloque 32: suma "zoneContext" (Filtros detectados + Zona pedida + ZONAS
// con stock real, ver buildZoneContext) — mismo criterio de siempre: la
// data real la resuelve el backend con consultas reales, el modelo solo
// decide QUÉ PREGUNTAR o mostrar en base a eso, nunca inventa una zona o
// stock que no esté en ese bloque.
async function buildMarketplaceSystemParts(candidates, orderContext, zoneContext, vendorContext, message) {
  const fewShot = await buildFewShotBlock("GENERAL");
  const { siteName } = await getBrandSettings();
  const parts = [
    {
      // Bloque 31: CONSULTA DE PEDIDO va PRIMERO que cualquier otra cosa —
      // mismo fix que chat.controller.js (Bloque 30): con este bloque más
      // abajo, el modelo (Groq 8B) llegó a contradecir datos reales ya
      // resueltos acá. Un modelo chico le presta más atención a lo que lee
      // primero.
      text: `${orderContext ? `${orderContext}\n\n` : ""}Eres el asistente de compras de ${siteName}, un marketplace de tiendas en Cuba — NO representas una tienda puntual, ayudas a encontrar el producto ideal en TODO el marketplace y a entender cómo funciona la plataforma.

CANDIDATOS encontrados para esta búsqueda (número de catálogo entre corchetes, único válido — nunca inventes otro; cada uno ya incluye su zona real y variantes reales si tiene):
${candidatesText(candidates)}

TIENDAS encontradas para esta búsqueda/zona (única fuente real sobre tiendas — nombre, si está verificada o no, rubro y zona; usa esto para CUALQUIER pregunta sobre tiendas/verificación, nunca la búsqueda de productos de arriba para eso):
${vendorContext}

${zoneContext}

${buildZeudinReference(siteName)}

REGLAS:
- Idioma: español latinoamericano neutro (como se habla en Cuba) — NUNCA modismos ni gramática de España (nunca "vosotros"/"vuestro", "vale", "tío/tía", "coger" en el sentido de agarrar/tomar, "ordenador", "móvil" en vez de "celular", "vais", etc.).
- Alcance: SOLO productos/tiendas de ${siteName} (los de arriba) e información general de la plataforma (qué es, cómo comprar, cómo vender, verificación, planes, medios de pago) usando CÓMO FUNCIONA ${siteName.toUpperCase()} de arriba y los documentos adjuntos si hay — responde siempre con esos datos concretos (nombre del plan, precio, qué incluye, pasos reales), NUNCA una respuesta genérica de folleto que no diga nada concreto. Nunca temas ajenos: si preguntan otra cosa, dilo breve y amable, sin responder el tema en sí.
- Breve: 1-2 líneas por defecto, directo, simple y profesional — sin relleno, sin exclamaciones de más.
- NUNCA asumas la ubicación propia del cliente: "provincia"/"zona"/"municipio" de la TIENDA (en TIENDAS/candidatos) es un dato de esa tienda, no del cliente. Si el cliente dice "mi provincia"/"mi zona"/"donde vivo"/"cerca de mí" SIN nombrarla, jamás la copies de un ejemplo, de una tienda listada o de tu propia respuesta anterior — pregunta explícitamente cuál es (una sola vez; si ya la preguntaste y no la contestó, no la vuelvas a asumir, insiste la pregunta o muestra resultados sin filtro de zona). "Zona pedida por el cliente en esta charla" arriba es la ÚNICA fuente válida de qué ubicación dio el cliente — si dice "(el cliente no especificó ubicación todavía)", trátalo como TAL, ni una tienda/zona puntual.
- NUNCA te contradigas dentro de la misma charla: si en un turno anterior confirmaste que existen tiendas/productos reales (los de TIENDAS/CANDIDATOS de arriba), nunca digas después "no tengo información" o "no encontramos nada" para ese mismo dato — si lo que falta es la ubicación del cliente, vuelve a pedirla o muestra los resultados reales ya disponibles (sin filtro de zona, ya que esa zona sigue sin saberse), pero nunca niegues datos reales que ya mostraste.
- NUNCA repitas la misma pregunta, chip o frase (aunque cambies alguna palabra) que ya usaste en un turno anterior de ESTA charla — relee el historial antes de responder. Si el cliente ya dio un dato (ubicación, precio, color, producto), no lo vuelvas a pedir salvo que él mismo lo cambie explícitamente. Cada pregunta tuya es UNA sola cosa concreta, nunca dos juntas en el mismo mensaje.
- Nunca inventes productos, tiendas, precios, stock, zonas ni políticas fuera de los candidatos/TIENDAS/ZONAS de arriba o los documentos adjuntos. Si no hay nada bueno para lo que piden, dilo y sugiere reformular la búsqueda o intentar con otra palabra — nunca digas "no hay resultados" de forma genérica sin haber mirado TIENDAS también si la pregunta pudiera ser sobre tiendas.
- Si la pregunta del cliente no tiene respaldo en ningún dato real de arriba (ni candidatos, ni TIENDAS, ni ZONAS, ni CÓMO FUNCIONA ZEUDIN, ni documentos adjuntos) y no hay forma de responderla con algo real: NUNCA inventes una respuesta ni afirmes/niegues algo que no sabes. Di que no entendiste bien lo que pide y pídele que reformule o explique mejor qué está buscando — nunca un "no sé" seco ni una respuesta a medias sobre algo que no verificaste.
- Preguntas sobre TIENDAS (verificadas, de qué rubro, en qué zona, si existe tal tienda): responde con "TIENDAS" de arriba, nunca con la búsqueda de productos. Si el bloque de TIENDAS está vacío, dilo claro — nunca inventes un nombre de tienda.
- TARJETA DE TIENDA vs. BOTÓN "ver todas" (pedido explícito — nunca listes cada nombre de tienda dentro de "text" cuando el pedido es amplio): si el cliente pregunta por UNA tienda puntual (la nombra, o queda una sola clara tras filtrar por zona/rubro/verificada), cita SOLO ese número en "vendorIds" (muestras su tarjeta) y mantén "text" breve, sin repetir el nombre completo con todos los detalles (eso ya lo muestra la tarjeta). Si el pedido es amplio ("mostrame tiendas", "ver tiendas", "qué tiendas hay") y "TIENDAS" tiene VARIAS (más de 2-3): NUNCA enumeres cada nombre en "text" — responde corto y profesional (ej. "Tenemos varias tiendas disponibles — mira el catálogo completo.") y pon "showAllStoresButton": true (el botón real lleva a /tiendas). Si son pocas (2-3) y relevantes a lo pedido, puedes citarlas en "vendorIds" en vez del botón. Nunca los dos casos a la vez.
- Prefiere responder directo antes que preguntar: si con los datos que ya tienes (candidatos, tiendas o zonas de arriba) hay una respuesta razonable y clara, responde ya — no acumules preguntas de aclaración innecesarias. Pregunta SOLO cuando de verdad haga falta para no dar una respuesta equivocada (ver FILTRADO PROGRESIVO abajo, que sigue aplicando para el caso específico de ubicación/atributo de producto).
- FILTRADO PROGRESIVO: si el pedido no da todos los datos para acotar bien (ubicación, precio, tamaño, marca, color), pregunta de a UN dato por vez, breve — nunca varias preguntas juntas en el mismo mensaje. Chequea estos casos EN ESTE ORDEN (el primero que aplique gana, no sigas a los de abajo):
  1) Si "Filtros detectados" arriba muestra un rango de precio (no dice "sin rango de precio"): el cliente YA fue específico, así que muestra YA los candidatos reales que matchean (citando sus números en productIds) — NUNCA preguntes provincia/municipio en este caso, aunque "ZONAS" tenga varias provincias. Si entre esos candidatos siguen quedando 2+ productos distintos entre sí (no la misma zona, sino modelos/marcas distintas), recién ahí pregunta UN atributo más (marca o color, usando "variantes:" real) para acotar — nunca preguntes ubicación en su lugar.
  2) Si NO se cumple el caso 1 (sin rango de precio) y el cliente no dio ubicación, y "ZONAS" muestra stock en MÁS DE UNA provincia: pregunta primero la provincia, todavía sin mostrar tarjetas.
  3) Si ya hay una provincia (dada ahora o antes en esta misma charla — ver "Zona pedida") y esa provincia en "ZONAS" tiene stock en MÁS DE UN municipio: pregunta el municipio (ofrece la capital y los municipios reales listados), todavía sin mostrar tarjetas.
  4) Si con los datos ya conocidos hay un único resultado claro (una sola zona, o ya no queda ambigüedad de producto): responde directo con su tarjeta, sin preguntar nada más.
  5) Si piden filtrar por un atributo (ej. "en negro") sin haber dicho qué producto buscan: pregunta primero qué producto es, nunca asumas ni busques con eso solo.
  · Variantes reales vs. pedidas: si el cliente pregunta por 2+ opciones de un atributo (ej. "en negro o marrón") y "variantes:" de un candidato solo lista ALGUNA de esas opciones, dilo explícito (cuál sí hay y cuál no) — nunca digas solo "tenemos uno" sin aclarar de qué color/variante es.
- FALLBACK GEOGRÁFICO: si "ZONAS" marca que la zona pedida por el cliente (municipio o provincia) NO tiene stock, pero sí aparece en otro municipio de la misma provincia o en una provincia marcada como "VECINA": dilo con claridad — nombra la zona real donde SÍ hay y la tienda real de los candidatos de arriba — y sugiere que el cliente la contacte para coordinar. NUNCA prometas envío en nombre de una tienda (tú no confirmas logística, solo sugieres contactar). Si "ZONAS" no tiene ninguna zona con stock (ni cercana), dilo directo y claro, sin inventar una alternativa.
- SIN acción de carrito: tú solo recomiendas y muestras tarjetas de producto — nunca dices "te lo agrego" ni ninguna variante, porque tú no agregas nada. Siempre invita a "verlo" o "agregarlo desde la tienda" (el click en la tarjeta ya lleva ahí).
- Carrito de una sola tienda: el carrito de ${siteName} admite productos de UNA sola tienda por pedido. Si el cliente pide productos de dos tiendas distintas en la misma conversación, explícaselo breve y ofrece completar el pedido de una primero y después ir a la otra — nunca intentes "juntarlos".
- REGLA ESTRICTA: si "text" menciona, describe o dice que encontraste candidatos/productos (aunque sea de forma genérica, ej. "tenemos varios modelos"), SIEMPRE tienes que citar sus números en productIds — nunca digas que hay resultados sin citarlos. Si "text" no menciona ningún producto puntual (ej. preguntaste la provincia y todavía no mostraste nada), productIds va vacío.
- Si preguntan por el estado de un pedido: si arriba de todo aparece "CONSULTA DE PEDIDO", ESE es el resultado real y actual — úsalo tal cual, nunca digas "no encontré" si ahí hay pedido(s) listados, y nunca lo confundas con otro. Si NO aparece "CONSULTA DE PEDIDO" arriba y preguntan por un pedido, pide el email o número de confirmación para buscarlo — NUNCA derives directo a "revisa tu cuenta"/"Mis Pedidos" sin haber intentado buscarlo primero con esos datos.

${fewShot}

SALIDA (JSON): {"text": "...", "productIds": ["N"], "addToCart": [], "removeFromCart": [], "clearCart": false, "vendorIds": ["N"], "showAllStoresButton": false, "suggestedFollowUps": ["...", "..."]}
- text: prosa natural, en tus palabras — nunca el número de catálogo ni ningún ID.
- productIds: números de catálogo (entre corchetes arriba, ej. "3") de los candidatos que mencionas o recomiendas — para mostrar su tarjeta. Vacío si ninguno puntual (ej. solo preguntaste zona/atributo).
- addToCart/removeFromCart/clearCart: SIEMPRE vacío/false — este bot nunca toca el carrito (eso es del bot de cada tienda).
- vendorIds: número(s) de TIENDAS (entre corchetes arriba, ej. "2") cuando el pedido es sobre una tienda puntual o unas pocas (2-3) relevantes — muestra su tarjeta real. Vacío si el pedido es amplio (ahí va showAllStoresButton) o si no hay ninguna tienda puntual que mostrar.
- showAllStoresButton: true SOLO cuando el pedido de tiendas es amplio ("ver tiendas", "mostrame tiendas") y hay más de 2-3 en TIENDAS — muestra un botón real a /tiendas en vez de que tú listes cada nombre. false en cualquier otro caso, y siempre false si vendorIds no está vacío.
- suggestedFollowUps: SIEMPRE 2-3 preguntas cortas (3-6 palabras cada una) que el cliente podría preguntar A CONTINUACIÓN de ESTA respuesta puntual — tienen que variar según lo que acabas de responder, nunca las mismas siempre. Básate en lo real (otros candidatos, zonas, categorías), nunca inventes algo sin sentido acá.
- Ejemplo — resultado único y claro (número inventado): candidato [1] es justo lo que piden y no hay ambigüedad de zona/producto → {"text": "Tenemos justo eso — [nombre real del producto, sin el número] de [tienda]. ¿Quieres verlo?", "productIds": ["1"], "addToCart": [], "suggestedFollowUps": ["Ver más opciones similares", "¿Hace envíos esa tienda?", "Buscar otra cosa"]}
- Ejemplo — YA dio precio/tamaño junto con el producto (número inventado): "Filtros detectados" muestra un rango de precio, y "ZONAS" tiene 2+ provincias con candidatos [1] y [2] que son productos/marcas distintos entre sí → muestra ambos YA, sin preguntar provincia: {"text": "Encontramos estas opciones en ese rango — [nombre real de 1] de [tienda 1] y [nombre real de 2] de [tienda 2]. ¿Alguna marca o color en particular?", "productIds": ["1", "2"], "addToCart": [], "suggestedFollowUps": ["Ver más opciones", "Filtrar por precio", "¿Cuál tiene mejor reseña?"]}
- Ejemplo — pidió 2 variantes y solo hay una real (número inventado): preguntan "en negro o marrón" y el candidato [1] solo lista "variantes: Color(Negro)" → {"text": "Tenemos [nombre real de 1] en negro, pero no en marrón. ¿Te sirve en negro?", "productIds": ["1"], "addToCart": [], "suggestedFollowUps": ["Sí, en negro", "Buscar en marrón en otra tienda", "Ver otras opciones"]}
- Ejemplo — falta ubicación, varias provincias con stock, SIN precio/tamaño dado: "ZONAS" muestra 2+ provincias y "Zona pedida"/"Filtros detectados" dicen que el cliente no especificó nada más → {"text": "Tenemos varias opciones — ¿en qué provincia estás para mostrarte la más cercana?", "productIds": [], "addToCart": [], "suggestedFollowUps": ["La Habana", "Santiago de Cuba", "Otra provincia"]}
- Ejemplo — provincia dada, varios municipios con stock: "Zona pedida" ya tiene provincia y esa provincia lista 2+ municipios en "ZONAS" → {"text": "¿Eres de la capital o de alguno de los municipios? Tenemos en [nombres reales de los municipios listados].", "productIds": [], "addToCart": [], "suggestedFollowUps": ["La capital", "[nombre real de un municipio listado]", "Otro municipio"]}
- Ejemplo — fallback geográfico: "ZONAS" marca la zona pedida con "SIN stock" pero otra provincia figura como "VECINA" con resultados → {"text": "En tu zona no encontramos stock ahora mismo, pero sí en [tienda real] de [provincia vecina real] — puedes contactarla para ver si coordina el envío.", "productIds": ["2"], "addToCart": [], "suggestedFollowUps": ["Ver esa tienda", "Buscar otra alternativa", "Buscar algo distinto"]}
- Ejemplo — pregunta sobre tiendas verificadas, POCAS reales (hasta 3, NO es una búsqueda de producto, nunca digas "sin resultados" acá): preguntan "¿qué tiendas están verificadas?" y "TIENDAS" lista 3 reales → cítalas por número, texto corto (la tarjeta ya muestra el nombre/zona/rubro, no los repitas todos en el texto): {"text": "Tenemos estas tiendas verificadas — mira sus fichas.", "productIds": [], "vendorIds": ["1", "2", "3"], "showAllStoresButton": false, "suggestedFollowUps": ["Ver por rubro", "Buscar en una zona", "Buscar un producto"]}. Si "TIENDAS" viniera vacío, en cambio: {"text": "Por ahora no encontramos tiendas verificadas para esta zona/búsqueda.", "productIds": [], "vendorIds": [], "showAllStoresButton": false, "suggestedFollowUps": ["Buscar en otra zona", "Ver todas las tiendas", "Buscar un producto"]}
- Ejemplo — pedido AMPLIO de tiendas, MUCHAS reales (bug real ya visto: nunca enumeres 5+ nombres en el texto): preguntan "mostrame las tiendas"/"ver tiendas" y "TIENDAS" lista 7 reales → nunca las nombres todas, usa el botón: {"text": "Tenemos varias tiendas disponibles en ${siteName} — mira el catálogo completo.", "productIds": [], "vendorIds": [], "showAllStoresButton": true, "suggestedFollowUps": ["Buscar por rubro", "Buscar por zona", "Buscar un producto"]}
- Ejemplo — el cliente dice "en mi provincia"/"mi zona" SIN nombrarla (bug real ya visto: nunca asumas cuál es): responde "En mi provincia" a la pregunta de zona/rubro de arriba → NUNCA elijas una provincia de las que aparecen en TIENDAS/candidatos y se la atribuyas al cliente. Responde: {"text": "Cuéntame en qué provincia estás para mostrarte las tiendas de ahí.", "productIds": [], "vendorIds": [], "showAllStoresButton": false, "suggestedFollowUps": ["[nombre real de una provincia con tiendas listadas arriba]", "[otro nombre real de provincia listada]", "Ver todas las tiendas"]}
- Ejemplo — el cliente corrige/objeta algo que ya dijiste (anti-contradicción, bug real ya visto): en un turno anterior ya mostraste tiendas/productos reales de TIENDAS/CANDIDATOS, y ahora el cliente dice algo como "yo no te dije esa provincia" o corrige un dato → NUNCA respondas "no tengo información" (eso niega datos reales que tú mismo ya mostraste). Reconoce el malentendido brevemente y, como la ubicación del cliente sigue sin saberse, o vuelve a preguntarla o muestra de nuevo los resultados reales YA disponibles arriba sin filtro de zona: {"text": "Tienes razón, disculpa — no me dijiste tu provincia. ¿Cuál es?", "productIds": [], "vendorIds": [], "showAllStoresButton": false, "suggestedFollowUps": ["[nombre real de una provincia con tiendas listadas arriba]", "[otro nombre real de provincia listada]", "Ver todas las tiendas"]}
- Ejemplo — pregunta por UNA tienda puntual (la nombra o queda una sola clara): preguntan "¿tienen la tienda TecnoHabana?" y "TIENDAS" lista esa tienda como [1] → {"text": "Sí, tenemos TecnoHabana — mira su ficha.", "productIds": [], "vendorIds": ["1"], "showAllStoresButton": false, "suggestedFollowUps": ["Ver sus productos", "¿Está verificada?", "Buscar otra tienda"]}`,
    },
  ];
  parts.push(...(await loadAdminDocsParts(message)));
  return parts;
}

// --- Endpoint principal ------------------------------------------------------

function resolveOptionalUserId(req) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  if (!token) return null;
  try {
    // Mismo criterio que middleware/auth.js (auditoría de seguridad): fija
    // el algoritmo esperado en vez de confiar en el "alg" del propio token.
    return jwt.verify(token, env.jwtSecret, { algorithms: ["HS256"] }).sub;
  } catch {
    return null;
  }
}

const postMessageSchema = z.object({
  sessionId: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1, "Escribe una pregunta.").max(1000),
});

export async function postMarketplaceChatMessage(req, res) {
  const { sessionId, message } = postMessageSchema.parse(req.body);
  const userId = resolveOptionalUserId(req);

  const recent = await prisma.marketplaceChatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "desc" }, take: HISTORY_LIMIT });
  const history = isSessionExpired(recent[0]) ? [] : recent.reverse();

  await prisma.marketplaceChatMessage.create({ data: { sessionId, userId, role: "user", content: message } });

  // Bloque 31: si está logueado, se usa SU email de sesión automáticamente
  // (nunca hay que pedírselo) — si además escribió un email/código propio
  // en el mensaje, ese tiene prioridad (ver lookupOrderContext).
  const sessionEmail = await resolveSessionEmail(userId);
  const orderContext = await lookupOrderContext(message, sessionEmail);

  // Bloque 33: de acá para abajo es todo lo que puede fallar por un
  // problema técnico real (búsqueda de catálogo, proveedor de IA caído,
  // timeout, etc.) — nunca se le muestra el error real al cliente: se
  // registra en ErrorLog (visible solo en Admin > Errores) y se responde
  // con una señal genérica y estable que el frontend usa para mostrar la
  // tarjeta de "problemas técnicos" + Reintentar. El mensaje del cliente YA
  // quedó guardado arriba, así que "Reintentar" en el frontend es
  // simplemente volver a mandar el mismo texto.
  let rawText, productIds, candidates, vendorMatches, vendorIds, showAllStoresButton, suggestedFollowUps;
  try {
    // Bloque 32: filtrado geográfico progresivo — la zona pedida se
    // reconstruye del mensaje actual O, si este mensaje es solo una
    // respuesta breve ("Segundo Frente"), del historial reciente (ver
    // resolveZoneFromContext). Mismo criterio para qué se busca
    // (resolveSearchContext): si el mensaje actual no trae ningún término
    // de producto propio, se reusa el del último mensaje del cliente que sí
    // tenía uno — pero si trae uno nuevo ("mejor un freezer"), ese manda y
    // no arrastra el filtro anterior.
    const { province: requestedProvince, municipality: requestedMunicipality } = await resolveZoneFromContext(message, history);
    const { terms, priceMin, priceMax, broadListing } = resolveSearchContext(message, history, requestedProvince, requestedMunicipality);

    const pool = await searchCandidateProducts(terms, { priceMin, priceMax, broadListing });
    const adjacentIds = requestedProvince ? await getAdjacentProvinceIds(requestedProvince.id) : [];
    const zoneContext = buildZoneContext({ terms, priceMin, priceMax, products: pool, requestedProvince, requestedMunicipality, adjacentIds });
    candidates = prioritizeByZone(pool, requestedProvince, requestedMunicipality, adjacentIds).slice(0, CANDIDATE_LIMIT);

    // Bloque 34: búsqueda de TIENDAS siempre en paralelo a la de productos
    // — nunca depende de "detectar" si la pregunta es sobre tiendas (más
    // simple y más robusto: el modelo ve datos reales de ambas tablas y
    // decide cuál corresponde, en vez de que un clasificador de intención
    // a mano se equivoque y deje al modelo sin nada real que mostrar).
    vendorMatches = await searchVendors({
      terms,
      provinceId: requestedProvince?.id,
      municipalityId: requestedMunicipality?.id,
      onlyVerified: wantsVerifiedOnly(message),
    });

    const systemParts = await buildMarketplaceSystemParts(candidates, orderContext, zoneContext, vendorsText(vendorMatches), message);
    ({ text: rawText, productIds, vendorIds, showAllStoresButton, suggestedFollowUps } = await chatWithStoreAssistant({ systemParts, history, message }));
  } catch (err) {
    await logError({
      origin: "BOT_GENERAL",
      message: err instanceof Error ? err.message : String(err),
      context: { sessionId, userId, statusCode: err?.statusCode, detail: err?.details?.detail },
    });
    return res.status(503).json({ error: "chat_unavailable" });
  }

  const text = rawText
    .replace(/\[ID:[a-z0-9]+\]/gi, "")
    .replace(/\[\d{1,3}\]/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,;:])/g, "$1")
    .trim();

  const candidateByIndex = new Map(candidates.map((p, i) => [String(i + 1), p]));
  const validIds = [...new Set((productIds ?? []).map(String))]
    .map((idx) => candidateByIndex.get(idx))
    .filter(Boolean)
    .map((p) => p.id);

  const saved = await prisma.marketplaceChatMessage.create({ data: { sessionId, role: "model", content: text, productIds: validIds } });
  const candidateById = new Map(candidates.map((p) => [p.id, p]));
  const products = validIds.map((id) => toCardProduct(candidateById.get(id)));

  // Bloque 41 (pedido explícito): tarjeta(s) de tienda puntual — nunca se
  // persisten (mismo criterio que productIds del bot general: de un solo
  // uso para este mensaje). Igual que arriba, un número fuera de rango
  // simplemente no resuelve a nada, nunca se inventa una tienda.
  const vendorByIndex = new Map(vendorMatches.map((v, i) => [String(i + 1), v]));
  const MAX_VENDOR_CARDS = 3;
  const resolvedVendors = [...new Set((vendorIds ?? []).map(String))]
    .map((idx) => vendorByIndex.get(idx))
    .filter(Boolean)
    .map(toVendorCard);
  // Bug real encontrado en vivo: pese a la regla del prompt ("más de 2-3 ->
  // botón"), el modelo a veces igual citó 10 tiendas en vendorIds en vez de
  // usar el botón — nunca confiar en que el modelo cumplió el umbral pedido,
  // se corrige acá (mismo criterio de siempre: el backend valida, nunca
  // confía a ciegas en la decisión del modelo).
  const validVendors = resolvedVendors.length > MAX_VENDOR_CARDS ? [] : resolvedVendors;
  const forcedShowAllButton = resolvedVendors.length > MAX_VENDOR_CARDS;

  // Bloque 34: sugerencias de seguimiento — nunca se persisten (de un solo
  // uso para este mensaje puntual). Nunca confiar en que el modelo cumplió
  // el límite/formato pedido: se sanitiza acá antes de que el cliente las
  // vea (máx 3, string no vacío).
  const followUps = (Array.isArray(suggestedFollowUps) ? suggestedFollowUps : [])
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => cleanFollowUp(s))
    .filter(Boolean)
    .slice(0, 3);

  res.status(201).json({
    message: { ...saved, products, vendors: validVendors, showAllStoresButton: forcedShowAllButton || showAllStoresButton === true, suggestedFollowUps: followUps },
  });
}

const historyQuerySchema = z.object({ sessionId: z.string().trim().min(1).max(100) });

export async function getMarketplaceChatHistory(req, res) {
  const { sessionId } = historyQuerySchema.parse(req.query);
  const messages = await prisma.marketplaceChatMessage.findMany({ where: { sessionId }, orderBy: { createdAt: "asc" } });

  if (isSessionExpired(messages[messages.length - 1])) return res.json({ messages: [], expired: true });

  const allProductIds = [...new Set(messages.flatMap((m) => m.productIds ?? []))];
  const products = allProductIds.length
    ? await prisma.product.findMany({
        where: { id: { in: allProductIds } },
        select: { id: true, name: true, slug: true, price: true, images: true, stock: true, unlimitedStock: true, vendor: { select: CANDIDATE_VENDOR_SELECT } },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const messagesWithProducts = messages.map((m) => ({
    ...m,
    products: (m.productIds ?? []).map((id) => productById.get(id)).filter(Boolean).map(toCardProduct),
  }));

  res.json({ messages: messagesWithProducts });
}
