import { AppError } from "../utils/AppError.js";

// Bloque 25: este archivo pasa a ser puramente "cómo hablarle a la API de
// Gemini" — YA NO decide qué proveedor usar ni lee la credencial de la DB
// (eso es trabajo de ai.js, el dispatcher). Recibe el apiKey ya resuelto
// como parámetro, así que es 100% agnóstico de AdminIntegrations.
// Alias mantenido por Google que siempre apunta al modelo flash recomendado
// del momento — evita tener que actualizar el nombre a mano cuando retiran
// una versión puntual (como pasó con gemini-2.0-flash).
const MODEL = "gemini-flash-latest";

// Bloque 25 (latencia del chat): la documentación de Google presenta
// "flash-lite" como la opción de menor latencia frente a "flash" estándar,
// así que se probó acá para el chat — pero medido en vivo contra esta key
// (5 corridas intercaladas de cada uno, prompt idéntico) dio el resultado
// contrario: flash-lite-latest promedió ~6.2s, flash-latest ~2s. Se dejó
// flash-latest (el mismo MODEL de arriba) para el chat también. Si esto
// cambia en el futuro (Google reordena qué hay detrás de cada alias), vale
// la pena volver a medir en vivo antes de asumir cuál es más rápido.
const API_BASE = "https://generativelanguage.googleapis.com/v1beta/models";

export async function generateWithGemini({ apiKey, prompt }) {
  let res;
  try {
    res = await fetch(`${API_BASE}/${MODEL}:generateContent?key=${apiKey}`, {
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
        generationConfig: { temperature: 0.8, maxOutputTokens: 600, thinkingConfig: { thinkingBudget: 1 } },
      }),
    });
  } catch {
    throw new AppError("No se pudo conectar con el servicio de IA. Intentá de nuevo.", 500);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`El servicio de IA devolvió un error (${res.status}). Intentá de nuevo en un momento.`, 500, { detail: body.slice(0, 300) });
  }

  const data = await res.json();
  const text = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim();
  if (!text) throw new AppError("La IA no devolvió una descripción. Intentá con un texto más específico.", 500);

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
export async function chatWithGemini({ apiKey, systemParts, history, message }) {
  const contents = [...history.map((m) => ({ role: m.role, parts: [{ text: m.content }] })), { role: "user", parts: [{ text: message }] }];

  let res;
  try {
    res = await fetch(`${API_BASE}/${MODEL}:generateContent?key=${apiKey}`, {
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
    });
  } catch {
    throw new AppError("No se pudo conectar con el asistente. Probá de nuevo.", 500);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`El asistente no pudo responder (${res.status}). Probá de nuevo en un momento.`, 500, { detail: body.slice(0, 300) });
  }

  const data = await res.json();
  const raw = data?.candidates?.[0]?.content?.parts?.map((p) => p.text).join("").trim();
  if (!raw) throw new AppError("El asistente no devolvió una respuesta. Probá reformular tu pregunta.", 500);

  try {
    const parsed = JSON.parse(raw);
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
