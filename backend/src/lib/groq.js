import { AppError } from "../utils/AppError.js";

// Bloque 25: respaldo de Groq — misma interfaz pública que gemini.js
// (generateWithGroq/chatWithGroq), para que ai.js pueda despachar a
// cualquiera de los dos sin que a los controllers les importe cuál corrió.
// API compatible con OpenAI (chat completions).
//
// IMPORTANTE sobre el modelo: cuáles modelos puede usar una key de Groq es
// una config de CADA cuenta/organización en console.groq.com/settings/limits
// — no algo que se resuelva eligiendo bien el nombre acá, y esa config
// puede cambiar sola con el tiempo (ya pasó dos veces en este proyecto).
// Bloque 32: llama-3.1-8b-instant (el default desde el Bloque 25) empezó a
// devolver 403 "blocked at the project level" — probado en vivo de nuevo
// contra esta cuenta: openai/gpt-oss-120b/20b, meta-llama/llama-4-*,
// qwen/qwen3-32b y moonshotai/kimi-k2-instruct siguen sin estar
// habilitados; gemma2-9b-it y deepseek-r1-distill-llama-70b ya están
// discontinuados por Groq. El único que respondió 200 fue
// llama-3.3-70b-versatile — si este vuelve a fallar con 403/404, repetir
// esta verificación en vivo (ver probe en el historial del bloque) antes de
// asumir que es un bug de este archivo.
// Bloque 37: se evaluó pasar openai/gpt-oss-120b a modelo principal (mejor
// razonamiento reportado para casos de shopping-assistant) — GET
// /openai/v1/models ya lo LISTA como visible para esta cuenta (cambió desde
// el Bloque 32), pero un chat.completions real contra él sigue devolviendo
// 403 "model_permission_blocked_project" (mismo error que llama-3.1-8b-instant
// en su momento): lo tiene bloqueado a nivel de PROYECTO en Groq, no algo
// que este código pueda resolver.
// Bloque 43: el nombre del modelo ya NO es fijo — ai.js lo resuelve desde
// SiteSettings.aiModelGroq (editable en AdminIntegrations.jsx) y lo pasa
// acá como parámetro; DEFAULT_MODEL es el fallback si ese setting está
// vacío/no configurado todavía. Con esto, una futura deprecación (ya pasó
// dos veces) se resuelve cambiando el texto desde la web, sin tocar código
// ni redesplegar — y aunque el admin ponga un modelo inexistente/deprecado,
// eso ahora es SOLO un fallo más de Groq (ai.js salta a Gemini/NVIDIA NIM,
// nunca rompe la petición entera).
export const DEFAULT_MODEL = "llama-3.3-70b-versatile";
const API_BASE = "https://api.groq.com/openai/v1/chat/completions";
const MODELS_API_BASE = "https://api.groq.com/openai/v1/models";

// Bloque 44 (pedido explícito — bug real que esto hubiera evitado: un typo
// en el campo de texto libre del modelo, "llama-3.3.70b-versatile" en vez
// de "-70b-", tumbó el proveedor con 404 model_not_found): en vez de que
// el admin tipee el nombre a mano, se listan los modelos REALES que esta
// key puede usar — AdminIntegrations.jsx los muestra como lista
// seleccionable en vez de un input de texto libre.
export async function listGroqModels({ apiKey }) {
  let res;
  try {
    res = await fetch(MODELS_API_BASE, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new AppError("No se pudo conectar con Groq para listar modelos.", 500);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`Groq devolvió un error (${res.status}) listando modelos.`, 500, { detail: body.slice(0, 300) });
  }
  const data = await res.json();
  return (data?.data ?? []).map((m) => m.id).sort();
}

// Bloque 32: reemplaza el reconocimiento de imágenes (Bloque 30, derogado)
// por grabación de audio — Whisper Large v3 Turbo es el modelo de
// voz-a-texto más rápido/económico de Groq, adecuado para mensajes cortos
// de clientes. Mismo endpoint de la API de Groq (compatible con OpenAI),
// pero "audio/transcriptions" en vez de "chat/completions".
const TRANSCRIBE_MODEL = "whisper-large-v3-turbo";
const TRANSCRIBE_API_BASE = "https://api.groq.com/openai/v1/audio/transcriptions";

