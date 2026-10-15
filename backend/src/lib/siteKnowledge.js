import { prisma } from "./prisma.js";
import { toSearchStem } from "./searchStem.js";

// Documentación del sitio para el asistente de compras: las preguntas frecuentes, los términos, la privacidad, la ayuda y el
// contacto (todo editable desde el admin, así que se lee de la base de datos) y la página de la API para socios. Se parte en
// trozos y en cada mensaje se eligen solo los que tienen que ver con la pregunta, para que el modelo responda con el texto
// oficial sin mandarle 60.000 letras cada vez. Se vuelve a leer cada 5 minutos: un cambio del admin llega solo al asistente.

const TTL_MS = 5 * 60 * 1000;
const CHUNK_MAX = 1100;

const PAGE_META = {
  terminos: { source: "Términos y condiciones", href: "/terminos" },
  privacidad: { source: "Política de privacidad", href: "/privacidad" },
  ayuda: { source: "Centro de ayuda", href: "/ayuda" },
  contacto: { source: "Contacto", href: "/contacto" },
};

// Resumen de /api-socios (esa página vive en el código del sitio, no en la base de datos).
const API_DOC = [
  {
    title: "Qué es la API para socios",
    text: "La API para socios conecta otro sitio web con el marketplace: muestra sus productos y tiendas (mismo catálogo y ranking real), valida el carrito y crea pedidos reales que le llegan al vendedor en su panel y por WhatsApp, con las mismas reglas de stock, tallas, descuentos y cobertura. Una sola credencial (empieza con bzp_key_) da acceso a productos, tiendas, carrito, pedidos y planes; los permisos los define el admin al aprobar. Tiene límites por minuto y por día y solo funciona desde los dominios o IP registrados.",
  },
  {
    title: "Cómo se solicita la API",
    text: "1. Se envía la solicitud en /socios/solicitar con los datos y hasta dos sitios desde los que se usará. 2. Un administrador la revisa; si la aprueba, la credencial llega por correo. 3. Se entra al panel de socio en /socio/ingresar con la contraseña elegida, donde se ven las métricas, la cuota usada y la ganancia estimada. El socio puede sumar un extra a los precios de los planes (nunca por debajo del precio base) y las tiendas que se registran con su enlace quedan asociadas a él.",
  },
  {
    title: "Qué datos ofrece la API",
    text: "Recursos (base /partner/v1, respuesta JSON { data, meta }, credencial en la cabecera Authorization o X-Api-Key): /me, /products (filtros por texto, categoría, tienda, provincia, municipio, precio, moneda, solo verificadas, orden), /products/featured, /products/{id} y sus reseñas, /stores, /stores/{slug}, sus productos, reseñas y ofertas, /offers, /categories, /business-categories, /locations/provinces y municipios, POST /cart/validate, /stores/{slug}/checkout, POST /orders (con cabecera Idempotency-Key), /orders/{code} y /plans. La documentación completa y una consola de pruebas están en /api-socios.",
  },
];

const fold = (s) => String(s ?? "").normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase();

const QUERY_STOP = new Set([
  "que", "como", "cual", "cuales", "donde", "cuando", "quien", "para", "por", "con", "sin", "una", "uno", "unos", "unas", "los", "las",
  "del", "mis", "tus", "sus", "este", "esta", "esto", "eso", "esa", "hay", "puedo", "puede", "pueden", "tiene", "tienen", "tengo",
  "quiero", "necesito", "saber", "hola", "gracias", "favor", "porfa", "algo", "sobre", "pasa", "hace", "hacer", "son", "ser", "estan",
  "esta", "baznova", "sitio", "pagina", "web", "marketplace", "producto", "productos", "articulo", "articulos", "comprar", "compro",
  "precio", "precios", "llega", "llego", "pasa", "paso", "solar", "solares",
]);

function htmlToText(html) {
  return String(html ?? "")
    .replace(/<\s*(br|\/p|\/div|\/h[1-6]|\/tr)\s*\/?>/gi, "\n")
    .replace(/<\s*li[^>]*>/gi, "\n- ")
    .replace(/<\s*(strong|b)[^>]*>/gi, "**")
    .replace(/<\s*\/(strong|b)\s*>/gi, "**")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s*\n+/g, "\n")
    .trim();
}

// Una página legal en secciones: cada título (h2/h3/h4) abre una; las secciones largas se cortan por párrafos.
function splitPage(html, meta) {
  const parts = String(html ?? "").split(/(?=<h[1-4][^>]*>)/i);
  const chunks = [];
  for (const part of parts) {
    const heading = part.match(/^<h[1-4][^>]*>([\s\S]*?)<\/h[1-4]>/i);
    const title = heading ? htmlToText(heading[1]) : meta.source;
    const body = htmlToText(heading ? part.slice(heading[0].length) : part);
    if (!body) continue;
    let buf = "";
    for (const para of body.split("\n")) {
      if (buf && buf.length + para.length > CHUNK_MAX) {
        chunks.push({ ...meta, title, text: buf.trim() });
        buf = "";
      }
      buf += `${para}\n`;
    }
    if (buf.trim()) chunks.push({ ...meta, title, text: buf.trim() });
  }
  return chunks;
}

let cache = null;
let cacheAt = 0;
let inflight = null;

