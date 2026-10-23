import { z } from "zod";
import { resolveSessionUser } from "../middleware/auth.js";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { storePaymentLabel } from "../lib/catalog.js";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { chatWithStoreAssistant } from "../lib/ai.js";
import { compactHistory, MEMORY_FETCH_LIMIT } from "../lib/chatMemory.js";
import { logError } from "../lib/errorLog.js";
import { buildFewShotBlock } from "../lib/chatTrainingExamples.js";
import { resolveUnitPrice } from "../lib/pricing.js";
import { VENDOR_AI_DOC_DIR } from "./vendors.controller.js";
import { getBrandSettings } from "./settings.controller.js";
import { assertPlanAllows, isPremiumActive, getPlanConfig } from "../lib/planConfig.js";
import { CONVERSATIONAL_FILLERS, toSearchStem } from "../lib/searchStem.js";
import { UNCLEAR_REPLY, rescueChatSearch } from "../lib/chatSearchRescue.js";
import { logChatExchange } from "../lib/chatLog.js";

// Bloque 42 (optimización de tokens — bajado de 20 a 6): el modelo no
// tiene memoria propia entre requests, así que ESTE historial es lo único
// que evita que "se olvide" de un dato ya filtrado (talla, color) o repita
// una pregunta — pero mandar 20 turnos completos en CADA mensaje de la
// charla es lo que más pesaba del prompt (confirmado en vivo: cuota diaria
// de Groq agotada en ~8-10 mensajes). 6 turnos (~3 idas y vueltas) alcanza
// para el filtrado progresivo actual sin arrastrar toda la charla — si en
// pruebas reales resultara corto para algún caso, subir a 8, nunca volver
// a 20.
// Bloque 281: ahora van 4 mensajes completos + una memoria corta del resto (lib/chatMemory.js).

// Bloque 39 (Parte 2) — bug real reportado: con más de 60 productos activos,
// el catálogo volcado al prompt truncaba en silencio a los últimos 60 más
// recientes (orderBy createdAt desc + take), así que el bot decía "no lo
// vendemos" sobre productos reales que sí existían pero habían quedado
// afuera del corte. Por debajo de este umbral se sigue volcando el
// catálogo COMPLETO (comportamiento de siempre, simple y sin cambios); por
// encima, se busca en TODA la base de esa tienda según lo que pide el
// cliente (ver searchVendorProductIdsByTerms) en vez de truncar por fecha.
const CATALOG_FULL_DUMP_THRESHOLD = 30;
// Techo de resultados que de verdad se muestran/pasan al prompt en el modo
// búsqueda — nunca implica que la búsqueda en sí esté acotada a esto (esa
// corre contra la tabla entera), solo cuántos candidatos se listan.
const CATALOG_SEARCH_POOL = 60;

// Bloque 39 (Parte 2): mismo criterio de siempre (assistant.controller.js)
// para extraer términos de búsqueda reales de un mensaje conversacional —
// duplicado a propósito acá (mismo criterio de todo este proyecto: los dos
// bots son hermanos independientes, sin importar uno del otro).
// Bloque 43 (bug real reportado en vivo: el cliente preguntó "¿qué tengo en
// el carrito?" y el bot dijo que estaba vacío, con productos reales adentro):
// "carrito"/"cesta" NO estaban acá — con un catálogo grande (>60 productos),
// resolveCatalogSearchTerms las tomaba como término de búsqueda real, y como
// ningún producto real se llama "carrito", searchVendorProductIdsByTerms
// devolvía 0 resultados → catalogText([], ...) → "(Sin productos
// publicados.)" → el modelo se quedaba SIN NINGÚN dato del carrito en el
// prompt (ni siquiera la anotación "ya tiene X" por producto) y alucinó que
// estaba vacío. Ver también cartText() más abajo — el fix real es que ahora
// el carrito se resuelve SIEMPRE por su cuenta, sin depender de la búsqueda
// de catálogo, pero estas palabras igual no tienen nada que hacer como
// término de búsqueda de producto.
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
  "carrito", "carro", "cesta", "cesto",
]);

// Singular de cada palabra (ver lib/searchStem.js): "paneles" tiene que encontrar "Panel solar".
function extractSearchTerms(rawText) {
  const words = rawText.toLowerCase().replace(/[¿?¡!.,;:]/g, "").split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w) && !CONVERSATIONAL_FILLERS.has(w));
  return [...new Set(words.map(toSearchStem))];
}

// Si el mensaje actual no trae ningún término propio (ej. "sí", "esa
// misma"), reusa los del último mensaje del cliente que sí tenía — mismo
// criterio que resolveSearchContext en assistant.controller.js, para que
// una respuesta corta de seguimiento no deje la búsqueda vacía.
function resolveCatalogSearchTerms(message, history) {
  const ownTerms = extractSearchTerms(message);
  if (ownTerms.length > 0) return ownTerms;
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].role !== "user") continue;
    const priorTerms = extractSearchTerms(history[i].content);
    if (priorTerms.length > 0) return priorTerms;
  }
  return [];
}

const PRODUCT_SELECT_FIELDS = {
  id: true,
  name: true,
  slug: true,
  description: true,
  price: true,
  oldPrice: true,
  currency: true,
  priceTiers: { orderBy: { minQty: "asc" }, select: { minQty: true, price: true } },
  stock: true,
  unlimitedStock: true,
  images: true,
  tags: true,
  options: { select: { name: true, values: true } },
  // Envío del producto: el bot lo conoce (solo cuenta si la tienda no tiene envío propio, ver shippingPolicyText).
  shippingMode: true,
  shippingLocal: true,
  shippingOther: true,
  shippingCurrency: true,
  shippingPerUnit: true,
};

// Bloque 39/40: unaccent() de los dos lados (Postgres, ya habilitado desde
// el Bloque 40) — "audifonos" sin tilde tiene que encontrar "Audífonos..."
// real, mismo criterio que assistant.controller.js. Acotado a ESTE vendor
// (WHERE p."vendorId" = ...) a diferencia de la búsqueda cross-tienda del
// bot general.
async function searchVendorProductIdsByTerms(vendorId, terms) {
  const ids = new Set();
  for (const term of terms) {
    const pattern = `%${term}%`;
    const rows = await prisma.$queryRaw`
      SELECT p.id FROM "Product" p
      LEFT JOIN "Category" c ON c.id = p."categoryId"
      WHERE p."isActive" = true AND p."vendorId" = ${vendorId}
        AND (
          unaccent(p.name) ILIKE unaccent(${pattern})
          OR unaccent(p.description) ILIKE unaccent(${pattern})
          OR unaccent(c.name) ILIKE unaccent(${pattern})
          OR EXISTS (SELECT 1 FROM unnest(p.tags) AS t WHERE unaccent(t) ILIKE unaccent(${pattern}))
        )
      LIMIT ${CATALOG_SEARCH_POOL}
    `;
    rows.forEach((r) => ids.add(r.id));
  }
  return [...ids];
}

// Bloque 26: una sesión "vence" a las 24h desde el ÚLTIMO mensaje (cliente
// o bot, lo que sea más reciente) — no desde el inicio de la charla. El
// historial viejo nunca se borra, solo deja de mostrarse/continuarse; el
// frontend también chequea esto por su cuenta (localStorage), pero acá es
// el chequeo que manda de verdad — funciona aunque el localStorage del
// cliente esté desactualizado, se haya limpiado, o venga de otro
// dispositivo.
const SESSION_EXPIRY_MS = 24 * 60 * 60 * 1000;