export async function generateWithGroq({ apiKey, prompt, model }) {
  let res;
  try {
    res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        max_tokens: 400,
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
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AppError("La IA no devolvió una descripción. Intentá con un texto más específico.", 500);

  return text;
}

// systemParts llega en formato Gemini ({text}/{inlineData}, ver
// chat.controller.js) — Groq no lee documentos adjuntos nativos como Gemini,
// así que acá se concatenan solo las partes de texto en un único mensaje
// "system" y la parte {inlineData} (el PDF del vendedor) se descarta en
// silencio. Degradación aceptada: el chat sigue funcionando con catálogo +
// datos del negocio, solo que sin el contenido de un PDF puntual mientras
// Groq esté activo (si el documento es .txt, ya llega como texto plano
// dentro de systemParts y SÍ se aprovecha igual, sin perder nada).
function buildGroqMessages({ systemParts, history, message }) {
  const systemText = systemParts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text)
    .join("\n\n");

  return [
    // Bloque 27: Groq (API compatible con OpenAI) exige que la palabra
    // "json" aparezca en algún mensaje para poder usar response_format:
    // json_object — sin esto rechaza el pedido ENTERO con 400 antes de
    // intentar responder: "'messages' must contain the word 'json' in
    // some form...". systemText (armado en chat.controller.js) describe el
    // formato de salida en prosa sin usar esa palabra textual, así que se
    // agrega acá explícito — este bug quedó tapado en el bloque anterior
    // por el error de permisos de la cuenta de Groq, que fallaba ANTES de
    // llegar a esta validación.
    { role: "system", content: `${systemText}\n\nRespondé siempre en formato JSON, con el objeto exacto descripto arriba.` },
    ...history.map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.content })),
    { role: "user", content: message },
  ];
}

// Bloque 42 (bug real reportado en vivo, mismo tipo en NVIDIA NIM con un
// modelo alternativo): "response_format: json_object" no garantiza que el
// modelo arranque la respuesta CON el JSON — nunca confiar en que lo
// respeta al 100%. Se extrae el objeto real (desde el primer "{" hasta el
// último "}") antes de parsear, sin importar qué texto haya alrededor.
function extractJsonObject(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return raw;
  return raw.slice(start, end + 1);
}

