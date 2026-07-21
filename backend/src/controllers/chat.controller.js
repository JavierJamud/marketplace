import { z } from "zod";
import jwt from "jsonwebtoken";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../lib/prisma.js";
import { env } from "../config/env.js";
import { AppError } from "../utils/AppError.js";
import { chatWithStoreAssistant } from "../lib/ai.js";
import { VENDOR_AI_DOC_DIR } from "./vendors.controller.js";
import { logError } from "../lib/errorLog.js";
import { buildFewShotBlock } from "../lib/chatTrainingExamples.js";

// Cuántos turnos previos se mandan como contexto de conversación — alcanza
// para que el chat "se acuerde" de lo último sin inflar el request en una
// charla larga (Gemini no tiene memoria propia entre requests).
const HISTORY_LIMIT = 20;

// Bloque 39 (Parte 2) — bug real reportado: con más de 60 productos activos,
// el catálogo volcado al prompt truncaba en silencio a los últimos 60 más
// recientes (orderBy createdAt desc + take), así que el bot decía "no lo
// vendemos" sobre productos reales que sí existían pero habían quedado
// afuera del corte. Por debajo de este umbral se sigue volcando el
// catálogo COMPLETO (comportamiento de siempre, simple y sin cambios); por
// encima, se busca en TODA la base de esa tienda según lo que pide el
// cliente (ver searchVendorProductIdsByTerms) en vez de truncar por fecha.
const CATALOG_FULL_DUMP_THRESHOLD = 60;
// Techo de resultados que de verdad se muestran/pasan al prompt en el modo
// búsqueda — nunca implica que la búsqueda en sí esté acotada a esto (esa
// corre contra la tabla entera), solo cuántos candidatos se listan.
const CATALOG_SEARCH_POOL = 60;

// Bloque 39 (Parte 2): mismo criterio de siempre (assistant.controller.js)
// para extraer términos de búsqueda reales de un mensaje conversacional —
// duplicado a propósito acá (mismo criterio de todo este proyecto: los dos
// bots son hermanos independientes, sin importar uno del otro).
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
  return rawText.toLowerCase().replace(/[¿?¡!.,;:]/g, "").split(/\s+/).filter((w) => w.length >= 3 && !STOPWORDS.has(w));
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
  stock: true,
  images: true,
  tags: true,
  options: { select: { name: true, values: true } },
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
const PAYMENT_METHOD_LABELS = {
  zelle: "Zelle",
  visa: "Visa",
  mastercard: "Mastercard",
  usdt: "USDT",
  tropipay: "Tropipay",
  card: "Tarjeta de crédito/débito",
  bizum: "Bizum",
  postepay: "Postepay",
  iban: "IBAN / Transferencia",
  paypal: "PayPal",
  cashapp: "Cash App",
  venmo: "Venmo",
};

// 0 = domingo .. 6 = sábado — mismo orden que Prisma (VendorSchedule.dayOfWeek).
const DAY_NAMES = ["Domingo", "Lunes", "Martes", "Miércoles", "Jueves", "Viernes", "Sábado"];

// Bloque 30: mismas etiquetas que STATUS_LABEL de VendorOrders.jsx — el
// cliente ve el mismo lenguaje que el vendedor usa en su panel para el
// mismo estado real, nunca una traducción distinta inventada acá.
const ORDER_STATUS_LABEL = { NEW: "Pendiente", PREPARING: "Vendido/Confirmado", READY: "Listo", DELIVERED: "Entregado", CANCELLED: "Rechazado" };