function isSessionExpired(lastMessage) {
  return !!lastMessage && Date.now() - new Date(lastMessage.createdAt).getTime() > SESSION_EXPIRY_MS;
}

function fmtCUP(n) {
  return `${Number(n).toLocaleString("es-CU")} CUP`;
}

function fmtPrice(n, currency = "CUP") {
  return `${Number(n).toLocaleString("es-CU")} ${currency || "CUP"}`;
}

// Precios por cantidad (mayoreo) del producto, para que el modelo los vea y los diga: "36+ u: 220 USD, 72+ u: 210 USD".
function tiersText(p) {
  if (!p.priceTiers?.length) return "";
  return ` · precios por cantidad (por unidad): ${p.priceTiers.map((t) => `desde ${t.minQty} u: ${fmtPrice(t.price, p.currency)}`).join(", ")}`;
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

// Bloque 24: mismos id→label que frontend/src/lib/paymentMethods.js (sin
// íconos, acá no hacen falta) — mantener sincronizados si se agrega un
// método ahí. Un valor no listado es texto libre que cargó el vendedor
// ("otro"), se muestra tal cual.
// 0 = domingo .. 6 = sábado — mismo orden que Prisma (VendorSchedule.dayOfWeek).
const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Bloque 30: mismas etiquetas que STATUS_LABEL de VendorOrders.jsx — el
// cliente ve el mismo lenguaje que el vendedor usa en su panel para el
// mismo estado real, nunca una traducción distinta inventada acá.
const ORDER_STATUS_LABEL = { NEW: "Pendiente", PREPARING: "Vendido/Confirmado", READY: "En camino", DELIVERED: "Entregado", CANCELLED: "Rechazado" };

// Bloque 39 (Parte 2): "message"/"history" ya no son opcionales — hacen
// falta para decidir QUÉ buscar cuando el catálogo es grande (ver abajo).
// Catálogos chicos (<= CATALOG_FULL_DUMP_THRESHOLD) siguen recibiendo el
// volcado completo de siempre, sin este paso extra.
async function loadVendorForChat(vendorId, message, history, cartQuantities) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: {
      locations: { include: { country: true, province: { include: { country: true } }, municipality: true } },
      deliveryCountries: { include: { country: { select: { name: true } } } },
      schedules: true,
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });
  if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE") throw new AppError("Tienda no encontrada.", 404);
  // Mismo gate que el widget del frontend (no lo muestra si no está
  // verificada) — pero acá es lo que de verdad importa: sin esto, cualquiera
  // podría pegarle al endpoint directo sin pasar por la UI. Bloque 52
  // (decisión confirmada — "las dos cosas"): verificada Y el plan actual
  // tiene que habilitar el chatbot (allowAiChatbot).
  if (vendor.verificationStatus !== "VERIFIED") throw new AppError("El chat con IA solo está disponible para tiendas verificadas.", 403);
  await assertPlanAllows(vendor, "allowAiChatbot", "Tu plan actual no incluye el chat con IA.");

  const totalActive = vendor._count.products;
  let products;
  let searchNote = "";
  let unclearQuery = false;
  if (totalActive <= CATALOG_FULL_DUMP_THRESHOLD) {
    // Bloque 28: tags + options se agregan para que el bot pueda
    // recomendar por palabra clave y preguntar por variantes reales en
    // vez de inventarlas — el resto de los campos es lo mínimo para
    // armar el texto del catálogo + las tarjetas de producto
    // (images/slug no van al prompt, solo a toCardProduct).
    products = await prisma.product.findMany({
      where: { vendorId, isActive: true },
      select: PRODUCT_SELECT_FIELDS,
      orderBy: { createdAt: "desc" },
    });
  } else {
    const terms = resolveCatalogSearchTerms(message, history);
    if (terms.length) {
      const ids = await searchVendorProductIdsByTerms(vendorId, terms);
      products = ids.length ? await prisma.product.findMany({ where: { id: { in: ids }, vendorId, isActive: true }, select: PRODUCT_SELECT_FIELDS }) : [];
      // Nada con las palabras tal cual: parecido de escritura y, si no alcanza, lo que quiso decir según el catálogo de esta
      // tienda (lib/chatSearchRescue.js). Con 30 productos o menos no hace falta: el modelo ve el catálogo completo.
      if (!products.length) {
        const source = extractSearchTerms(message).length ? message : [...history].reverse().find((h) => h.role === "user" && extractSearchTerms(h.content).length)?.content;
        const rescue = await rescueChatSearch({ terms, text: source ?? message, vendorId }).catch(() => null);
        if (rescue?.unclear) unclearQuery = true;
        if (rescue?.missing) searchNote = rescue.note;
        const rescuedIds = rescue?.ids ?? (rescue?.terms ? await searchVendorProductIdsByTerms(vendorId, rescue.terms) : []);
        if (rescuedIds.length) {
          products = await prisma.product.findMany({ where: { id: { in: rescuedIds.slice(0, CATALOG_SEARCH_POOL) }, vendorId, isActive: true }, select: PRODUCT_SELECT_FIELDS });
          if (products.length) searchNote = rescue.note;
        }
      }
    } else {
      // Sin término de búsqueda propio (saludo, pregunta genérica): mismo
      // criterio de siempre para este caso — destacados/recientes, nunca
      // vacío por default. La búsqueda de arriba sí corre contra TODA la
      // tabla del vendor cuando hay término real, nunca contra un
      // subconjunto truncado por fecha.
      products = await prisma.product.findMany({
        where: { vendorId, isActive: true },
        select: PRODUCT_SELECT_FIELDS,
        take: CATALOG_SEARCH_POOL,
        orderBy: [{ isFeatured: "desc" }, { createdAt: "desc" }],
      });
    }
  }

  // Bloque 43 (bug real reportado en vivo — ver el comentario largo en
  // STOPWORDS): "products" de arriba es el catálogo que se le MUESTRA al
  // modelo para la conversación (destacados, resultado de búsqueda, o el
  // volcado completo) — pero el carrito del cliente es un dato DISTINTO,
  // que tiene que estar SIEMPRE, sin importar si el producto cayó dentro de
  // ese recorte o no (ej.: catálogo grande, el cliente buscó "zapatos" pero
  // tiene una "camisa" en el carrito de una charla anterior — la búsqueda
  // por "zapatos" nunca la iba a traer). Sin esto, cartText() más abajo
  // podía toparse con un productId del carrito que no está en "products" y
  // no tener nombre/precio para mostrarlo.
  const cartProductIds = Object.entries(cartQuantities ?? {})
    .filter(([, qty]) => qty > 0)
    .map(([id]) => id);
  const missingCartIds = cartProductIds.filter((id) => !products.some((p) => p.id === id));
  if (missingCartIds.length) {
    const missingProducts = await prisma.product.findMany({
      where: { id: { in: missingCartIds }, vendorId },
      select: PRODUCT_SELECT_FIELDS,
    });
    products = [...missingProducts, ...products];
  }

  return { ...vendor, products, searchNote, unclearQuery };
}