export async function chatWithGroq({ apiKey, systemParts, history, message, model }) {
  const messages = buildGroqMessages({ systemParts, history, message });

  let res;
  try {
    res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages,
        // Bloque 28: bajado de 0.4 a 0.2 — probado en vivo, este modelo
        // (8B) a veces devolvía "productIds"/"addToCart" vacíos pese a que
        // "text" describía correctamente un producto puntual (ninguna
        // garantía de json_object sobre CONTENIDO, solo sobre sintaxis
        // válida). Menos temperatura no elimina el problema del todo pero
        // lo hace medible menos frecuente — prioriza cumplir el formato
        // pedido por sobre variar la redacción, razonable acá porque la
        // parte creativa (el tono de "text") no necesita temperatura alta.
        temperature: 0.2,
        // Bloque 34: bajado de 350 a 220 originalmente (pedido explícito de
        // acortar respuestas) — subido un poco a 260 después: 220 dejaba
        // justo lo mínimo para "text" + productIds + addToCart +
        // suggestedFollowUps (3 strings nuevos) y se vio en vivo al modelo
        // devolver basura de sintaxis JSON pegada al final de un follow-up
        // (ej. "Buscar otra]}:") — más margen reduce que el modelo sienta
        // que tiene que apurar el cierre. Sigue bien por debajo del 350
        // original.
        max_tokens: 260,
        // json_object (no json_schema): más simple y más confiable en
        // Groq para este modelo — la forma exacta ({text, productIds}) ya
        // se le pide en texto plano dentro del prompt de sistema, y el
        // parseo de abajo tiene su propio fallback si igual llega texto
        // suelto en vez de JSON.
        response_format: { type: "json_object" },
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
  const raw = data?.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new AppError("El asistente no devolvió una respuesta. Probá reformular tu pregunta.", 500);

  try {
    const parsed = JSON.parse(extractJsonObject(raw));
    return {
      text: String(parsed.text ?? "").trim(),
      productIds: Array.isArray(parsed.productIds) ? parsed.productIds.filter((id) => typeof id === "string") : [],
      addToCart: Array.isArray(parsed.addToCart) ? parsed.addToCart : [],
      // Bloque 40: bug real reportado en vivo — el cliente pidió "vaciar
      // carrito" y el modelo respondió que sí, pero no existía ninguna
      // acción real para ejecutar eso (el carrito es 100% del cliente,
      // CartContext/localStorage — el backend nunca lo ve). Mismo patrón
      // que addToCart: el modelo solo DECIDE la acción acá, quien la
      // ejecuta de verdad es el frontend (ver StoreChatWidget.jsx).
      removeFromCart: Array.isArray(parsed.removeFromCart) ? parsed.removeFromCart.filter((id) => typeof id === "string") : [],
      clearCart: parsed.clearCart === true,
      // Bloque 41 (pedido explícito): tarjeta de tienda puntual (bot
      // general, mismo patrón que productIds) + botón real a "Ver todas
      // las tiendas" para pedidos amplios ("mostrame tiendas") en vez de
      // listar cada nombre en el texto — el bot de tienda nunca usa esto
      // (siempre vacío/false).
      vendorIds: Array.isArray(parsed.vendorIds) ? parsed.vendorIds.filter((id) => typeof id === "string") : [],
      showAllStoresButton: parsed.showAllStoresButton === true,
      // Bloque 34: sugerencias de seguimiento contextuales — igual que
      // productIds/addToCart, json_object no garantiza que Groq las incluya
      // siempre (solo garantiza sintaxis JSON válida); si vienen vacías o
      // ausentes, el frontend cae a su propio set fijo de respaldo.
      suggestedFollowUps: Array.isArray(parsed.suggestedFollowUps) ? parsed.suggestedFollowUps.filter((s) => typeof s === "string") : [],
    };
  } catch {
    return { text: raw, productIds: [], addToCart: [], removeFromCart: [], clearCart: false, vendorIds: [], showAllStoresButton: false, suggestedFollowUps: [] };
  }
}

// Bloque 32: transcribe un audio corto que grabó un cliente en cualquiera
// de los dos bots — el texto transcrito entra al mismo flujo de texto de
// siempre (nunca se guarda el audio, se descarta apenas se transcribe).
// FormData/Blob nativos de Node (>=18): al pasar un FormData como body,
// fetch arma el "Content-Type: multipart/form-data; boundary=..." solo, así
// que nunca hay que setearlo a mano acá (romper el boundary rompe el parseo
// del lado de Groq).
export async function transcribeAudioWithGroq({ apiKey, audioBuffer, mimeType, filename }) {
  const form = new FormData();
  form.append("file", new Blob([audioBuffer], { type: mimeType }), filename || "audio.webm");
  form.append("model", TRANSCRIBE_MODEL);
  form.append("language", "es");
  form.append("response_format", "json");

  let res;
  try {
    res = await fetch(TRANSCRIBE_API_BASE, {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey}` },
      body: form,
    });
  } catch {
    throw new AppError("No se pudo conectar con el servicio de transcripción. Probá de nuevo.", 500);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`El servicio de transcripción devolvió un error (${res.status}).`, 500, { detail: body.slice(0, 300) });
  }

  const data = await res.json();
  // Resultado vacío (silencio, ruido sin habla) es una respuesta VÁLIDA, no
  // una excepción — el controller/frontend decide qué hacer con texto vacío
  // (avisar al cliente que repita o escriba), nunca se inventa contenido acá.
  return (data?.text ?? "").trim();
}
