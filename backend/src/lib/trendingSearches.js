import { Prisma } from "@prisma/client";
import { prisma } from "./prisma.js";
import { vendorZoneWhere } from "./vendorZone.js";

// "Lo más buscado" de la portada: palabras cortas de referencia que salen de los productos de las tiendas (etiquetas, nombres y
// categorías de lo que se vende) y de las búsquedas reales de los clientes, ordenadas por ventas, visitas y búsquedas. Se
// descartan las groserías y datos personales, y solo se muestran las que llevan a productos disponibles. No intervienen IA ni
// frases redactadas. El resultado se guarda en SiteSettings.trendingSearches y se renueva cada pocas horas; la portada solo lee
// ese resumen guardado.

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

// Lista de raíces ofensivas, sexuales, de odio o ilegales. Se compara sobre el texto sin tildes y por palabra completa o prefijo.
const BLOCKED = /\b(put[oa]s?|puter|mierd|co[nñ]o|pendej|cabron|verga|pija|polla|follar|culo|marica|maricon|negr[oa] de|nigg|fag|porn|sexo|sexual|xxx|escort|prostitu|droga|cocaina|marihuana|crack|armas? de fuego|pistola|fusil|explosivo|suicid|matar|violacion|pedofil|terroris|nazi|hitler|estafa|hack(?:ear|eo)?)/;
const MAX_TERMS = 12;
const REFRESH_MS = 6 * 60 * 60 * 1000;
// Sube cuando cambia la forma de armar la lista, para que el resumen guardado con el método anterior se rehaga enseguida.
const SNAPSHOT_VERSION = 2;

export function normalizeSearchTerm(raw) {
  const term = fold(raw);
  if (term.length < 3 || term.length > 40) return null;
  if (term.split(" ").length > 4) return null;
  if (/\d{5,}/.test(term.replace(/ /g, ""))) return null; // teléfonos, carnés, números de tarjeta
  if (!/[a-zñ]{3}/.test(term)) return null;
  if (BLOCKED.test(term)) return null;
  return term;
}

export function isPublicSafeText(text) {
  const t = fold(text);
  return !!t && !BLOCKED.test(t);
}

// Se llama sin esperar (la búsqueda del cliente no debe demorarse por esto) y solo con búsquedas que sí dieron resultados.
export function recordSearchTerm(raw, resultCount) {
  if (!resultCount) return;
  const term = normalizeSearchTerm(raw);
  if (!term) return;
  prisma.searchTerm
    .upsert({
      where: { term },
      create: { term, count: 1, lastSearchedAt: new Date() },
      update: { count: { increment: 1 }, lastSearchedAt: new Date() },
    })
    .catch(() => {});
}

const MAX_WORDS = 3;
const MAX_CHARS = 22;

// Una palabra de referencia sirve para la portada si es corta (nada de frases) y segura para mostrar en público.
function usableTerm(raw) {
  const term = fold(raw);
  if (term.length < 3 || term.length > MAX_CHARS || term.split(" ").length > MAX_WORDS) return null;
  if (!/[a-zñ]{3}/.test(term) || /\d{4,}/.test(term.replace(/ /g, "")) || BLOCKED.test(term)) return null;
  return term;
}

function display(text) {
  const clean = String(text ?? "").replace(/\s+/g, " ").trim();
  return clean.charAt(0).toUpperCase() + clean.slice(1);
}

// Mismo criterio que la búsqueda del catálogo (nombre, descripción o etiqueta, sin tildes ni mayúsculas): una palabra solo se
// muestra si de verdad lleva a productos que se pueden comprar hoy.
// Con un lugar elegido (zone), además la tienda tiene que cubrir ese lugar (misma regla que el catálogo y las tiendas).
function zoneSql({ countryId, provinceId, municipalityId } = {}) {
  if (provinceId) {
    return Prisma.sql`AND EXISTS (SELECT 1 FROM "VendorLocation" vl WHERE vl."vendorId" = v.id AND vl."provinceId" = ${String(provinceId)}${municipalityId ? Prisma.sql` AND vl."municipalityId" = ${String(municipalityId)}` : Prisma.empty})`;
  }
  if (countryId) {
    return Prisma.sql`AND EXISTS (SELECT 1 FROM "VendorLocation" vl LEFT JOIN "Province" pr ON pr.id = vl."provinceId" WHERE vl."vendorId" = v.id AND (vl."countryId" = ${String(countryId)} OR pr."countryId" = ${String(countryId)}))`;
  }
  return Prisma.empty;
}

async function hasVisibleMatch(rawTerm, zone) {
  const term = rawTerm.replace(/ñ/g, "n");
  const zoneFilter = zoneSql(zone);
  const rows = await prisma.$queryRaw`
    SELECT 1 FROM "Product" p
    JOIN "Vendor" v ON v.id = p."vendorId"
    WHERE p."isActive" = true AND p."hiddenFromStore" = false AND p."overQuota" = false
      AND (p."unlimitedStock" = true OR p.stock > 0)
      AND v."isBlocked" = false AND v.status = 'ACTIVE' AND v."isPrivate" = false
      ${zoneFilter}
      AND (
        regexp_replace(unaccent(lower(p.name)), '[^a-z0-9]+', ' ', 'g') ILIKE '%' || ${term} || '%'
        OR EXISTS (SELECT 1 FROM unnest(p.tags) AS t WHERE regexp_replace(unaccent(lower(t)), '[^a-z0-9]+', ' ', 'g') ILIKE '%' || ${term} || '%')
      )
    LIMIT 1
  `;
  return rows.length > 0;
}