function scheduleText(schedules) {
  if (!schedules?.length) return "Horario: no cargado en el sistema — si preguntan, sugiere confirmar por WhatsApp.";
  const byDay = new Map(schedules.map((s) => [s.dayOfWeek, s]));
  const lines = DAY_NAMES.map((name, i) => {
    const s = byDay.get(i);
    if (!s || s.isClosed) return `${name}: cerrado`;
    return `${name}: ${s.opensAt}–${s.closesAt}`;
  });
  return `Horario semanal:\n${lines.join("\n")}`;
}

// Cobertura de entrega ordenada por país, con cada nivel nombrado (país > provincia/estado > municipio). Antes solo viajaba la lista
// de provincias y municipios sin su país, y el modelo ubicaba una provincia de otro país (Alberta, Canadá) dentro de Cuba y
// respondía provincias cuando le preguntaban por países.
function deliveryCoverageText(vendor) {
  const byCountry = new Map();
  const countryEntry = (name) => {
    if (!byCountry.has(name)) byCountry.set(name, { regions: new Map(), wholeCountry: false });
    return byCountry.get(name);
  };
  const titleCase = (s) => (s && s === s.toUpperCase() ? s.charAt(0) + s.slice(1).toLowerCase() : s);
  for (const l of vendor.locations ?? []) {
    const country = titleCase(l.province?.country?.name ?? l.country?.name ?? l.countryOther) || "País sin indicar";
    const entry = countryEntry(country);
    const region = l.province?.name ?? l.stateOther;
    if (!region) continue;
    const label = `${l.province?.type === "STATE" ? "estado" : "provincia"} ${region}`;
    if (!entry.regions.has(label)) entry.regions.set(label, new Set());
    const municipality = l.municipality?.name ?? l.municipalityOther;
    if (municipality) entry.regions.get(label).add(municipality);
  }
  for (const d of vendor.deliveryCountries ?? []) countryEntry(titleCase(d.country.name)).wholeCountry = true;
  if (!byCountry.size) return "Cobertura de entrega: no cargada en el sistema — si preguntan, sugiere confirmar por WhatsApp.";

  const lines = [...byCountry].map(([country, { regions, wholeCountry }]) => {
    // Los estados se dividen en ciudades; las provincias de Cuba, en municipios.
    const parts = [...regions].map(([region, munis]) => (munis.size ? `${region} (${region.startsWith("estado ") ? "ciudades" : "municipios"}: ${[...munis].join(", ")})` : region));
    if (wholeCountry) parts.push("además hace envíos a este país");
    return `- País ${country}: ${parts.join("; ") || "hace envíos a este país"}`;
  });
  return `COBERTURA DE ENTREGA (por país; cada país contiene provincias o estados; las provincias contienen municipios y los estados, ciudades):
${lines.join("\n")}
Países donde entrega: ${[...byCountry.keys()].join(", ")}.${vendor.companyAddress ? `\nDirección del local: ${vendor.companyAddress}` : ""}`;
}

function paymentMethodsText(ids) {
  if (!ids?.length) return "Métodos de pago: no cargados en el sistema — si preguntan, sugiere confirmar por WhatsApp.";
  return `Métodos de pago que acepta: ${ids.map(storePaymentLabel).join(", ")}`;
}

// Bloque 30: "¿cómo va mi pedido?" — se detecta un email o un número de
// confirmación (Order.code, ej. "Z-MRPQJECP", generado al crear el pedido)
// en el mensaje del cliente ANTES de llamarlo al modelo, se resuelve la
// consulta acá con una query real, y el resultado se le pasa como contexto
// de ESTE turno únicamente (nunca se guarda en el prompt fijo de la
// tienda). Mismo criterio anti-alucinación de siempre: el modelo nunca
// "sabe" el estado de un pedido salvo que se lo hayamos resuelto acá.
const EMAIL_REGEX = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/;
const ORDER_CODE_REGEX = /\bZ-[A-Z0-9]{4,}\b/i;

// Bloque 42 (optimización de tokens): el documento de negocio (.txt/.pdf
// subido por la tienda) es el ítem más caro del prompt — antes viajaba
// completo en CADA mensaje, incluso un saludo o "quiero comprar X" que no lo
// necesita para nada. Ahora solo se carga cuando el mensaje ACTUAL (no el
// historial) parece una pregunta de política/horario/FAQ real.
const DOC_RELEVANCE_REGEX =
  /pol[ií]tica|garant[ií]a|devoluci[oó]n|reembolso|env[ií]o|entrega|horario|atienden|abren|cierran|faq|preguntas frecuentes|reclamo|cambio|factura|t[eé]rminos|condiciones|privacidad/i;
function messageNeedsDocument(message) {
  return DOC_RELEVANCE_REGEX.test(message);
}

// Campos deliberadamente acotados: código, estado, fecha, ítems y total —
// nunca teléfono ni dirección de envío.
//
// Bloque 184 (auditoría de seguridad — mismo hallazgo que en
// assistant.controller.js, acá con MÁS datos en juego porque este bot sí
// enumera los productos): el chat de tienda es público, y antes alcanzaba
// con escribir el correo de otra persona para que el bot recitara sus
// pedidos en esta tienda, con nombre y cantidad de cada producto. Acotar los
// campos no alcanzaba: ahora un email solo consulta si es el de la propia
// sesión, y un invitado únicamente puede identificarse con el código del
// pedido (el dato secreto que le llegó por correo).
async function lookupOrderContext(vendorId, message, userId) {
  const codeMatch = message.match(ORDER_CODE_REGEX);
  const typedEmail = message.match(EMAIL_REGEX)?.[0]?.toLowerCase() ?? null;

  let ownEmail = null;
  if (userId && typedEmail) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { email: true } });
    ownEmail = user?.email?.trim().toLowerCase() ?? null;
  }
  const email = typedEmail && typedEmail === ownEmail ? typedEmail : null;

  if (typedEmail && !email && !codeMatch) {
    return `CONSULTA DE PEDIDO: el cliente escribió un correo que NO es el de la sesión con la que está hablando, así que no se consultó nada — los pedidos de otra persona no se muestran nunca. Pídele amablemente que inicie sesión con ese correo y revise "Mis Pedidos", o que te pase el número de pedido (formato Z-XXXX) que le llegó por correo. No inventes ningún estado.`;
  }
  if (!email && !codeMatch) return null;

  const or = [];
  if (email) or.push({ customerEmail: { equals: email, mode: "insensitive" } });
  if (codeMatch) or.push({ code: { equals: codeMatch[0].toUpperCase() } });

  const orders = await prisma.order.findMany({
    where: { vendorId, OR: or },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { items: true },
  });

  if (orders.length === 0) {
    return `CONSULTA DE PEDIDO: el cliente preguntó por un pedido (email/número "${email ?? codeMatch[0]}") pero NO se encontró ningún pedido con ese dato en esta tienda. Dilo claramente — nunca inventes un estado ni asumas que existe.`;
  }

  const lines = orders.map(
    (o) =>
      `${o.code}: estado "${ORDER_STATUS_LABEL[o.status]}", ${o.items.length} producto(s) (${o.items.map((i) => `${i.name} x${i.quantity}`).join(", ")}), total ${fmtCUP(o.total)}, pedido el ${new Date(o.createdAt).toLocaleDateString("es-CU")}.`
  );
  return `CONSULTA DE PEDIDO: el cliente preguntó por su pedido. Pedido(s) encontrado(s) en esta tienda con ese email/número (única fuente de verdad, no agregues ni cambies nada):\n${lines.join("\n")}`;
}