async function buildChunks() {
  const [faqs, pages] = await Promise.all([
    prisma.faqItem.findMany({ orderBy: { createdAt: "asc" }, select: { audience: true, question: true, answer: true } }),
    prisma.staticPage.findMany({ where: { slug: { in: Object.keys(PAGE_META) } }, select: { slug: true, htmlContent: true } }),
  ]);
  const chunks = faqs.map((f) => ({
    source: f.audience === "VENDOR" ? "Preguntas frecuentes (vendedores)" : "Preguntas frecuentes (compradores)",
    href: "/faq",
    title: f.question,
    text: htmlToText(f.answer),
    faq: true,
  }));
  for (const p of pages) if (p.htmlContent) chunks.push(...splitPage(p.htmlContent, PAGE_META[p.slug]));
  chunks.push(...API_DOC.map((d) => ({ source: "API para socios", href: "/api-socios", ...d })));
  for (const c of chunks) {
    c.titleTokens = new Set(tokenize(c.title));
    c.textFold = fold(c.text);
  }
  return chunks;
}

async function getChunks() {
  if (cache && Date.now() - cacheAt < TTL_MS) return cache;
  inflight ??= buildChunks()
    .then((chunks) => {
      cache = chunks;
      cacheAt = Date.now();
      return chunks;
    })
    .finally(() => (inflight = null));
  return inflight;
}

const root = (t) => (t.length >= 7 ? t.slice(0, -2) : t);

function tokenize(text) {
  return [...new Set(fold(text).replace(/[^a-z0-9ñ\s]/g, " ").split(/\s+/).filter((w) => w.length >= 3 && !QUERY_STOP.has(w)).map(toSearchStem))];
}

// Los trozos más relacionados con el mensaje (por palabras en común; el título pesa más). Sin coincidencias claras no
// devuelve nada, para no meterle al modelo texto que no viene al caso.
// Palabras que el cliente usa y las que usan las páginas del sitio para lo mismo ("envíos" vs. "entrega").
const SAME_AS = {
  envio: ["entrega"], domicilio: ["entrega"], delivery: ["entrega"], mensajeria: ["entrega"],
  devolver: ["devolucion", "reembolso"], devolucion: ["reembolso", "cancelar"], reembolso: ["devolucion"],
  pagar: ["pago"], cobran: ["pago", "precio"], plata: ["pago"], dinero: ["pago"],
  borrar: ["eliminar"], cerrar: ["eliminar"], clave: ["contrasena"], password: ["contrasena"],
  queja: ["reclamo", "problema"], reclamo: ["problema"], estafa: ["fraude", "reportar"],
};

export async function searchSiteKnowledge(message, { limit = 4, maxChars = 3600 } = {}) {
  const base = tokenize(message);
  const terms = [...new Set([...base, ...base.flatMap((t) => SAME_AS[t] ?? [])])];
  if (!terms.length) return [];
  const chunks = await getChunks();
  const scored = chunks
    .map((c) => {
      let score = 0;
      let hits = 0;
      let titleHit = false;
      for (const t of terms) {
        // Raíz de la palabra: "solicito" encuentra "solicita" y "solicitud".
        const r = root(t);
        const inTitle = [...c.titleTokens].some((w) => w.startsWith(r) || (w.length >= 4 && t.startsWith(w)));
        const inText = c.textFold.split(r).length - 1;
        if (inTitle) {
          score += 3;
          titleHit = true;
        }
        score += Math.min(inText, 3);
        if (inTitle || inText) hits++;
      }
      return { c, score, hits, titleHit };
    })
    .filter((x) => (base.length === 1 ? x.score >= 2 : (x.hits >= 2 && x.score >= 3) || x.score >= 4))
    .sort((a, b) => b.score - a.score);
  const out = [];
  let total = 0;
  for (const { c, titleHit } of scored) {
    if (out.length >= limit || total + c.text.length > maxChars) break;
    out.push({ ...c, titleHit });
    total += c.text.length;
  }
  return out;
}

export function siteKnowledgeText(chunks) {
  if (!chunks.length) return "";
  return `INFORMACIÓN OFICIAL DEL SITIO (texto real de las páginas del sitio; úsalo tal cual para responder y menciona la página, nunca lo contradigas ni inventes reglas que no estén aquí):\n${chunks
    .map((c) => `[${c.source} · ${c.href}] ${c.title}\n${c.text}`)
    .join("\n\n")}`;
}

// Respuesta directa cuando el mensaje es una de las preguntas frecuentes (por ejemplo, al tocar una sugerencia): sale el
// texto oficial al instante, sin pasar por la IA.
export async function findFaqAnswer(message) {
  const asked = tokenize(message);
  if (asked.length < 2) return null;
  const chunks = await getChunks();
  let best = null;
  for (const c of chunks) {
    if (!c.faq) continue;
    const q = [...c.titleTokens];
    if (!q.length) continue;
    const common = asked.filter((t) => c.titleTokens.has(t)).length;
    const jaccard = common / new Set([...asked, ...q]).size;
    if (!best || jaccard > best.jaccard) best = { c, jaccard };
  }
  if (!best || best.jaccard < 0.75) return null;
  return { title: best.c.title, text: best.c.text, href: best.c.href };
}

// Preguntas frecuentes reales para las sugerencias al abrir el chat (las que coinciden con cada patrón, en ese orden).
export async function pickFaqQuestions(patterns) {
  const chunks = await getChunks();
  return patterns.map((re) => chunks.find((c) => c.faq && re.test(fold(c.title)))?.title).filter(Boolean);
}
