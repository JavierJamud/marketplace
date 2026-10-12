import { prisma } from "./prisma.js";
import { generateRawText } from "./ai.js";

// "Lo más buscado" de la portada: se anotan las búsquedas reales que dieron resultados, se descartan las que no sirven para
// mostrarse en público (groserías, datos personales, textos raros) y una IA elige y redacta frases cortas y naturales para
// cada término, pensadas para posicionar en buscadores. El resultado se guarda en SiteSettings.trendingSearches y se renueva
// cada pocas horas; la portada solo lee ese resumen guardado.

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ ]+/g, " ").replace(/\s+/g, " ").trim();

// Lista de raíces ofensivas, sexuales, de odio o ilegales. Se compara sobre el texto sin tildes y por palabra completa o prefijo.
const BLOCKED = /\b(put[oa]s?|puter|mierd|co[nñ]o|pendej|cabron|verga|pija|polla|follar|culo|marica|maricon|negr[oa] de|nigg|fag|porn|sexo|sexual|xxx|escort|prostitu|droga|cocaina|marihuana|crack|armas? de fuego|pistola|fusil|explosivo|suicid|matar|violacion|pedofil|terroris|nazi|hitler|estafa|hack(?:ear|eo)?)/;
const MAX_TERMS = 12;
const REFRESH_MS = 6 * 60 * 60 * 1000;

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

async function topCandidates() {
  const since = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);
  const rows = await prisma.searchTerm.findMany({
    where: { lastSearchedAt: { gte: since }, blocked: false },
    orderBy: [{ count: "desc" }, { lastSearchedAt: "desc" }],
    take: 40,
    select: { term: true, count: true },
  });
  return rows.filter((r) => normalizeSearchTerm(r.term));
}

function titleCase(term) {
  return term.charAt(0).toUpperCase() + term.slice(1);
}

function parseAiList(text, allowed) {
  const match = String(text ?? "").match(/\[[\s\S]*\]/);
  if (!match) return null;
  let list;
  try {
    list = JSON.parse(match[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(list)) return null;
  const out = [];
  const seen = new Set();
  for (const item of list) {
    const term = fold(item?.term);
    // Solo vale un término que de verdad se buscó: la IA no puede inventar ni sumar palabras nuevas.
    if (!allowed.has(term) || seen.has(term)) continue;
    let phrase = String(item?.phrase ?? "").replace(/[—–]/g, ",").replace(/\s+/g, " ").trim();
    if (phrase.length < 4 || phrase.length > 70 || !isPublicSafeText(phrase)) phrase = titleCase(term);
    seen.add(term);
    out.push({ term, phrase });
  }
  return out;
}

export async function refreshTrendingSearches() {
  const candidates = await topCandidates();
  let items = [];
  if (candidates.length) {
    const allowed = new Set(candidates.map((c) => c.term));
    try {
      const prompt = `Eres editor de SEO de un marketplace cubano. Estas son las búsquedas reales de los clientes, de la más a la menos frecuente:\n${candidates
        .map((c) => `- ${c.term}`)
        .join("\n")}\n\nElige hasta ${MAX_TERMS} que sirvan para mostrarse en la portada. Descarta groserías, contenido sexual, violento o ilegal, datos personales, nombres de personas y textos sin sentido. Para cada una escribe una frase corta y natural en español (máximo 60 caracteres) que un cliente querría tocar y que ayude a posicionar en buscadores, sin inventar productos, precios ni promesas. Sin rayas largas. Responde SOLO con un arreglo JSON: [{"term":"<búsqueda exacta de la lista>","phrase":"<frase>"}]`;
      items = parseAiList(await generateRawText(prompt), allowed) ?? [];
    } catch {
      items = [];
    }
    // Sin IA (o respuesta inválida) se muestran las búsquedas más frecuentes tal cual, ya filtradas.
    if (!items.length) items = candidates.slice(0, MAX_TERMS).map((c) => ({ term: c.term, phrase: titleCase(c.term) }));
  }
  const snapshot = { items: items.slice(0, MAX_TERMS), updatedAt: new Date().toISOString() };
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
  if (age > ((snap.items?.length ?? 0) ? REFRESH_MS : 10 * 60 * 1000)) refreshOnce().catch(() => {});
  return snap.items ?? [];
}