// Bloque 39: mismo mecanismo opcional que el bot general (resolveOptionalUserId
// en assistant.controller.js) — nunca obligatorio, sin login el chat sigue
// funcionando exactamente igual, sin historial. El frontend (lib/api.js) ya
// manda el Bearer token en TODOS los requests si el cliente está logueado,
// así que esto no necesita ningún cambio del lado del widget.
async function resolveOptionalUserId(req) {
  // Solo una sesión viva cuenta (ver resolveSessionUser): nunca el token de reto 2FA ni uno de una sesión cerrada.
  return (await resolveSessionUser(req))?.id ?? null;
}

const PURCHASE_HISTORY_LIMIT = 5;

// Bloque 39 (Parte 1): historial REAL de compras del cliente logueado EN
// ESTA TIENDA — nunca datos de contacto ni de otros clientes, solo
// producto+cantidad, lo mínimo útil para recomendar ("la última vez
// llevaste X"). Si no está logueado o no tiene pedidos acá, devuelve null
// y el bloque entero queda afuera del prompt — nunca se inventa un
// historial que no existe (ver REGLAS: "nunca inventes un historial").
async function buildPurchaseHistoryContext(vendorId, userId) {
  if (!userId) return null;
  const orders = await prisma.order.findMany({
    where: { vendorId, customerId: userId },
    orderBy: { createdAt: "desc" },
    take: PURCHASE_HISTORY_LIMIT,
    include: { items: { select: { name: true, quantity: true } } },
  });
  if (!orders.length) return null;

  const itemCounts = new Map();
  for (const o of orders) {
    for (const item of o.items) {
      itemCounts.set(item.name, (itemCounts.get(item.name) ?? 0) + item.quantity);
    }
  }
  const summary = [...itemCounts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([name, qty]) => `${name} (x${qty})`)
    .join(", ");

  return `HISTORIAL DE COMPRAS del cliente en esta tienda (dato real, sus últimos ${orders.length} pedido(s) acá — nunca de otros clientes): ${summary}. Úsalo SOLO para recomendar de forma natural cuando tenga sentido (ej. "¿quieres reponer X?") — nunca lo menciones en cada mensaje, nunca de forma invasiva, y nunca lo repitas si ya lo usaste antes en esta misma charla.`;
}

// Bloque 28: formato compacto (una línea por producto, sin prosa repetida)
// para bajar tokens de entrada. Se cita por NÚMERO de catálogo (1, 2, 3...),
// no por el ID real (cuid) — probado en vivo: los cuids de productos creados
// en el mismo lote comparten buena parte del prefijo (ej.
// cmrdnjaxq.../cmrdnjaxo...) y un modelo chico (Groq 8B) los confundía,
// citando en addToCart un producto distinto al que mencionaba en el texto.
// Un número corto y secuencial es mucho más preciso de citar para un modelo
// así. postChatMessage traduce el número de vuelta al producto real antes
// de validar o guardar nada (ver resolveCatalogIndex) — nunca se persiste
// ni se le muestra al cliente el número, solo lo usa el modelo puertas
// adentro. tags y options (variantes reales, ej. Talla/Color) se incluyen
// para que el bot pueda buscar por palabra clave y preguntar por variantes
// de verdad en vez de inventarlas cuando el pedido del cliente es ambiguo.
// Bloque 30: "stock" ya no es el bruto de la base — es lo que REALMENTE se
// le puede agregar al carrito a partir de ahora, descontando lo que ese
// mismo cliente ya tiene en su carrito (cartQuantities, mandado por el
// frontend en cada request — ver postChatMessage). Sin esto el modelo veía
// "stock 1" con 1 ya en el carrito y no tenía forma de saber que el
// disponible real para agregar es 0 — confirmado en vivo (Bloque 30): el
// bot ofrecía "agregar 2 más" sobre 1 unidad ya en el carrito con stock
// total 1. CartContext.addItem tiene su propio clamp de stock bruto (nunca
// deja el carrito en un número imposible), pero eso no evita que el TEXTO
// del bot prometa algo que no va a pasar — este cambio ataca el problema en
// el origen, dándole al modelo el número correcto para razonar y para que
// su propia respuesta ya sea precisa.
// Bloque 43 (bug real reportado en vivo: cliente con productos reales en el
// carrito, el bot dijo que estaba vacío): antes, la ÚNICA señal del carrito
// que veía el modelo era la anotación "ya tiene X en el carrito" enterrada
// dentro de la línea de CADA producto del catálogo (ver catalogText) — sin
// ningún resumen agregado, y sin ninguna regla en REGLAS que le dijera qué
// hacer con esos datos dispersos si preguntaban directo "¿qué tengo en el
// carrito?". Un modelo chico (Groq 8B) no ata cabos solo de forma
// confiable — mismo patrón ya resuelto para pedidos (CONSULTA DE PEDIDO) e
// historial de compras (HISTORIAL DE COMPRAS): un bloque EXPLÍCITO,
// dedicado, con la respuesta ya armada, en vez de esperar que el modelo la
// infiera. products acá ya viene garantizado por loadVendorForChat para
// incluir todo lo que haya en cartQuantities, así que nunca falta un
// nombre/precio.
function cartText(products, cartQuantities) {
  const lines = Object.entries(cartQuantities ?? {})
    .filter(([, qty]) => qty > 0)
    .map(([productId, qty]) => {
      const p = products.find((prod) => prod.id === productId);
      if (!p) return null;
      const unit = resolveUnitPrice(p.price, p.priceTiers, qty);
      return `${qty}x ${p.name} (${fmtPrice(unit, p.currency)} c/u, subtotal ${fmtPrice(unit * qty, p.currency)})`;
    })
    .filter(Boolean);
  if (!lines.length) return "TU CARRITO ACTUAL (en esta tienda): vacío — no tiene ningún producto agregado ahora mismo.";
  return `TU CARRITO ACTUAL (en esta tienda, dato real y actual — única fuente de verdad, nunca lo contradigas):\n${lines.join("\n")}`;
}

// Envío para el bot (ver lib/shipping.js): con envío de tienda manda ese; si no, cada producto dice el suyo en el catálogo.
function originProvinceName(vendor) {
  const loc = (vendor.locations ?? []).find((l) => l.provinceId && l.provinceId === vendor.shippingOriginProvinceId) ?? (vendor.locations ?? []).find((l) => l.provinceId);
  return loc?.province?.name ?? null;
}

function fixedFeeText(local, other, currency, vendor) {
  const prov = originProvinceName(vendor);
  if (Number(local) === Number(other)) return fmtPrice(local, currency);
  return `${fmtPrice(local, currency)} en ${prov ?? "la provincia de la tienda"} y ${fmtPrice(other, currency)} fuera de ella`;
}

