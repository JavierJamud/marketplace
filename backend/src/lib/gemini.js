import { AppError } from "../utils/AppError.js";

// Bloque 25: este archivo pasa a ser puramente "cómo hablarle a la API de
// Gemini" — YA NO decide qué proveedor usar ni lee la credencial de la DB
// (eso es trabajo de ai.js, el dispatcher). Recibe el apiKey ya resuelto
// como parámetro, así que es 100% agnóstico de AdminIntegrations.
// Alias mantenido por Google que siempre apunta al modelo flash recomendado
// del momento — evita tener que actualizar el nombre a mano cuando retiran
// una versión puntual (como pasó con gemini-2.0-flash).
// Bloque 43: ya no es fijo — ai.js lo resuelve desde SiteSettings.aiModelGemini
// (editable en AdminIntegrations.jsx) y lo pasa como parámetro; DEFAULT_MODEL
// es el fallback si ese setting está vacío/no configurado todavía.
export const DEFAULT_MODEL = "gemini-flash-latest";

// Bloque 83: mismo timeout defensivo que groq.js/nvidia.js.
const REQUEST_TIMEOUT_MS = 20_000;

// Bloque 25 (latencia del chat): la documentación de Google presenta
// "flash-lite" como la opción de menor latencia frente a "flash" estándar,
// así que se probó acá para el chat — pero medido en vivo contra esta key
// (5 corridas intercaladas de cada uno, prompt idéntico) dio el resultado
// contrario: flash-lite-latest promedió ~6.2s, flash-latest ~2s. Se dejó
// flash-latest (el mismo MODEL de arriba) para el chat también. Si esto
// cambia en el futuro (Google reordena qué hay detrás de cada alias), vale
// la pena volver a medir en vivo antes de asumir cuál es más rápido.
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

// Bloque 44 (pedido explícito): lista los modelos REALES que esta key
// puede usar para chat (filtrados a los que soportan generateContent —
// Gemini también lista modelos de audio/embeddings que no sirven acá).
// AdminIntegrations.jsx los muestra como lista seleccionable en vez de un
// input de texto libre.
// Bloque 90 (bug real encontrado investigando 2 correos de "la integración
// no responde" en la misma noche): antes este catch tiraba SIEMPRE el mismo
// texto genérico sin importar la causa real (timeout de 20s, DNS caído, la
// key rechazada a nivel de conexión, lo que sea) — el health check y el
// nuevo botón "Probar conexión" leen `err.details.detail` para el correo/
// toast, así que perder el motivo real acá es perder la única pista útil
// para diagnosticar por qué un proveedor "no responde".
function describeFetchFailure(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "Se agotó el tiempo de espera (20s) sin respuesta.";
  return err?.message || "Error de red desconocido.";
}

// Bloque 100 (bug real reportado en vivo, con captura de un modelo nuevo de
// Google que no aparecía acá): esta función tenía 2 problemas reales.
// (1) Sin ningún timeout — a diferencia de generateWithGemini/chatWithGemini
// (que sí tienen REQUEST_TIMEOUT_MS desde el Bloque 83), un cuelgue de red
// dejaba "Actualizar lista" (AdminIntegrations.jsx) girando para siempre sin
// ningún error visible — fácil de confundir con "no se actualiza".
// (2) Google pagina esta respuesta (confirmado en vivo: la cuenta de este
// proyecto YA tiene más de 50 modelos, con "nextPageToken" en la primera
// página) — se traía solo la página 1 y se dejaba de traer el resto en
// silencio. Un modelo que cayera en la página 2+ nunca iba a aparecer en el
// selector, aunque la key sí pudiera usarlo. Se agrega el timeout de
// siempre y un loop que sigue "nextPageToken" hasta agotarlo, con pageSize
// grande (200) para minimizar cuántas vueltas hacen falta en la práctica.
const MODELS_PAGE_SIZE = 200;

