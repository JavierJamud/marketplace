import { AppError } from "../utils/AppError.js";
import { getDecryptedCredential } from "../controllers/integrations.controller.js";
import { generateWithGemini, chatWithGemini } from "./gemini.js";
import { generateWithGroq, chatWithGroq, transcribeAudioWithGroq } from "./groq.js";
import { PROMPTS } from "./aiPrompts.js";

// Bloque 27: Groq va SIEMPRE primero cuando está activo, sin importar si
// Gemini también lo está — orden fijo pedido explícitamente (antes era al
// revés: Gemini primero por ser el único con lectura nativa de PDF, pero
// esa ventaja quedó subordinada a la prioridad pedida acá). Gemini entra
// como principal únicamente cuando Groq está inactivo, sin key, o
// directamente nunca se cargó.
const PROVIDER_NAMES = ["groq", "gemini"];

// Bloque 25: único punto de entrada público para IA de todo el backend —
// ai.controller.js y chat.controller.js importan de ACÁ (antes importaban
// gemini.js directo, que asumía que Gemini siempre estaba disponible). La
// selección de proveedor es 100% desde AdminIntegrations.jsx: cada
// integración tiene su propio isActive.
//
// Bloque 27: a diferencia del Bloque 26, el fallback ya NO usa una key
// "inactiva" guardada como respaldo silencioso — inactivo es inactivo, no
// se lo llama nunca (pedido explícito). El fallback ahora solo existe
// cuando HAY UN SEGUNDO proveedor activo de verdad: getActiveProviders()
// devuelve, en orden de prioridad, únicamente los que están con el switch
// en "Activo" en AdminIntegrations. Con uno solo activo, ese es el único
// que se llama — si falla, se le muestra el error al cliente directo, sin
// intentar el que está apagado.
async function getActiveProviders() {
  const providers = [];
  for (const name of PROVIDER_NAMES) {
    const apiKey = await getDecryptedCredential(name);
    if (apiKey) providers.push({ name, apiKey });
  }
  return providers;
}

function callGenerate(provider, prompt) {
  return provider.name === "gemini" ? generateWithGemini({ apiKey: provider.apiKey, prompt }) : generateWithGroq({ apiKey: provider.apiKey, prompt });
}

function callChat(provider, { systemParts, history, message }) {
  return provider.name === "gemini"
    ? chatWithGemini({ apiKey: provider.apiKey, systemParts, history, message })
    : chatWithGroq({ apiKey: provider.apiKey, systemParts, history, message });
}

// El detalle real que manda el proveedor (err.details.detail, el body
// crudo de la respuesta) va siempre al log — antes solo se logueaba
// err.message ("El asistente no pudo responder (400)...") sin la causa de
// fondo, así que diagnosticar un fallo nuevo obligaba a reproducirlo aparte
// en vez de simplemente leer el log del pedido que ya falló.
function logProviderFailure(prefix, err) {
  console.error(prefix, err.message, err.details?.detail ? `| detalle: ${err.details.detail}` : "");
}

// Usado por vendors.controller.js (getVendorBySlug) para decirle al
// frontend si tiene sentido mostrar el widget de chat — sin esto, con
// ambos proveedores apagados el cliente vería un botón que solo lleva a un
// error 503 apenas escribe algo.
export async function isAIAvailable() {
  return (await getActiveProviders()).length > 0;
}

export async function generateDescription(kind, context) {
  const [primary, fallback] = await getActiveProviders();
  if (!primary) {
    throw new AppError("La integración de IA no está configurada. Pedile al admin que active Gemini o Groq en Integraciones.", 503);
  }
  const prompt = (PROMPTS[kind] ?? PROMPTS.product)(context);

  try {
    return await callGenerate(primary, prompt);
  } catch (primaryErr) {
    if (!fallback) throw primaryErr;
    logProviderFailure(`[ai] ${primary.name} falló generando descripción, reintentando con ${fallback.name}:`, primaryErr);
    try {
      return await callGenerate(fallback, prompt);
    } catch (fallbackErr) {
      logProviderFailure(`[ai] ${fallback.name} (respaldo) también falló:`, fallbackErr);
      throw new AppError("La IA no pudo generar el texto — probá de nuevo en un momento.", 500);
    }
  }
}

// Bloque 26/27: fallback real en vivo — si el proveedor PRINCIPAL falla
// respondiendo esta consulta puntual (red, error del proveedor, timeout, lo
// que sea) Y hay un segundo proveedor también activo, se reintenta
// automático con ese antes de mostrarle error al cliente. Con un solo
// proveedor activo no hay fallback posible — ver getActiveProviders.
export async function chatWithStoreAssistant({ systemParts, history, message }) {
  const [primary, fallback] = await getActiveProviders();
  if (!primary) throw new AppError("El chat con esta tienda no está disponible en este momento.", 503);

  try {
    return await callChat(primary, { systemParts, history, message });
  } catch (primaryErr) {
    if (!fallback) throw primaryErr;
    logProviderFailure(`[ai] ${primary.name} falló respondiendo el chat, reintentando con ${fallback.name}:`, primaryErr);
    try {
      return await callChat(fallback, { systemParts, history, message });
    } catch (fallbackErr) {
      logProviderFailure(`[ai] ${fallback.name} (respaldo) también falló:`, fallbackErr);
      throw new AppError("El asistente no pudo responder — probá de nuevo en un momento.", 500);
    }
  }
}

// Bloque 32: transcripción de audio (ambos bots) — a diferencia del resto
// de este archivo, no hay despacho primario/respaldo entre proveedores:
// Gemini no tiene una función de transcripción implementada acá (solo
// Groq/Whisper), así que esto SOLO funciona si Groq está activo. Con Groq
// apagado, se avisa claro que por ahora no se puede transcribir en vez de
// fallar con un 500 pelado o intentar un proveedor que no sabe hacerlo.
export async function transcribeAudio({ audioBuffer, mimeType, filename }) {
  const providers = await getActiveProviders();
  const groqProvider = providers.find((p) => p.name === "groq");
  if (!groqProvider) throw new AppError("La transcripción de audio no está disponible en este momento — escribí tu mensaje.", 503);
  return transcribeAudioWithGroq({ apiKey: groqProvider.apiKey, audioBuffer, mimeType, filename });
}