function shippingPolicyText(vendor) {
  if (vendor.storeShippingMode === "FIXED") {
    return `Envío: fijo de ${fixedFeeText(vendor.storeShippingLocal, vendor.storeShippingOther, vendor.storeShippingCurrency, vendor)}, una sola vez por pedido, aparte del precio de los productos.`;
  }
  if (vendor.storeShippingMode === "COORDINATE") {
    return "Envío: se coordina con la tienda según el lugar de entrega; no se cobra al hacer el pedido.";
  }
  return "Envío: lo define cada producto (campo \"envío\" del catálogo). Los gratis no cobran; los de precio fijo se suman aparte del precio; los \"a coordinar\" se acuerdan con la tienda según el lugar de entrega.";
}

function productShippingText(p, vendor) {
  if (vendor.storeShippingMode) return "";
  if (p.shippingMode === "FIXED") return ` · envío: ${fixedFeeText(p.shippingLocal, p.shippingOther, p.shippingCurrency, vendor)}${p.shippingPerUnit ? " por unidad" : " por pedido"}`;
  if (p.shippingMode === "COORDINATE") return " · envío: a coordinar";
  return " · envío: gratis";
}

function catalogText(products, cartQuantities, vendor) {
  if (!products.length) return "(Sin productos publicados.)";
  return products
    .map((p, i) => {
      const price = fmtPrice(p.price, p.currency) + (p.oldPrice ? ` (antes ${fmtPrice(p.oldPrice, p.currency)})` : "") + tiersText(p);
      const inCart = cartQuantities[p.id] ?? 0;
      const available = Math.max(0, p.stock - inCart);
      let stock;
      // Bloque 56: "disponible siempre" — el modelo nunca ve un número de
      // stock para este producto, nunca lo puede dar por agotado.
      if (p.unlimitedStock) stock = "disponible siempre (sin límite de stock)";
      else if (p.stock <= 0) stock = "AGOTADO";
      else if (inCart > 0 && available > 0) stock = `disponible para agregar: ${available} más (ya tiene ${inCart} en el carrito, stock total ${p.stock})`;
      else if (inCart > 0) stock = `disponible para agregar: 0 (ya tiene TODO el stock en el carrito: ${inCart} de ${p.stock})`;
      else stock = `stock ${p.stock}`;
      const tags = p.tags?.length ? ` · tags: ${p.tags.join(", ")}` : "";
      const options = p.options?.length ? ` · variantes: ${p.options.map((o) => `${o.name}(${o.values.join("/")})`).join("; ")}` : "";
      // Bloque 42 (optimización de tokens): el modelo no necesita la
      // descripción ENTERA para recomendar/responder — 150 chars alcanza
      // como resumen. Esto solo achica lo que LEE el modelo; la tarjeta de
      // producto que ve el cliente (toCardProduct) sigue usando p.description
      // completa, sin cambios.
      const descText = p.description?.length > 150 ? `${p.description.slice(0, 150)}…` : p.description;
      const desc = descText ? ` — ${descText}` : "";
      return `[${i + 1}] ${p.name} · ${price} · ${stock}${productShippingText(p, vendor)}${tags}${options}${desc}`;
    })
    .join("\n");
}