export async function listGeminiModels({ apiKey }) {
  const allModels = [];
  let pageToken = "";
  do {
    const url = `${API_BASE}?key=${apiKey}&pageSize=${MODELS_PAGE_SIZE}${pageToken ? `&pageToken=${pageToken}` : ""}`;
    let res;
    try {
      res = await fetch(url, { signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
    } catch (err) {
      throw new AppError("No se pudo conectar con Gemini para listar modelos.", 500, { detail: describeFetchFailure(err) });
    }
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new AppError(`Gemini devolvió un error (${res.status}) listando modelos.`, 500, { detail: body.slice(0, 300) });
    }
    const data = await res.json();
    allModels.push(...(data?.models ?? []));
    pageToken = data?.nextPageToken ?? "";
  } while (pageToken);

  return allModels
    .filter((m) => m.supportedGenerationMethods?.includes("generateContent"))
    .map((m) => m.name.replace(/^models\//, ""))
    .sort();
}

export async function generateWithGemini({ apiKey, prompt, model }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/${model || DEFAULT_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ parts: [{ text: prompt }] }],
        // Bloque 41 — bug real reportado en vivo (500/400 en el chat, mismo
        // archivo): "gemini-flash-latest" ahora resuelve a un modelo más
        // nuevo (confirmado en vivo: modelVersion "gemini-3.6-flash") que
        // directamente RECHAZA con 400 "invalid argument" thinkingBudget:0
        // — antes solo gastaba de más, ahora ni siquiera responde. thinkingBudget:1
        // es el mínimo que la API acepta sin tirar 400 (probado en vivo);
        // igual sigue gastando tokens de "pensar" variables entre llamadas
        // (visto: 65-173 según el pedido), así que maxOutputTokens sube para
        // dejar margen real a la respuesta visible sin cortarla a mitad de
        // camino. Si "gemini-flash-latest" vuelve a cambiar de versión,
        // repetir esta medición en vivo antes de asumir que sigue igual.
        // Bloque 49 (medido en vivo con el debugger de la API): thinkingBudget:1
        // NO limita de verdad cuánto "piensa" este modelo — con el prompt de
        // warranty (más largo/estructurado que product/store) el response
        // real trajo finishReason: "MAX_TOKENS" con thoughtsTokenCount: 838
        // y solo 58 tokens visibles, con maxOutputTokens en 900 (¡900 se
        // gasta CASI TODO en pensar, no en la respuesta!). thinkingBudget
        // es más una preferencia que un techo duro acá — la única forma
        // real de no cortar la respuesta es dejar mucho más margen en
        // maxOutputTokens (pensar + visible comparten el mismo pool).
        generationConfig: { temperature: 0.8, maxOutputTokens: 3000, thinkingConfig: { thinkingBudget: 1 } },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError("No se pudo conectar con el servicio de IA. Intenta de nuevo.", 500, { detail: describeFetchFailure(err) });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`El servicio de IA devolvió un error (${res.status}). Intenta de nuevo en un momento.`, 500, { detail: body.slice(0, 300) });
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim();
  if (!text) throw new AppError("La IA no devolvió una descripción. Intenta con un texto más específico.", 500);

  return text;
}

// Bloque 21: chatbot por tienda verificada. systemParts sigue siendo el
// formato nativo de Gemini (mezcla de {text} y {inlineData} para el
// documento PDF del vendedor, leído nativo sin librería de extracción
// aparte) — chat.controller.js arma este array una sola vez y cada
// proveedor (ver groq.js) lo interpreta a su manera; Gemini es el único que
// hoy sabe leer el `inlineData` del PDF de verdad.
//
// Bloque 24: la respuesta es JSON estructurado ({text, productIds}) vía
// responseSchema — así el frontend arma las tarjetas de producto embebidas
// sin adivinar parseando texto libre. responseSchema fuerza la FORMA del
// JSON; el filtro anti-alucinación de los IDs sigue siendo trabajo de
// chat.controller.js, que es quien conoce el catálogo real de la tienda.
// Bloque 42 (bug real reportado en vivo, mismo tipo en NVIDIA NIM con un
// modelo alternativo): "responseSchema" de Gemini es más estricto que
// json_object de OpenAI, pero igual nunca hay que confiar al 100% en que
// el modelo arranca la respuesta CON el JSON. Se extrae el objeto real
// (desde el primer "{" hasta el último "}") antes de parsear, sin importar
// qué texto haya alrededor.
function extractJsonObject(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return raw;
  return raw.slice(start, end + 1);
}

export async function chatWithGemini({ apiKey, systemParts, history, message, model }) {
  const contents = [...history.map((m) => ({ role: m.role, parts: [{ text: m.content }] })), { role: "user", parts: [{ text: message }] }];

  let res;
  try {
    res = await fetch(`${API_BASE}/${model || DEFAULT_MODEL}:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        systemInstruction: { parts: systemParts },
        contents,
        generationConfig: {
          // temperature más baja que generateWithGemini (0.8): acá se
          // prioriza pegarse al catálogo/documento real antes que
          // "creatividad" — menos margen para que invente un producto.
          temperature: 0.4,
          // Bloque 34: bajado de 350 a 220 originalmente (pedido explícito
          // de acortar respuestas) — subido un poco a 260 después: 220
          // dejaba justo lo mínimo para "text" + productIds + addToCart +
          // suggestedFollowUps (3 strings nuevos), visto en vivo con Groq
          // devolviendo basura de sintaxis pegada al final de un follow-up
          // bajo esa presión de espacio — más margen lo reduce. Sigue bien
          // por debajo del 350 original.
          // Bloque 41 — bug real reportado en vivo (500 en el chat general
          // y de tienda): "gemini-flash-latest" ahora resuelve a un modelo
          // más nuevo (confirmado en vivo: modelVersion "gemini-3.6-flash")
          // que directamente RECHAZA con 400 "invalid argument"
          // thinkingBudget:0 — antes solo gastaba de más, ahora ni siquiera
          // responde. thinkingBudget:1 es el mínimo que la API acepta sin
          // tirar 400 (probado en vivo); igual sigue gastando tokens de
          // "pensar" variables entre llamadas (visto: 65-173 según el
          // pedido), así que maxOutputTokens sube de 260 a 500 para dejar
          // margen real al JSON visible (text+productIds+addToCart+
          // removeFromCart+clearCart+suggestedFollowUps) sin cortarlo a
          // mitad de camino. Si "gemini-flash-latest" cambia de versión de
          // nuevo, repetir esta medición en vivo antes de asumir que sigue
          // igual.
          maxOutputTokens: 500,
          thinkingConfig: { thinkingBudget: 1 },
          responseMimeType: "application/json",
          responseSchema: {
            type: "object",
            properties: {
              text: { type: "string" },
              productIds: { type: "array", items: { type: "string" } },
              // Bloque 28: acción real de "agregar al carrito" — solo la
              // ejecuta chat.controller.js (validación) + el frontend
              // (CartContext.addItem), nunca el modelo ni este archivo.
              addToCart: {
                type: "array",
                items: {
                  type: "object",
                  properties: { productId: { type: "string" }, quantity: { type: "integer" } },
                  required: ["productId", "quantity"],
                },
              },
              // Bloque 40: acciones reales de "sacar"/"vaciar" el carrito —
              // mismo criterio que addToCart, el modelo solo decide, quien
              // ejecuta de verdad es el frontend (CartContext.removeItem/
              // clearCart). El bot general nunca las usa (siempre [] / false).
              removeFromCart: { type: "array", items: { type: "string" } },
              clearCart: { type: "boolean" },
              // Bloque 41 (pedido explícito): tarjeta de tienda puntual (bot
              // general, mismo patrón que productIds) + botón real a "Ver
              // todas las tiendas" para pedidos amplios ("mostrame
              // tiendas") en vez de listar cada nombre en el texto — el bot
              // de tienda nunca usa esto (siempre vacío/false).
              vendorIds: { type: "array", items: { type: "string" } },
              showAllStoresButton: { type: "boolean" },
              // Bloque 34: 2-3 preguntas cortas de seguimiento, contextuales
              // a ESTA respuesta puntual (no genéricas ni repetidas siempre
              // iguales) — el frontend las muestra como chips en vez de los
              // de siempre, así varían de verdad turno a turno. Nunca se
              // valida contra el catálogo (son solo sugerencias de qué
              // preguntar, no una afirmación de stock/producto), pero sí se
              // sanitizan (máx 3, texto corto) del lado del controller.
              suggestedFollowUps: { type: "array", items: { type: "string" } },
            },
            required: ["text", "productIds", "addToCart", "removeFromCart", "clearCart", "vendorIds", "showAllStoresButton", "suggestedFollowUps"],
          },
        },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError("No se pudo conectar con el asistente. Prueba de nuevo.", 500, { detail: describeFetchFailure(err) });
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`El asistente no pudo responder (${res.status}). Prueba de nuevo en un momento.`, 500, { detail: body.slice(0, 300) });
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim();
  if (!raw) throw new AppError("El asistente no devolvió una respuesta. Prueba reformular tu pregunta.", 500);

  try {
    const parsed = JSON.parse(extractJsonObject(raw));
    return {
      text: String(parsed.text ?? "").trim(),
      productIds: Array.isArray(parsed.productIds) ? parsed.productIds.filter((id) => typeof id === "string") : [],
      addToCart: Array.isArray(parsed.addToCart) ? parsed.addToCart : [],
      removeFromCart: Array.isArray(parsed.removeFromCart) ? parsed.removeFromCart.filter((id) => typeof id === "string") : [],
      clearCart: parsed.clearCart === true,
      vendorIds: Array.isArray(parsed.vendorIds) ? parsed.vendorIds.filter((id) => typeof id === "string") : [],
      showAllStoresButton: parsed.showAllStoresButton === true,
      suggestedFollowUps: Array.isArray(parsed.suggestedFollowUps) ? parsed.suggestedFollowUps.filter((s) => typeof s === "string") : [],
    };
  } catch {
    // El modelo no devolvió JSON válido pese al responseSchema (raro, pero
    // no imposible) — se muestra igual como texto plano en vez de cortar la
    // conversación, solo que ese mensaje puntual queda sin tarjetas ni
    // acción de carrito (más seguro que intentar parsear texto libre).
    return { text: raw, productIds: [], addToCart: [], removeFromCart: [], clearCart: false, vendorIds: [], showAllStoresButton: false, suggestedFollowUps: [] };
  }
}