// Bloque 39 (Parte 2): "message"/"history" ya no son opcionales — hacen
// falta para decidir QUÉ buscar cuando el catálogo es grande (ver abajo).
// Catálogos chicos (<= CATALOG_FULL_DUMP_THRESHOLD) siguen recibiendo el
// volcado completo de siempre, sin este paso extra.
async function loadVendorForChat(vendorId, message, history) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    include: {
      locations: { include: { province: true, municipality: true } },
      schedules: true,
      _count: { select: { products: { where: { isActive: true } } } },
    },
  });
  if (!vendor || vendor.isBlocked) throw new AppError("Tienda no encontrada.", 404);
  // Mismo gate que el widget del frontend (no lo muestra si no está
  // verificada) — pero acá es lo que de verdad importa: sin esto, cualquiera
  // podría pegarle al endpoint directo sin pasar por la UI.
  if (!vendor.isVerified) throw new AppError("El chat con IA solo está disponible para tiendas verificadas.", 403);

  const totalActive = vendor._count.products;
  let products;
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

  return { ...vendor, products };
}

function scheduleText(schedules) {
  if (!schedules?.length) return "Horario: no cargado en el sistema — si preguntan, sugerí confirmar por WhatsApp.";
  const byDay = new Map(schedules.map((s) => [s.dayOfWeek, s]));
  const lines = DAY_NAMES.map((name, i) => {
    const s = byDay.get(i);
    if (!s || s.isClosed) return `${name}: cerrado`;
    return `${name}: ${s.opensAt}–${s.closesAt}`;
  });
  return `Horario semanal:\n${lines.join("\n")}`;
}

function locationText(locations) {
  if (!locations?.length) return "Ubicación: no cargada en el sistema.";
  const list = locations.map((l) => `${l.municipality?.name ? `${l.municipality.name}, ` : ""}${l.province?.name ?? ""}`).join(" · ");
  return `Zonas donde vende/entrega en Cuba: ${list}`;
}