// Documento + catálogo + datos reales del negocio + reglas, todo como
// "contexto fijo" separado de los turnos de la charla (ver
// chatWithStoreAssistant). El documento se manda como contenido nativo de
// Gemini (texto embebido si es .txt, inlineData base64 si es .pdf) — nunca
// se extrae a mano, el modelo lo lee directo.
// Bloque 28: reescrito compacto (menos tokens de entrada por request) sin
// perder ninguna de las reglas anti-alucinación ya probadas en vivo en
// bloques anteriores — solo más densas. Suma dos reglas nuevas: rechazar
// temas fuera del alcance de la tienda (antes solo cubría "otras tiendas"),
// y pedir aclaración ante un pedido ambiguo en vez de asumir. También suma
// "addToCart" a la salida — la acción real de agregar al carrito la
// ejecuta el frontend (CartContext), nunca el modelo ni el backend, así
// que el prompt es explícito: el modelo nunca afirma "ya lo agregué".
async function buildSystemParts(vendor, cartQuantities, orderContext, purchaseHistoryContext, message) {
  const fewShot = await buildFewShotBlock("TIENDA");
  const { siteName } = await getBrandSettings();
  const parts = [
    {
      // Bloque 30: probado en vivo — con "CONSULTA DE PEDIDO" ubicado más
      // abajo (entre REGLAS y SALIDA), el modelo (Groq 8B) llegó a
      // CONTRADECIR datos reales ya resueltos acá (dijo "no encontramos
      // ningún pedido" pese a que el bloque de abajo tenía 2 pedidos reales
      // con ese email) — la alucinación más grave vista en todo este
      // sistema hasta ahora, porque no es "no hizo la acción" sino "afirmó
      // un hecho falso verificable". Subir este bloque a lo PRIMERO que lee
      // el modelo (antes que nada más) mejoró la adherencia en las pruebas
      // — un modelo chico le presta más atención a lo que lee primero.
      // Bloque 43: mismo criterio para el carrito — TU CARRITO ACTUAL va acá
      // arriba de todo, no enterrado en el catálogo (ver cartText).
      text: `${cartText(vendor.products, cartQuantities)}\n\n${orderContext ? `${orderContext}\n\n` : ""}${purchaseHistoryContext ? `${purchaseHistoryContext}\n\n` : ""}Eres el asistente de "${vendor.companyName}" (tienda verificada en ${siteName}, Cuba). ${vendor.description ?? ""}

DATOS DEL NEGOCIO (única fuente — nunca inventes ni cambies nada):
${scheduleText(vendor.schedules)}
${deliveryCoverageText(vendor)}
${shippingPolicyText(vendor)}
${paymentMethodsText(vendor.acceptedPaymentMethods)}
WhatsApp: ${vendor.whatsapp}

CATÁLOGO (único válido, número de catálogo entre corchetes al principio de cada línea; "disponible para agregar" ya descuenta lo que el cliente tiene en su carrito ahora mismo):
${catalogText(vendor.products, cartQuantities, vendor)}

REGLAS (en orden de importancia):
1. Datos: usa solo lo de arriba (carrito, consulta de pedido, datos del negocio, cobertura, catálogo, documento). Nunca inventes productos, precios, stock, variantes, horarios, ubicación, pagos ni políticas (envíos, devoluciones, garantías), ni excepciones para quedar bien. Si no lo sabes, dilo y sugiere WhatsApp (${vendor.whatsapp}). Si no se entiende qué pide y no hay dato real que responda, pide que lo explique con otras palabras.
2. Alcance: solo "${vendor.companyName}". Otros temas, otras tiendas o ${siteName} en general: dilo breve y amable, sin responderlos.
3. Estilo: español neutro como en Cuba (nunca vosotros, vale, tío, coger, ordenador, móvil). 1-2 líneas, directo y profesional, sin relleno ni exclamaciones; más largo solo si lo pide. Listas: un elemento por línea con "- "; para comparar, tabla markdown.
4. Conversación: relee el historial. Nunca repitas una pregunta o frase ya dicha, nunca pidas un dato que ya dio, nunca te contradigas (si un dato cambió, dilo: "ahora mismo cambió a..."). Una sola pregunta por mensaje.
5. Disponibilidad (va antes que vender): ante "¿tienen...?", "¿hay...?", "¿cuánto sale...?" o "quiero comprar..." (también con nombre parcial o mal escrito), busca el producto en el catálogo de ESTE mensaje:
   - Dice AGOTADO: "Sí lo vendemos, pero ahora está agotado"; ofrece solicitarlo o avisar cuando reponga. Nunca "tenemos"/"disponible", nunca el precio sin aclararlo antes, nunca agregarlo.
   - No está en el catálogo: esta tienda no lo vende; dilo claro, nunca lo confundas con agotado.
   - Antes de citar un número de catálogo, comprueba que es exactamente ese producto.
6. Variantes: si falta talla, color u otra variante real del producto, pregunta UNA por vez y solo con las opciones reales ("¿en qué talla, S, M o L?"). Si ya queda una sola opción clara, responde directo.
7. Precios por cantidad: si el producto los tiene, úsalos para mayoreo (precio por unidad del tramo que alcanza y el total), en la moneda del catálogo.
8. Venta: sugiere lo relacionado o con descuento (oldPrice = precio anterior) cuando aplique, sin forzar y nunca un agotado.
9. Carrito (solo si el cliente lo pide; texto y acción SIEMPRE juntos, decirlo sin la acción no cambia nada):
   - Agregar: "addToCart", nunca más de "disponible para agregar". Si piden más, agrega lo que hay diciéndolo o explica cuánto hay. Con 0 disponible no agregues: "Solo queda 1 unidad y ya la tienes en el carrito."
   - Sacar un producto entero: "removeFromCart". Quitar algunas unidades de uno que tiene 2 o más: "reduceCart" con la cantidad a QUITAR. Vaciar todo: "clearCart": true.
   - Habla en presente ("te lo agrego", "lo saco"), nunca en pasado ("ya lo agregué"): eso lo confirma la pantalla.
   - Qué hay en el carrito o cuánto suma: solo "TU CARRITO ACTUAL". Si lista productos, nunca digas que está vacío.
10. Cómo se compra: el cliente abre su carrito ("Ver mi carrito"), pulsa "Continuar al checkout", completa sus datos y finaliza; después la tienda lo contacta por WhatsApp. Nunca le pidas escribir o llamar a WhatsApp para hacer o confirmar un pedido (ese número es solo para dudas que no puedas resolver) ni sugieras "Confirmar pedido por WhatsApp".
11. Pedidos: si arriba aparece "CONSULTA DE PEDIDO", es el resultado real: úsalo tal cual. Si no aparece y preguntan por un pedido, pide el email o el número de confirmación.

${fewShot}

SALIDA (solo JSON): {"text": "...", "productIds": ["N"], "addToCart": [{"productId": "N", "quantity": 1}], "removeFromCart": ["N"], "reduceCart": [{"productId": "N", "quantity": 1}], "clearCart": false, "suggestedFollowUps": ["...", "..."]}
- text: tus palabras, sin copiar líneas del catálogo ("·", "stock", "AGOTADO") ni números de catálogo o IDs.
- productIds: números de catálogo (los de los corchetes) de los productos que mencionas, para mostrar su tarjeta. Si dices que vas a agregar uno, va en addToCart y en productIds.
- removeFromCart / reduceCart / clearCart: según la regla 9; un producto nunca en removeFromCart y reduceCart a la vez.
- suggestedFollowUps: 2-3 preguntas cortas (3-6 palabras) que el cliente haría después de ESTA respuesta, basadas en datos reales y distintas cada vez.
Ejemplos (números inventados): "agrégame el 7" con stock -> {"text": "Dale, te agrego 1 al carrito.", "productIds": ["7"], "addToCart": [{"productId": "7", "quantity": 1}]}. Tiene 2 del 7 y dice "quita uno" -> {"text": "Te quito una unidad y te dejo una.", "productIds": ["7"], "reduceCart": [{"productId": "7", "quantity": 1}]}. El 4 dice AGOTADO -> {"text": "Sí lo vendemos, pero ahora está agotado. ¿Te aviso cuando repongamos?", "productIds": ["4"], "suggestedFollowUps": ["Avísame cuando repongan", "Ver algo similar"]}.`,
    },
  ];

  // Bloque 42 (optimización de tokens): el documento de negocio (.txt/.pdf
  // subido por la tienda) solo viaja cuando el mensaje ACTUAL parece
  // necesitarlo de verdad (ver messageNeedsDocument) — un saludo o "quiero
  // comprar X" no lo carga. Corte de 20000 a 5000 chars por el mismo motivo:
  // era el ítem más caro del prompt y casi nunca hace falta completo.
  if (vendor.aiDocument && messageNeedsDocument(message)) {
    try {
      const filepath = join(VENDOR_AI_DOC_DIR, vendor.aiDocument);
      if (vendor.aiDocument.toLowerCase().endsWith(".pdf")) {
        const buffer = await readFile(filepath);
        parts.push({ inlineData: { mimeType: "application/pdf", data: buffer.toString("base64") } });
      } else {
        const text = await readFile(filepath, "utf-8");
        parts.push({ text: `\nDocumento de negocio subido por la tienda (políticas, horarios, preguntas frecuentes, etc.):\n${text.slice(0, 5000)}` });
      }
    } catch {
      // Documento no legible (borrado del disco a mano, etc.) — el bot
      // sigue andando solo con el catálogo, no corta la conversación.
    }
  }

  return parts;
}

// Forma que consume la tarjeta de producto del chat (StoreChatWidget.jsx) —
// stock incluido a propósito: una tarjeta de un producto agotado muestra
// "Solicitar" en vez de "Agregar al carrito" (mismo criterio del Bloque 23).
// Bloque 34: suma description/oldPrice — ya se traían de la base (ver el
// select de loadVendorForChat) pero no se le pasaban a la tarjeta; hacen
// falta para la descripción corta y el badge de descuento del nuevo diseño.
function toCardProduct(p) {
  return {
    id: p.id,
    name: p.name,
    slug: p.slug,
    price: p.price,
    oldPrice: p.oldPrice,
    currency: p.currency,
    description: p.description,
    images: p.images,
    stock: p.stock,
    unlimitedStock: p.unlimitedStock ?? false,
  };
}

const chatMessageSchema = z.object({
  sessionId: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1, "Escribe una pregunta.").max(1000),
  // Bloque 30: snapshot efímero de "cuánto de cada producto tiene el
  // cliente en su carrito ahora mismo" — CartContext es 100% cliente
  // (localStorage), el backend no tiene otra forma de saberlo. Nunca se
  // guarda en ningún lado, solo se usa para armar el catálogo de ESTE
  // request (ver catalogText) y para validar addToCart más abajo.
  cartQuantities: z.record(z.string(), z.number().int().min(0)).optional().default({}),
});

