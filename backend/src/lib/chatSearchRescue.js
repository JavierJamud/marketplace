import { prisma } from "./prisma.js";
import { generateSearchHint } from "./ai.js";

// Rescate de una búsqueda de los chats que no encontró nada con las palabras tal cual (ya sin importar mayúsculas, tildes ni
// plurales). Dos pasos, solo cuando hace falta:
//   1. Parecido de escritura (pg_trgm, el mismo umbral que la barra de búsqueda del sitio): "refrijerador" encuentra
//      "Refrigerador", "ventilaodr" encuentra "Ventilador".
//   2. Lo que quiso decir: la IA traduce el pedido ("algo para que no se vaya la corriente", "nevera") a nombres, categorías o
//      etiquetas que EXISTEN en el catálogo. Solo puede elegir de esa lista (se comprueba), así que nunca inventa un producto.
// Devuelve { ids } (paso 1) o { terms } (paso 2) con una nota para que el asistente le diga al cliente cómo se interpretó lo
// que escribió; { missing } si se entendió pero no se vende; { unclear } si no se entiende (el chat le pide que lo repita, sin
// mostrar productos); o null si no se pudo decidir (sin IA).

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

const HINT_TIMEOUT_MS = 6000;
const hintCache = new Map();

// La IA clasifica el pedido: "product" (busca algo que se vende: devuelve los elementos de la lista que son claramente lo
// mismo, o ninguno si no se vende), "other" (no es una búsqueda de producto: una pregunta del sitio, un saludo) o "unclear"
// (no se entiende qué quiere: palabras inventadas o sin sentido). Con más de 6 segundos se sigue sin ella.
async function interpretWithAI(text, vendorId) {
  const key = `${vendorId ?? "all"}|${fold(text)}`;
  const cached = hintCache.get(key);
  if (cached && Date.now() - cached.at < HINT_TTL_MS) return cached.value;
  const vocabulary = await catalogVocabulary(vendorId);
  if (!vocabulary.length) return null;
  const prompt = `Eres el buscador de una tienda en línea de Cuba. El cliente escribió: «${String(text).slice(0, 300)}».
Esta es la lista COMPLETA de nombres de productos, categorías y etiquetas que existen de verdad en el catálogo, separados por " | ":
${vocabulary.join(" | ")}

Clasifica lo que escribió el cliente:
- "product": pide o busca algo que se puede comprar. En "terms" pon de 1 a 3 elementos de la lista, copiados EXACTAMENTE, solo si son claramente lo mismo que pide: la misma palabra mal escrita (la más parecida), un sinónimo o una palabra regional del mismo objeto, o una descripción directa de su uso (ej. "algo para tener luz cuando se va la corriente" -> un panel solar o una planta eléctrica). Si lo que pide no está en la lista, "terms" va vacío: nunca elijas algo parecido pero distinto ni algo que solo "podría servir".
- "other": no busca un producto (una pregunta sobre el sitio, pedidos, pagos, un saludo).
- "unclear": no se entiende qué quiere (palabras inventadas, letras sin sentido, una frase que no se puede interpretar con seguridad).
Responde solo con JSON, sin texto alrededor: {"kind": "product" | "other" | "unclear", "terms": ["..."]}`;
  const raw = await Promise.race([generateSearchHint(prompt), new Promise((r) => setTimeout(() => r(null), HINT_TIMEOUT_MS))]);
  if (!raw) return null; // sin IA o demasiado lenta: no se recuerda, se vuelve a intentar en el próximo mensaje
  let value = null;
  try {
    const parsed = JSON.parse(raw.match(/\{[\s\S]*\}/)?.[0] ?? "{}");
    const byFold = new Map(vocabulary.map((w) => [fold(w), w]));
    const kind = ["product", "other", "unclear"].includes(parsed.kind) ? parsed.kind : null;
    const terms = kind === "product" ? (Array.isArray(parsed.terms) ? parsed.terms : []).map((t) => byFold.get(fold(t))).filter(Boolean).slice(0, 3) : [];
    value = kind ? { kind, terms } : null;
  } catch {
    value = null;
  }
  if (hintCache.size > 3000) hintCache.clear();
  hintCache.set(key, { at: Date.now(), value });
  return value;
}

export const UNCLEAR_REPLY = "No entendí bien qué estás buscando. ¿Me lo puedes decir con otras palabras?";

// `terms`: lo que se buscó sin éxito. `text`: la frase del cliente de donde salieron. `vendorId`: solo esa tienda (o todo).
export async function rescueChatSearch({ terms, text, vendorId = null }) {
  if (!terms?.length) return null;
  const ids = await fuzzyProductIds(terms, vendorId).catch(() => []);
  if (ids.length) {
    return { ids, note: `BÚSQUEDA CORREGIDA: el cliente escribió "${terms.join(" ")}" y no había coincidencia exacta; se buscó por parecido de escritura. Si los productos de abajo son lo que quiso decir, empieza aclarándolo en pocas palabras (ej.: "Te muestro refrigeradores (escribiste «refrijerador»).") y nunca digas que no hay resultados.` };
  }
  const hint = await interpretWithAI(text || terms.join(" "), vendorId).catch(() => null);
  if (hint?.kind === "unclear") return { unclear: true };
  if (hint?.kind === "product" && hint.terms.length) {
    return { terms: hint.terms, note: `BÚSQUEDA INTERPRETADA: el cliente escribió "${String(text).slice(0, 160)}" y no había coincidencia exacta; se interpretó como: ${hint.terms.join(", ")}. Empieza diciéndolo en pocas palabras (ej.: "Para eso te pueden servir estos productos:") y nunca digas que no hay resultados.` };
  }
  if (hint?.kind === "product") {
    return { missing: true, note: `BÚSQUEDA SIN RESULTADOS: se entendió lo que pide el cliente ("${String(text).slice(0, 160)}"), pero no hay nada así en el catálogo ahora mismo. Dilo claro en una frase y ofrece buscar otra cosa; no preguntes provincia ni zona y no ofrezcas productos que no son lo que pidió.` };
  }
  return null;
}