function paymentMethodsText(ids) {
  if (!ids?.length) return "Métodos de pago: no cargados en el sistema — si preguntan, sugerí confirmar por WhatsApp.";
  return `Métodos de pago que acepta: ${ids.map((id) => PAYMENT_METHOD_LABELS[id] ?? id).join(", ")}`;
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

// Campos deliberadamente acotados: código, estado, fecha, ítems y total —
// nunca teléfono ni dirección de envío. El chat de una tienda no requiere
// login, así que cualquiera puede escribir un email/código ajeno; esto
// limita qué se puede llegar a filtrar sobre otra persona a lo mínimo
// (nunca datos de contacto), aunque el brief no lo pida explícito.
async function lookupOrderContext(vendorId, message) {
  const emailMatch = message.match(EMAIL_REGEX);
  const codeMatch = message.match(ORDER_CODE_REGEX);
  if (!emailMatch && !codeMatch) return null;

  const or = [];
  if (emailMatch) or.push({ customerEmail: { equals: emailMatch[0], mode: "insensitive" } });
  if (codeMatch) or.push({ code: { equals: codeMatch[0].toUpperCase() } });

  const orders = await prisma.order.findMany({
    where: { vendorId, OR: or },
    orderBy: { createdAt: "desc" },
    take: 5,
    include: { items: true },
  });

  if (orders.length === 0) {
    return `CONSULTA DE PEDIDO: el cliente preguntó por un pedido (email/número "${emailMatch?.[0] ?? codeMatch[0]}") pero NO se encontró ningún pedido con ese dato en esta tienda. Decilo claramente — nunca inventes un estado ni asumas que existe.`;
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
function resolveOptionalUserId(req) {
  const token = req.headers.authorization?.startsWith("Bearer ") ? req.headers.authorization.slice(7) : null;
  if (!token) return null;
  try {
    return jwt.verify(token, env.jwtSecret).sub;
  } catch {
    return null;
  }
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

  return `HISTORIAL DE COMPRAS del cliente en esta tienda (dato real, sus últimos ${orders.length} pedido(s) acá — nunca de otros clientes): ${summary}. Usalo SOLO para recomendar de forma natural cuando tenga sentido (ej. "¿querés reponer X?") — nunca lo menciones en cada mensaje, nunca de forma invasiva, y nunca lo repitas si ya lo usaste antes en esta misma charla.`;
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
function catalogText(products, cartQuantities) {
  if (!products.length) return "(Sin productos publicados.)";
  return products
    .map((p, i) => {
      const price = fmtCUP(p.price) + (p.oldPrice ? ` (antes ${fmtCUP(p.oldPrice)})` : "");
      const inCart = cartQuantities[p.id] ?? 0;
      const available = Math.max(0, p.stock - inCart);
      let stock;
      if (p.stock <= 0) stock = "AGOTADO";
      else if (inCart > 0 && available > 0) stock = `disponible para agregar: ${available} más (ya tiene ${inCart} en el carrito, stock total ${p.stock})`;
      else if (inCart > 0) stock = `disponible para agregar: 0 (ya tiene TODO el stock en el carrito: ${inCart} de ${p.stock})`;
      else stock = `stock ${p.stock}`;
      const tags = p.tags?.length ? ` · tags: ${p.tags.join(", ")}` : "";
      const options = p.options?.length ? ` · variantes: ${p.options.map((o) => `${o.name}(${o.values.join("/")})`).join("; ")}` : "";
      const desc = p.description ? ` — ${p.description}` : "";
      return `[${i + 1}] ${p.name} · ${price} · ${stock}${tags}${options}${desc}`;
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
async function buildSystemParts(vendor, cartQuantities, orderContext, purchaseHistoryContext) {
  const fewShot = await buildFewShotBlock("TIENDA");
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
      text: `${orderContext ? `${orderContext}\n\n` : ""}${purchaseHistoryContext ? `${purchaseHistoryContext}\n\n` : ""}Sos el asistente de "${vendor.companyName}" (tienda verificada en ZeuDin, Cuba). ${vendor.description ?? ""}

DATOS DEL NEGOCIO (única fuente — nunca inventes ni cambies nada):
${scheduleText(vendor.schedules)}
${locationText(vendor.locations)}
${paymentMethodsText(vendor.acceptedPaymentMethods)}
WhatsApp: ${vendor.whatsapp}

CATÁLOGO (único válido, número de catálogo entre corchetes al principio de cada línea; "disponible para agregar" ya descuenta lo que el cliente tiene en su carrito ahora mismo):
${catalogText(vendor.products, cartQuantities)}

REGLAS:
- Idioma: español latinoamericano neutro (como se habla en Cuba) — NUNCA modismos ni gramática de España (nunca "vosotros"/"vuestro", "vale", "tío/tía", "coger" en el sentido de agarrar/tomar, "ordenador", "móvil" en vez de "celular", "vais", etc.).
- Alcance: SOLO "${vendor.companyName}" — catálogo, datos de arriba, documento adjunto. Nunca temas generales, otras tiendas, ni ZeuDin en general: si preguntan algo así, decilo breve y amable, sin responder el tema en sí.
- Breve: 1-2 líneas por defecto, directo, simple y profesional — sin relleno, sin repetir la pregunta, sin exclamaciones de más. Más largo solo si el cliente lo pide explícito.
- NUNCA repitas la misma pregunta, chip o frase (aunque cambies alguna palabra) que ya usaste en un turno anterior de ESTA charla — releé el historial antes de responder. Si el cliente ya dio un dato (talla, color, cantidad), no lo vuelvas a pedir salvo que él mismo lo cambie explícito. Cada pregunta tuya es UNA sola cosa concreta, nunca dos juntas en el mismo mensaje.
- NUNCA te contradigas dentro de la misma charla: si ya confirmaste algo real (stock, precio, un pedido) en un turno anterior, nunca lo niegues después salvo que el dato de ESTE mensaje (catálogo/CONSULTA DE PEDIDO de arriba) realmente haya cambiado — y si cambió, decilo explícito ("ahora mismo cambió a..."), nunca lo contradigas en silencio como si el turno anterior no hubiera pasado.
- Preciso: si el pedido es ambiguo (variantes de un producto, cuál de varios similares, cantidad) preguntá para aclarar en vez de asumir. Antes de citar un número de catálogo, releé cuál producto es EXACTAMENTE — nunca cites el número de un producto distinto al que mencionás en el texto.
- FILTRADO PROGRESIVO: si falta un dato para acotar bien (talla, color, marca, u otra variante real de "variantes:" del catálogo), preguntá de a UN dato por vez, breve — nunca varias preguntas juntas en el mismo mensaje (ej. nunca "¿qué talla, color y cantidad?" todo junto). Usá SIEMPRE las variantes reales del catálogo para preguntar (ej. "¿en qué talla, S, M o L?"), nunca inventes una variante que el producto no tenga. Si con lo que ya dijo el cliente hay un solo producto/variante clara, respondé directo sin seguir preguntando.
- Nunca inventes productos, precios, stock, variantes, horarios, ubicación, pagos ni políticas (envíos, devoluciones, garantías) fuera de lo de arriba o el documento — ni arreglos/excepciones de tu cosecha para sonar más servicial. Si no lo sabés, decilo y sugerí WhatsApp (${vendor.whatsapp}).
- Si la pregunta del cliente no tiene respaldo en ningún dato real de arriba (ni catálogo, ni datos del negocio, ni documento) y no hay forma de responderla con algo real: NUNCA inventes una respuesta ni afirmes/niegues algo que no sabés. Decí que no entendiste bien lo que pide y pedile que reformule o explique mejor qué está buscando — nunca un "no sé" seco ni una respuesta a medias sobre algo que no verificaste.
- DISPONIBILIDAD REAL: antes de responder CUALQUIER pregunta sobre si hay/tienen/les queda un producto, cuánto sale, o "quiero comprar X" (en cualquiera de esas formas — "¿tienen...?", "¿hay...?", "¿les queda...?", "quiero comprar...", "cuánto sale...", con nombre parcial o con errores de tipeo), buscalo en el catálogo de arriba por nombre o tags ANTES de asumir que no existe, y fijate su estado EXACTO:
  · Si el catálogo dice "AGOTADO" para ese producto: SÍ lo vende esta tienda, pero ahora mismo no hay stock — decilo así, explícito ("Sí lo vendemos, pero está agotado ahora mismo") y ofrecé "Solicitar este producto" o avisar cuando reponga. NUNCA digas "sí, tenemos" ni "disponible" para ese producto, y NUNCA des el precio sin aclarar primero que está agotado.
  · Si el producto NO aparece en el catálogo de arriba (ni con stock ni agotado): esta tienda no lo vende — decilo claro y directo, nunca lo confundas con "agotado".
  · Nunca respondas con un "no está disponible" genérico que no aclare cuál de los dos casos es.
  · Usá siempre el catálogo de ESTE mensaje, no lo que dijiste en un turno anterior de la misma charla — si el stock cambió entre mensajes, el dato de ahora manda, no lo que dijiste antes.
  · Esta regla va ANTES que la de "venta natural" de abajo: un "quiero comprar X" es TAMBIÉN una pregunta de disponibilidad, no una excepción — nunca invites a "agregarlo al carrito" ni lo presentes como buena opción sin antes aplicar este chequeo. Si está agotado, la respuesta empieza aclarando eso, no vendiendo el producto.
- Venta natural: sugerí lo relacionado o con descuento (oldPrice = precio anterior) cuando aplique, sin forzar en cada mensaje — nunca para un producto agotado (ver regla de arriba).
- Nunca digas "ya lo agregué", "ya está en tu carrito", "ya lo saqué" ni "ya vacié el carrito" — ninguna forma de pasado para una acción de carrito, esa confirmación la da la interfaz, no vos. Si el cliente pide agregar/sacar/vaciar, hablá en presente/futuro ("te lo agrego ahora", "dale, lo saco", "listo, vacío el carrito") y usá "addToCart"/"removeFromCart"/"clearCart" (abajo) según corresponda — texto y acción SIEMPRE juntos, nunca uno sin el otro.
- ACCIONES DE CARRITO (bug real ya visto: el cliente pidió vaciar el carrito, el bot dijo que sí pero el carrito real no cambió): "removeFromCart" y "clearCart" son las ÚNICAS formas reales de sacar/vaciar el carrito — decir "listo, lo saqué" o "ya está vacío" SIN incluir la acción correspondiente en el JSON no hace nada de verdad, el carrito real del cliente queda intacto. Si pide sacar un producto puntual del carrito, usá "removeFromCart" con su número de catálogo. Si pide vaciar/borrar TODO el carrito ("vaciá el carrito", "borrá todo", "empezar de cero"), usá "clearCart": true. Nunca uses estas acciones por iniciativa propia, solo cuando el cliente lo pida explícito.
- STOCK ESTRICTO: nunca ofrezcas ni agregues más de "disponible para agregar" de un producto (ya descuenta el carrito actual). Si piden más de lo disponible, o agregás exactamente la cantidad máxima disponible aclarándolo en el texto ("solo tengo 2, te agrego esas 2"), o no agregás nada y explicás cuánto hay — nunca digas una cantidad y agregués otra. Si "disponible para agregar" es 0 (por AGOTADO o porque ya tiene todo el stock en el carrito), nunca uses addToCart para ese producto, y en "text" decilo así, SIN decir que lo vas a agregar: "Solo queda 1 unidad disponible y ya la tenés en el carrito — no puedo agregar más." Nunca digas "te lo agrego" si "disponible para agregar" es 0 o si pidieron más de lo que hay.
- Si preguntan por el estado de un pedido (por email o número de confirmación): si arriba de todo aparece "CONSULTA DE PEDIDO", ESE es el resultado real y actual de esa búsqueda — usalo tal cual, nunca digas "no encontré" si ahí hay pedido(s) listados, y nunca digas que encontraste algo si ahí dice que no hay nada. Si NO aparece "CONSULTA DE PEDIDO" arriba y preguntan por un pedido, pedí el email o número de confirmación para buscarlo (vos no podés inventar ese resultado).

${fewShot}

SALIDA (JSON): {"text": "...", "productIds": ["N"], "addToCart": [{"productId": "N", "quantity": 1}], "removeFromCart": ["N"], "clearCart": false, "vendorIds": [], "showAllStoresButton": false, "suggestedFollowUps": ["...", "..."]}
- text: SOLO prosa natural, en tus palabras — nunca copies una línea del catálogo tal cual (con "·", "stock" o "AGOTADO"), ni el número de catálogo, ni ningún ID.
- productIds/addToCart.productId/removeFromCart: el NÚMERO de catálogo entre corchetes (ej. "3"), nunca el nombre del producto ni un ID inventado.
- vendorIds/showAllStoresButton: SIEMPRE vacío/false — eso es del bot general (ZeuDin en general), vos solo hablás de "${vendor.companyName}".
- productIds: productos que mencionás o recomendás en "text" (para mostrar su tarjeta). Vacío si ninguno puntual.
- addToCart: SOLO si el cliente pidió EXPLÍCITAMENTE agregar algo al carrito (nunca por sugerencia tuya), tiene stock Y la cantidad no supera "disponible para agregar". REGLA ESTRICTA: si "text" dice que vas a agregar un producto, ese mismo número TIENE que estar en addToCart — nunca lo digas sin incluirlo, y nunca lo incluyas sin decirlo. Cada producto de acá también va en productIds. Vacío si no pidió agregar nada.
- removeFromCart: números de catálogo que el cliente pidió EXPLÍCITAMENTE sacar del carrito. Vacío si no pidió sacar nada.
- clearCart: true SOLO si el cliente pidió EXPLÍCITAMENTE vaciar/borrar TODO el carrito. false en cualquier otro caso.
- suggestedFollowUps: SIEMPRE 2-3 preguntas cortas (3-6 palabras cada una) que el cliente podría preguntar A CONTINUACIÓN de ESTA respuesta puntual — tienen que variar según lo que acabás de responder, nunca las mismas siempre. Basate en lo real (variantes/productos relacionados/categoría del catálogo), nunca inventes algo que no tenga sentido acá. Son solo sugerencias para que el cliente toque en vez de escribir, no una afirmación tuya de nada.
- Ejemplo de patrón (número inventado solo para mostrar la forma): pedido "agregame el [7] al carrito" y tiene stock disponible → {"text": "Dale, te agrego 1 al carrito.", "productIds": ["7"], "addToCart": [{"productId": "7", "quantity": 1}], "removeFromCart": [], "clearCart": false, "suggestedFollowUps": ["Agregar otra unidad", "Ver el carrito", "Buscar algo más"]}
- Ejemplo de patrón — vaciar el carrito (bug real ya visto, nunca lo digas sin esta acción): pide "vaciá el carrito" → {"text": "Dale, vacío el carrito.", "productIds": [], "addToCart": [], "removeFromCart": [], "clearCart": true, "suggestedFollowUps": ["Buscar algo nuevo", "Ver el catálogo", "¿Qué me recomiendan?"]}
- Ejemplo de patrón — sacar un producto puntual del carrito: pide "sacá el [7] del carrito" → {"text": "Listo, lo saco.", "productIds": [], "addToCart": [], "removeFromCart": ["7"], "clearCart": false, "suggestedFollowUps": ["Ver el carrito", "Buscar algo más", "Agregar otra cosa"]}
- Ejemplo de patrón — producto agotado (número inventado): preguntan "¿tienen el [4]?" y el catálogo dice "[4] ... AGOTADO" → {"text": "Sí lo vendemos, pero ahora mismo está agotado. ¿Querés que te avise cuando repongamos, o preferís solicitarlo?", "productIds": ["4"], "addToCart": [], "suggestedFollowUps": ["Avisame cuando repongan", "Ver algo similar", "¿Cuándo llega stock nuevo?"]}
- Ejemplo de patrón — precio de un producto agotado (MISMA regla, no es un caso aparte): preguntan "¿cuánto sale el [4]?" y el catálogo dice "[4] ... AGOTADO" → NUNCA respondas solo el precio. Respondé aclarando primero: {"text": "Está agotado ahora mismo, pero cuesta [precio real del catálogo] cuando hay stock. ¿Querés que te avise cuando repongamos?", "productIds": ["4"], "addToCart": [], "suggestedFollowUps": ["Avisame cuando repongan", "Ver otras opciones", "Solicitar este producto"]}
- Ejemplo de patrón — "quiero comprar" un producto agotado (MISMA regla, "quiero comprar" NO es una excepción): dicen "quiero comprar el [4]" y el catálogo dice "[4] ... AGOTADO" → NUNCA digas "sí, tenemos" ni invites a agregarlo al carrito. Respondé: {"text": "Ese producto está agotado ahora mismo, así que por ahora no lo puedo agregar. ¿Querés que te avise cuando repongamos, o preferís solicitarlo?", "productIds": ["4"], "addToCart": [], "suggestedFollowUps": ["Avisame cuando repongan", "Solicitar este producto", "Ver algo parecido"]}
- Ejemplo de patrón — filtrado progresivo, UNA variante por vez (número inventado): preguntan "¿tienen la [2]?" y el catálogo dice "[2] ... variantes: Talla(S/M/L); Color(Negro/Blanco)" (2 variantes reales, ninguna aclarada todavía) → NUNCA preguntes las dos juntas ("¿qué talla y qué color?"). Preguntá SOLO la primera: {"text": "Sí, tenemos. ¿En qué talla — S, M o L?", "productIds": ["2"], "addToCart": [], "suggestedFollowUps": ["Talla M", "Talla L", "¿Qué colores hay?"]} — recién cuando conteste la talla, en el siguiente turno preguntás el color.`,
    },
  ];

  if (vendor.aiDocument) {
    try {
      const filepath = join(VENDOR_AI_DOC_DIR, vendor.aiDocument);
      if (vendor.aiDocument.toLowerCase().endsWith(".txt")) {
        const text = await readFile(filepath, "utf-8");
        parts.push({ text: `\nDocumento de negocio subido por la tienda (políticas, horarios, preguntas frecuentes, etc.):\n${text.slice(0, 20000)}` });
      } else if (vendor.aiDocument.toLowerCase().endsWith(".pdf")) {
        const buffer = await readFile(filepath);
        parts.push({ inlineData: { mimeType: "application/pdf", data: buffer.toString("base64") } });
      }
    } catch {
      // Documento no legible (borrado del disco a mano, etc.) — el chat
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
  return { id: p.id, name: p.name, slug: p.slug, price: p.price, oldPrice: p.oldPrice, description: p.description, images: p.images, stock: p.stock };
}

const chatMessageSchema = z.object({
  sessionId: z.string().trim().min(1).max(100),
  message: z.string().trim().min(1, "Escribí una pregunta.").max(1000),
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
    take: HISTORY_LIMIT,
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
  const vendor = await loadVendorForChat(vendorId, message, history);

  await prisma.chatMessage.create({ data: { vendorId, sessionId, role: "user", content: message } });

  // Bloque 39 (Parte 1): sin login, esto da null y el resto sigue exactamente
  // igual que siempre (nunca obligatorio).
  const userId = resolveOptionalUserId(req);

  // Bloque 33: de acá para abajo es todo lo que puede fallar por un
  // problema técnico real (proveedor de IA caído, timeout, etc.) — nunca se
  // le muestra el error real al cliente (ni mensaje de excepción, ni código
  // HTTP, ni nombre del proveedor): se registra en ErrorLog (visible solo
  // en Admin > Errores) y se responde con una señal genérica y estable que
  // el frontend usa para mostrar la tarjeta de "problemas técnicos" +
  // Reintentar. El mensaje del cliente YA quedó guardado arriba, así que
  // "Reintentar" en el frontend es simplemente volver a mandar el mismo
  // texto — no hace falta ninguna lógica especial de reintento acá.
  let rawText, productIds, addToCart, removeFromCart, clearCart, suggestedFollowUps;
  try {
    const orderContext = await lookupOrderContext(vendorId, message);
    const purchaseHistoryContext = await buildPurchaseHistoryContext(vendorId, userId);
    const systemParts = await buildSystemParts(vendor, cartQuantities, orderContext, purchaseHistoryContext);
    ({ text: rawText, productIds, addToCart, removeFromCart, clearCart, suggestedFollowUps } = await chatWithStoreAssistant({ systemParts, history, message }));
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
  const validClearCart = clearCart === true;

  // Cualquier producto que se vaya a agregar al carrito muestra su tarjeta
  // también, aunque el modelo se haya olvidado de listarlo en productIds —
  // más robusto que confiar en que siempre lo haga bien.
  const validIds = [...new Set([...recommended.map((p) => p.id), ...validAddToCart.map((a) => a.id)])];

  const saved = await prisma.chatMessage.create({
    data: { vendorId, sessionId, role: "model", content: text, productIds: validIds },
  });
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
    message: { ...saved, products, addToCart: validAddToCart, removeFromCart: validRemoveFromCart, clearCart: validClearCart, suggestedFollowUps: followUps },
  });
}

const historyQuerySchema = z.object({ sessionId: z.string().trim().min(1).max(100) });

export async function getChatHistory(req, res) {
  const { vendorId } = req.params;
  const { sessionId } = historyQuerySchema.parse(req.query);

  // A diferencia de postChatMessage, acá no tiene sentido tirar un error si
  // la tienda dejó de estar verificada entre que se abrió la página y se
  // pidió el historial — simplemente no hay nada que mostrar.
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { isVerified: true, isBlocked: true } });
  if (!vendor || vendor.isBlocked || !vendor.isVerified) return res.json({ messages: [] });

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
        select: { id: true, name: true, slug: true, price: true, images: true, stock: true },
      })
    : [];
  const productById = new Map(products.map((p) => [p.id, p]));

  const messagesWithProducts = messages.map((m) => ({
    ...m,
    products: (m.productIds ?? []).map((id) => productById.get(id)).filter(Boolean).map(toCardProduct),
  }));

  res.json({ messages: messagesWithProducts });
}