export async function postChatMessage(req, res) {
  const { vendorId } = req.params;
  const { sessionId, message, cartQuantities } = chatMessageSchema.parse(req.body);

  const recent = await prisma.chatMessage.findMany({
    where: { vendorId, sessionId },
    orderBy: { createdAt: "desc" },
    // Bloque 281: se leen más mensajes, pero a la IA solo van los últimos tal cual y el
    // resto como MEMORIA corta (lib/chatMemory.js): menos tokens en cada pedido.
    take: MEMORY_FETCH_LIMIT,
  });
  // Sesión vencida (>24h desde el último mensaje) = se trata como charla
  // nueva de cara al modelo, aunque el cliente siga mandando el mismo
  // sessionId viejo (ej. localStorage desactualizado) — no se le pasa
  // contexto de una charla de hace más de un día.
  const history = isSessionExpired(recent[0]) ? [] : recent.reverse();

  // Bloque 39 (Parte 2): message/history ya resueltos ACÁ (antes de esto,
  // loadVendorForChat se llamaba primero y no tenía ninguno de los dos) —
  // hacen falta para decidir la búsqueda real en catálogos grandes en vez
  // de volcar siempre los últimos N productos (ver dentro de la función).
  const vendor = await loadVendorForChat(vendorId, message, history, cartQuantities);

  await prisma.chatMessage.create({ data: { vendorId, sessionId, role: "user", content: message } });

  // Bloque 39 (Parte 1): sin login, esto da null y el resto sigue exactamente
  // igual que siempre (nunca obligatorio).
  const userId = await resolveOptionalUserId(req);

  // Bloque 33: de acá para abajo es todo lo que puede fallar por un
  // problema técnico real (proveedor de IA caído, timeout, etc.) — nunca se
  // le muestra el error real al cliente (ni mensaje de excepción, ni código
  // HTTP, ni nombre del proveedor): se registra en ErrorLog (visible solo
  // en Admin > Errores) y se responde con una señal genérica y estable que
  // el frontend usa para mostrar la tarjeta de "problemas técnicos" +
  // Reintentar. El mensaje del cliente YA quedó guardado arriba, así que
  // "Reintentar" en el frontend es simplemente volver a mandar el mismo
  // texto — no hace falta ninguna lógica especial de reintento acá.
  let rawText, productIds, addToCart, removeFromCart, reduceCart, clearCart, suggestedFollowUps;
  try {
    // Bloque 83 (pedido explícito de mejorar tiempo de respuesta): estas 2
    // consultas son independientes entre sí (una mira pedidos por
    // email/código en el mensaje, la otra el historial de compras del
    // cliente logueado) — corrían una detrás de la otra sin ninguna razón,
    // sumando su latencia en vez de superponerse.
    const [orderContext, purchaseHistoryContext] = await Promise.all([
      lookupOrderContext(vendorId, message, userId),
      buildPurchaseHistoryContext(vendorId, userId),
    ]);
    const systemParts = await buildSystemParts(vendor, cartQuantities, orderContext, purchaseHistoryContext, message);
    const { history: aiHistory, memory } = compactHistory(history);
    if (memory) systemParts.push({ text: memory });
    if (vendor.searchNote) systemParts.splice(1, 0, { text: vendor.searchNote });
    // No se entendió qué busca: se le pide que lo repita, sin consultar al modelo ni mostrar productos.
    if (vendor.unclearQuery) ({ rawText, productIds, addToCart, removeFromCart, reduceCart, clearCart, suggestedFollowUps } = { rawText: UNCLEAR_REPLY, productIds: [], addToCart: [], removeFromCart: [], reduceCart: [], clearCart: false, suggestedFollowUps: [] });
    else ({ text: rawText, productIds, addToCart, removeFromCart, reduceCart, clearCart, suggestedFollowUps } = await chatWithStoreAssistant({ systemParts, history: aiHistory, message, onTextDelta: req.streamText, onReset: req.streamReset }));
  } catch (err) {
    await logError({
      origin: "BOT_TIENDA",
      message: err instanceof Error ? err.message : String(err),
      context: { vendorId, companyName: vendor.companyName, sessionId, statusCode: err?.statusCode, detail: err?.details?.detail },
    });
    return res.status(503).json({ error: "chat_unavailable" });
  }

  // Bloque 28: red de seguridad — el prompt le prohíbe escribir "[ID:...]" o
  // el número de catálogo dentro de "text", pero un modelo chico (ej. Groq
  // 8B) igual lo hizo en vivo durante las pruebas de este bloque (se vieron
  // ambas variantes: "[ID:xxx]" completo Y el número pelado, ej. "[2]",
  // copiado de una línea del catálogo). Nunca confiar en que el modelo
  // cumplió la instrucción al 100%: se limpia cualquier resto acá antes de
  // que el cliente lo vea, y se recompone el espaciado/puntuación que queda
  // colgando después de sacar el corchete (ej. "carrito [2]." -> "carrito.").
  const text = rawText
    .replace(/\[ID:[a-z0-9]+\]/gi, "")
    .replace(/\[\d{1,3}\]/g, "")
    .replace(/ {2,}/g, " ")
    .replace(/ +([.,;:])/g, "$1")
    .trim();

  // Bloque 28: el modelo cita productos por su número de catálogo (1, 2,
  // 3...), no por su ID real — ver la nota larga en catalogText. Acá se
  // traduce cada número de vuelta al producto real ANTES de cualquier otra
  // validación; un número fuera de rango o repetido simplemente no
  // resuelve a nada (se descarta, mismo criterio anti-alucinación del
  // Bloque 21/24 aplicado ahora a la cita en vez de a un ID suelto).
  const catalogByIndex = new Map(vendor.products.map((p, i) => [String(i + 1), p]));
  function resolveCatalogIndex(idx) {
    return idx == null ? null : catalogByIndex.get(String(idx)) ?? null;
  }

  const recommended = [...new Set((productIds ?? []).map(String))].map(resolveCatalogIndex).filter(Boolean);

  // Límite conocido (Groq 8B, probado en vivo con temperature 0.2 tras el
  // Bloque 28): en ~1 de cada 5 pedidos explícitos de "agregar al carrito",
  // el modelo responde en "text" con la frase correcta ("te lo agrego
  // ahora") pero deja "addToCart" vacío — json_object en Groq garantiza JSON
  // válido, no que el modelo complete todos los campos que debería (a
  // diferencia de Gemini, que sí fuerza esto con responseSchema.required).
  // Se decidió NO compensar esto adivinando la intención desde "text" con
  // regex/keywords: eso reintroduciría el mismo problema que este bloque
  // vino a cerrar (acción disparada por texto libre en vez de una señal
  // estructurada), solo que más frágil todavía. El diseño ya garantiza que
  // esto nunca corrompe estado ni miente al cliente — sin addToCart no hay
  // toast ni carrito actualizado, así que el peor caso es que el bot diga
  // que va a hacer algo y no pase nada visible, nunca una confirmación
  // falsa. Si esto se vuelve más frecuente, la próxima palanca es probar un
  // modelo Groq más grande (ver nota de MODEL en groq.js) en vez de seguir
  // ajustando el prompt.
  //
  // addToCart es la señal de "el cliente pidió agregar esto de verdad" —
  // se valida stock > 0 además de resolver contra el catálogo real (nunca
  // se puede "agregar al carrito" algo agotado, ese caso usa "Solicitar",
  // ver Bloque 23). Nunca se persiste en ChatMessage: es una acción de UN
  // SOLO USO en el momento de este mensaje — si se guardara y se
  // "re-mostrara" al reabrir el historial, el frontend la volvería a
  // ejecutar y agregaría el producto de nuevo sin que el cliente lo haya
  // pedido esta vez. La acción real (CartContext.addItem) la ejecuta el
  // frontend, acá solo se valida y se resuelve la data que necesita.
  //
  // Bloque 30 — FIX CRÍTICO: antes acá solo se chequeaba stock > 0 (bruto),
  // nunca la cantidad pedida contra lo REALMENTE disponible (stock menos lo
  // que ya tiene en el carrito) — confirmado en vivo: con 1 unidad ya en el
  // carrito y stock total 1, el bot pedía agregar 2 más y esto lo dejaba
  // pasar igual. Ahora se calcula "available" con el mismo cartQuantities
  // que ya vio el modelo (nunca confiar en que el modelo respetó el número
  // que se le mostró) y, si la cantidad pedida lo supera, la entrada entera
  // se DESCARTA — nunca se agrega una cantidad distinta a la que el texto
  // prometió (mismo criterio de "nada visible antes que algo incorrecto"
  // que ya usa este archivo para el caso de addToCart vacío).
  const validAddToCart = (Array.isArray(addToCart) ? addToCart : [])
    .map((a) => ({ product: a && resolveCatalogIndex(a.productId), quantity: Math.max(1, Number(a?.quantity) || 1) }))
    .filter((a) => {
      if (!a.product) return false;
      if (a.product.unlimitedStock) return true; // Bloque 56: "disponible siempre" — nunca lo bloquea el stock.
      const available = a.product.stock - (cartQuantities[a.product.id] ?? 0);
      return available > 0 && a.quantity <= available;
    })
    .map((a) => ({ ...toCardProduct(a.product), quantity: a.quantity }));

  // Bloque 40 (bug real reportado en vivo: "vaciá el carrito" -> el bot dijo
  // que sí pero el carrito seguía con productos): mismo criterio que
  // addToCart — el número de catálogo se traduce al producto REAL acá,
  // nunca se persiste (acción de un solo uso), y quien la ejecuta de verdad
  // es el frontend (CartContext.removeItem/clearCart), nunca este backend
  // (el carrito es 100% del cliente). clearCart no necesita resolverse
  // contra nada — vaciar un carrito que ya está vacío es un no-op inofensivo.
  const validRemoveFromCart = [...new Set((removeFromCart ?? []).map(String))]
    .map(resolveCatalogIndex)
    .filter(Boolean)
    .map((p) => p.id);
  // Bloque 249 (bug real reportado en vivo: el cliente tenía 2 batidos, pidió
  // quitar uno y el bot sacó los dos): "reduceCart" quita solo N unidades. El
  // número de catálogo se traduce al producto real, la cantidad se limita a lo
  // que de verdad hay en el carrito (cartQuantities, lo mismo que vio el
  // modelo) y un producto que ya va entero en removeFromCart no se repite.
  const wholeLineIds = new Set(validRemoveFromCart);
  const reduceById = new Map();
  for (const entry of Array.isArray(reduceCart) ? reduceCart : []) {
    const product = entry && resolveCatalogIndex(entry.productId);
    if (!product || wholeLineIds.has(product.id)) continue;
    const inCart = cartQuantities[product.id] ?? 0;
    const quantity = Math.min(Math.max(1, Math.floor(Number(entry.quantity)) || 1), inCart);
    if (quantity < 1) continue;
    reduceById.set(product.id, (reduceById.get(product.id) ?? 0) + quantity);
  }
  const validReduceCart = [...reduceById.entries()].map(([productId, quantity]) => ({ productId, quantity: Math.min(quantity, cartQuantities[productId] ?? quantity) }));
  const validClearCart = clearCart === true;

  // Cualquier producto que se vaya a agregar al carrito muestra su tarjeta
  // también, aunque el modelo se haya olvidado de listarlo en productIds —
  // más robusto que confiar en que siempre lo haga bien.
  const validIds = [...new Set([...recommended.map((p) => p.id), ...validAddToCart.map((a) => a.id)])];

  const saved = await prisma.chatMessage.create({
    data: { vendorId, sessionId, role: "model", content: text, productIds: validIds },
  });
  logChatExchange({ bot: "TIENDA", vendorId, userId, sessionId, question: message, answer: text });
  const catalogById = new Map(vendor.products.map((p) => [p.id, p]));
  const products = validIds.map((id) => toCardProduct(catalogById.get(id)));
  // Bloque 34: sugerencias de seguimiento — nunca se persisten (igual que
  // addToCart, son de UN SOLO USO para este mensaje puntual). Nunca confiar
  // en que el modelo cumplió el límite/formato pedido en el prompt: se
  // sanitiza acá antes de que el cliente las vea (máx 3, string no vacío).
  const followUps = (Array.isArray(suggestedFollowUps) ? suggestedFollowUps : [])
    .filter((s) => typeof s === "string" && s.trim())
    .map((s) => cleanFollowUp(s))
    .filter(Boolean)
    .slice(0, 3);
  res.status(201).json({
    message: { ...saved, products, addToCart: validAddToCart, removeFromCart: validRemoveFromCart, reduceCart: validReduceCart, clearCart: validClearCart, suggestedFollowUps: followUps },
  });
}

