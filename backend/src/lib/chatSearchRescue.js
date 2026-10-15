import { prisma } from "./prisma.js";
import { generateSearchHint } from "./ai.js";

// Rescate de una búsqueda de los chats que no encontró nada con las palabras tal cual (ya sin importar mayúsculas, tildes ni
// plurales). Dos pasos, solo cuando hace falta:
//   1. Parecido de escritura (pg_trgm, el mismo umbral que la barra de búsqueda del sitio): "refrijerador" encuentra
//      "Refrigerador", "ventilaodr" encuentra "Ventilador".
//   2. Lo que quiso decir: la IA traduce el pedido ("algo para que no se vaya la corriente", "nevera") a nombres, categorías o
//      etiquetas que EXISTEN en el catálogo. Solo puede elegir de esa lista (se comprueba), así que nunca inventa un producto.
// Devuelve { ids } (paso 1), { terms } (paso 2) o null, más una nota para que el asistente le diga al cliente cómo se
// interpretó lo que escribió.

const TRIGRAM_THRESHOLD = 0.55;
const FUZZY_LIMIT = 40;
const VOCAB_TTL_MS = 5 * 60 * 1000;
const HINT_TTL_MS = 6 * 60 * 60 * 1000;
const MAX_NAMES = 250;
const MAX_TAGS = 200;

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

async function fuzzyProductIds(terms, vendorId) {
  const ids = new Map();
  for (const term of terms.filter((t) => t.length >= 4)) {
    const rows = await prisma.$queryRaw`
      SELECT p.id, GREATEST(
        word_similarity(unaccent(lower(${term})), regexp_replace(unaccent(lower(p.name)), '[^a-z0-9]+', ' ', 'g')),
        COALESCE(word_similarity(unaccent(lower(${term})), unaccent(lower(c.name))), 0),
        COALESCE((SELECT MAX(word_similarity(unaccent(lower(${term})), unaccent(lower(t)))) FROM unnest(p.tags) AS t), 0)
      ) AS score
      FROM "Product" p
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE p."isActive" = true AND (${vendorId}::text IS NULL OR p."vendorId" = ${vendorId})
      ORDER BY score DESC
      LIMIT ${FUZZY_LIMIT}
    `;
    for (const r of rows) if (r.score > TRIGRAM_THRESHOLD && !ids.has(r.id)) ids.set(r.id, r.score);
  }
  return [...ids.entries()].sort((a, b) => b[1] - a[1]).map(([id]) => id);
}

// Nombres, categorías y etiquetas reales (de la tienda o de todo el sitio) entre los que la IA puede elegir.
const vocabCache = new Map();
async function catalogVocabulary(vendorId) {
  const key = vendorId ?? "all";
  const cached = vocabCache.get(key);
  if (cached && Date.now() - cached.at < VOCAB_TTL_MS) return cached.words;
  const products = await prisma.product.findMany({
    where: {
      isActive: true,
      overQuota: false,
      ...(vendorId ? { vendorId } : { vendor: { isBlocked: false, status: "ACTIVE", isPrivate: false } }),
    },
    select: { name: true, tags: true, category: { select: { name: true } } },
    orderBy: [{ salesCount: "desc" }, { createdAt: "desc" }],
    take: 2000,
  });
  const names = [...new Set(products.map((p) => p.name.trim()))].slice(0, MAX_NAMES);
  const categories = [...new Set(products.map((p) => p.category?.name).filter(Boolean))];
  const tagCount = new Map();
  for (const p of products) for (const t of p.tags ?? []) tagCount.set(t.trim(), (tagCount.get(t.trim()) ?? 0) + 1);
  const tags = [...tagCount.entries()].sort((a, b) => b[1] - a[1]).slice(0, MAX_TAGS).map(([t]) => t);
  const words = [...new Set([...categories, ...tags, ...names].filter((w) => w && w.length >= 3))];
  vocabCache.set(key, { at: Date.now(), words });
  return words;
}

const hintCache = new Map();
async function interpretWithAI(text, vendorId) {
  const key = `${vendorId ?? "all"}|${fold(text)}`;
  const cached = hintCache.get(key);
  if (cached && Date.now() - cached.at < HINT_TTL_MS) return cached.terms;
  const vocabulary = await catalogVocabulary(vendorId);
  if (!vocabulary.length) return [];
  const prompt = `Eres el buscador de una tienda en línea de Cuba. El cliente escribió: «${String(text).slice(0, 300)}».
Puede tener errores de escritura, usar otra palabra (sinónimo, palabra regional) o describir para qué lo quiere en vez del nombre.
Esta es la lista COMPLETA de nombres de productos, categorías y etiquetas que existen de verdad en el catálogo, separados por " | ":
${vocabulary.join(" | ")}

Elige de 1 a 3 elementos de esa lista, copiados EXACTAMENTE como aparecen, que correspondan a lo que busca el cliente. Si ninguno corresponde de verdad, devuelve la lista vacía: nunca elijas algo que no tiene que ver solo para devolver algo.
Responde solo con JSON, sin texto alrededor: {"terms": ["..."]}`;
  const raw = await generateSearchHint(prompt);
  let terms = [];
  try {
    const parsed = JSON.parse(raw?.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    const byFold = new Map(vocabulary.map((w) => [fold(w), w]));
    terms = (Array.isArray(parsed.terms) ? parsed.terms : []).map((t) => byFold.get(fold(t))).filter(Boolean).slice(0, 3);
  } catch {
    terms = [];
  }
  if (hintCache.size > 3000) hintCache.clear();
  // Una respuesta vacía por falta de IA (raw null) no se recuerda: se vuelve a intentar en el próximo mensaje.
  if (raw) hintCache.set(key, { at: Date.now(), terms });
  return terms;
}

// `terms`: lo que se buscó sin éxito. `text`: la frase del cliente de donde salieron. `vendorId`: solo esa tienda (o todo).
export async function rescueChatSearch({ terms, text, vendorId = null }) {
  if (!terms?.length) return null;
  const ids = await fuzzyProductIds(terms, vendorId).catch(() => []);
  if (ids.length) {
    return { ids, note: `BÚSQUEDA CORREGIDA: el cliente escribió "${terms.join(" ")}" y no había coincidencia exacta; se buscó por parecido de escritura. Si los productos de abajo son lo que quiso decir, empieza aclarándolo en pocas palabras (ej.: "Te muestro refrigeradores (escribiste «refrijerador»).") y nunca digas que no hay resultados.` };
  }
  const aiTerms = await interpretWithAI(text || terms.join(" "), vendorId).catch(() => []);
  if (aiTerms.length) {
    return { terms: aiTerms, note: `BÚSQUEDA INTERPRETADA: el cliente escribió "${String(text).slice(0, 160)}" y no había coincidencia exacta; se interpretó como: ${aiTerms.join(", ")}. Empieza diciéndolo en pocas palabras (ej.: "Para eso te pueden servir estos productos:") y nunca digas que no hay resultados.` };
  }
  return null;
}