// Las palabras salen de lo que hay en la tienda: etiquetas, nombres cortos de productos y categorías de productos a la venta,
// y de lo que los clientes buscaron de verdad. Nada se inventa ni se redacta: se muestran tal cual, cortas, ordenadas por
// ventas, visitas y búsquedas reales.
async function collectTerms(zone) {
  const scores = new Map();
  const shown = new Map();
  const add = (raw, weight) => {
    const term = usableTerm(raw);
    if (!term) return;
    scores.set(term, (scores.get(term) ?? 0) + weight);
    if (!shown.has(term)) shown.set(term, display(raw));
  };

  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      hiddenFromStore: false,
      overQuota: false,
      OR: [{ unlimitedStock: true }, { stock: { gt: 0 } }],
      vendor: { isBlocked: false, status: "ACTIVE", isPrivate: false, locations: vendorZoneWhere(zone) },
    },
    orderBy: [{ salesCount: "desc" }, { viewCount: "desc" }],
    take: 400,
    select: { name: true, tags: true, salesCount: true, viewCount: true, category: { select: { name: true } } },
  });
  for (const p of products) {
    const w = 1 + p.salesCount * 3 + p.viewCount / 20;
    for (const tag of p.tags ?? []) add(tag, w);
    add(p.name, w);
    if (p.category?.name) add(p.category.name, 1 + w / 4);
  }

  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const searches = await prisma.searchTerm.findMany({
    where: { lastSearchedAt: { gte: since }, blocked: false },
    orderBy: [{ count: "desc" }, { lastSearchedAt: "desc" }],
    take: 40,
    select: { term: true, count: true },
  });
  for (const r of searches) add(r.term, 8 + r.count * 6);

  return [...scores.entries()].sort((x, y) => y[1] - x[1]).map(([term]) => ({ term, phrase: shown.get(term) }));
}

async function buildTrending(zone) {
  const items = [];
  const taken = [];
  for (const c of await collectTerms(zone)) {
    if (items.length >= MAX_TERMS) break;
    // Si una palabra ya está contenida en otra elegida (o al revés) se queda la primera: no se repite el mismo tema.
    if (taken.some((t) => t.includes(c.term) || c.term.includes(t))) continue;
    if (!(await hasVisibleMatch(c.term, zone))) continue;
    taken.push(c.term);
    items.push(c);
  }
  return items;
}

// Con un lugar elegido, "Lo más buscado" sale solo de lo que se vende en ese lugar. Se calcula aparte y se guarda unos minutos.
const zoneCache = new Map();
const ZONE_TTL_MS = 5 * 60 * 1000;
export async function getTrendingSearchesForZone(zone) {
  const key = `${zone.countryId ?? ""}|${zone.provinceId ?? ""}|${zone.municipalityId ?? ""}`;
  const hit = zoneCache.get(key);
  if (hit && hit.expires > Date.now()) return hit.items;
  const items = await buildTrending(zone);
  if (zoneCache.size >= 100) zoneCache.delete(zoneCache.keys().next().value);
  zoneCache.set(key, { items, expires: Date.now() + ZONE_TTL_MS });
  return items;
}

export async function refreshTrendingSearches() {
  const items = await buildTrending();
  const snapshot = { items, updatedAt: new Date().toISOString(), version: SNAPSHOT_VERSION };
  const settings = await prisma.siteSettings.findFirst({ select: { id: true } });
  if (settings) await prisma.siteSettings.update({ where: { id: settings.id }, data: { trendingSearches: snapshot } });
  return snapshot;
}

let refreshing = null;
function refreshOnce() {
  refreshing ??= refreshTrendingSearches().finally(() => (refreshing = null));
  return refreshing;
}

export async function getTrendingSearches() {
  const settings = await prisma.siteSettings.findFirst({ select: { trendingSearches: true } });
  const snap = settings?.trendingSearches;
  const age = snap?.updatedAt ? Date.now() - new Date(snap.updatedAt).getTime() : Infinity;
  if (!snap) {
    const fresh = await refreshOnce().catch(() => null);
    return fresh?.items ?? [];
  }
  // Sin frases todavía (nadie ha buscado nada) se vuelve a intentar pronto; con frases, cada pocas horas.
  if (snap.version !== SNAPSHOT_VERSION) {
    const fresh = await refreshOnce().catch(() => null);
    return fresh?.items ?? [];
  }
  if (age > ((snap.items?.length ?? 0) ? REFRESH_MS : 10 * 60 * 1000)) refreshOnce().catch(() => {});
  return snap.items ?? [];
}