const historyQuerySchema = z.object({ sessionId: z.string().trim().min(1).max(100) });

export async function getChatHistory(req, res) {
  const { vendorId } = req.params;
  const { sessionId } = historyQuerySchema.parse(req.query);

  // A diferencia de postChatMessage, acá no tiene sentido tirar un error si
  // la tienda dejó de estar verificada entre que se abrió la página y se
  // pidió el historial — simplemente no hay nada que mostrar.
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { verificationStatus: true, isBlocked: true, status: true, planType: true } });
  if (!vendor || vendor.isBlocked || vendor.status !== "ACTIVE" || !isPremiumActive(vendor)) return res.json({ messages: [] });
  const config = await getPlanConfig(vendor.planType);
  if (!config?.allowAiChatbot) return res.json({ messages: [] });

  const messages = await prisma.chatMessage.findMany({ where: { vendorId, sessionId }, orderBy: { createdAt: "asc" } });

  // Bloque 26: sesión vencida (>24h desde el último mensaje) — no se
  // sigue mostrando ni continuando, el cliente ve el chat como si recién
  // empezara (mensaje de bienvenida). El historial sigue intacto en la
  // base, solo se deja de devolver acá. `expired: true` le avisa al
  // frontend que rote su sessionId aunque su propio chequeo de
  // localStorage no lo haya detectado (ej. la pestaña quedó abierta 24h+).
  if (isSessionExpired(messages[messages.length - 1])) {
    return res.json({ messages: [], expired: true });
  }

  // Bloque 24: reabrir el chat tiene que seguir mostrando las mismas
  // tarjetas — se resuelven de nuevo acá (una sola consulta para toda la
  // historia) a partir de los productIds ya guardados y filtrados en su
  // momento por postChatMessage.
  const allProductIds = [...new Set(messages.flatMap((m) => m.productIds ?? []))];
  const products = allProductIds.length
    ? await prisma.product.findMany({
        where: { id: { in: allProductIds } },
        select: { id: true, name: true, slug: true, price: true, oldPrice: true, currency: true, description: true, images: true, stock: true, unlimitedStock: true },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const messagesWithProducts = messages.map((m) => ({
    ...m,
    products: (m.productIds ?? []).map((id) => productById.get(id)).filter(Boolean).map(toCardProduct),
  }));

  res.json({ messages: messagesWithProducts });
}
