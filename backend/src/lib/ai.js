import { AppError } from "../utils/AppError.js";
import { getDecryptedCredential } from "../controllers/integrations.controller.js";
import { getAiModelOverrides, getBrandSettings } from "../controllers/settings.controller.js";
import { generateWithGemini, chatWithGemini } from "./gemini.js";
import { generateWithGroq, chatWithGroq, transcribeAudioWithGroq } from "./groq.js";
import { generateWithNvidia, chatWithNvidia } from "./nvidia.js";
import { PROMPTS, searchQueryCorrectionPrompt } from "./aiPrompts.js";
import { repairProviderModel, PROVIDERS as REPAIR_PROVIDERS } from "./aiModelRepair.js";

// Bloque 83 (pedido explícito, con medición real): benchmark inicial en
// vivo contra los 3 proveedores reales de esta cuenta — Groq ~400-800ms,
// Gemini ~1-2.5s, NVIDIA NIM 109 SEGUNDOS. getActiveProviders() solo
// devuelve los que están con el switch en "Activo" en AdminIntegrations —
// con uno inactivo, el fallback simplemente lo salta (nunca se llama a un
// proveedor apagado).
//
// Bloque 99 (pedido explícito — "analizará cuál está respondiendo más
// rápido y utilizaremos para texto los modelos que respondan más rápido
// siempre"): el orden YA NO es este array fijo — abajo (sortByMeasuredSpeed)
// se reordenan los proveedores activos por su latencia REAL medida en vivo,
// actualizada en cada pedido real que responde bien. Este array pasa a ser
// solo la LISTA de proveedores conocidos (qué nombres existen), no su orden
// de prioridad — y las latencias de referencia de acá arriba quedan como
// semilla inicial (DEFAULT_LATENCY_MS) para cuando el servidor recién
// arrancó y todavía no hay ninguna medición real propia.
const PROVIDER_NAMES = ["groq", "gemini", "nvidia"];
const DEFAULT_LATENCY_MS = { groq: 600, gemini: 2000, nvidia: 15000 };

// Media móvil exponencial simple — le da más peso a lo reciente sin
// descartar de golpe la historia previa (un solo pedido lento no debe
// hacer que un proveedor rápido de siempre pierda su lugar de un tirón).
// Vive en memoria del proceso a propósito: es una señal de "cómo viene
// respondiendo AHORA", no algo que necesite sobrevivir un reinicio — con
// tráfico real se vuelve a aprender solo en los primeros pedidos.
const EMA_ALPHA = 0.3;
const latencyByProvider = new Map();

function recordLatency(providerName, ms) {
  const prev = latencyByProvider.get(providerName);
  latencyByProvider.set(providerName, prev == null ? ms : prev + EMA_ALPHA * (ms - prev));
}

function getMeasuredLatency(providerName) {
  return latencyByProvider.get(providerName) ?? DEFAULT_LATENCY_MS[providerName] ?? 5000;
}

function sortByMeasuredSpeed(providers) {
  return [...providers].sort((a, b) => getMeasuredLatency(a.name) - getMeasuredLatency(b.name));
}

// Bloque 25: único punto de entrada público para IA de todo el backend —
// ai.controller.js y chat.controller.js importan de ACÁ (antes importaban
// gemini.js directo, que asumía que Gemini siempre estaba disponible). La
// selección de proveedor es 100% desde AdminIntegrations.jsx: cada
// integración tiene su propio isActive.
//
// Bloque 43: además del apiKey, ahora también resuelve el MODELO de cada
// proveedor desde SiteSettings (editable en AdminIntegrations.jsx) — antes
// era una constante fija en cada archivo de proveedor. Con esto, una
// deprecación de modelo (ya pasó dos veces con Groq) se resuelve
// cambiando el texto desde la web, sin tocar código ni redesplegar.
async function getActiveProviders() {
  const modelOverrides = await getAiModelOverrides();
  const providers = [];
  for (const name of PROVIDER_NAMES) {
    const apiKey = await getDecryptedCredential(name);
    if (apiKey) providers.push({ name, apiKey, model: modelOverrides[name] });
  }
  // Bloque 99: orden por velocidad real medida, no por la posición en
  // PROVIDER_NAMES — ver sortByMeasuredSpeed arriba.
  return sortByMeasuredSpeed(providers);
}

function callGenerate(provider, prompt) {
  if (provider.name === "gemini") return generateWithGemini({ apiKey: provider.apiKey, prompt, model: provider.model });
  if (provider.name === "nvidia") return generateWithNvidia({ apiKey: provider.apiKey, prompt, model: provider.model });
  return generateWithGroq({ apiKey: provider.apiKey, prompt, model: provider.model });
}

function callChat(provider, { systemParts, history, message }) {
  if (provider.name === "gemini") return chatWithGemini({ apiKey: provider.apiKey, systemParts, history, message, model: provider.model });
  if (provider.name === "nvidia") return chatWithNvidia({ apiKey: provider.apiKey, systemParts, history, message, model: provider.model });
  return chatWithGroq({ apiKey: provider.apiKey, systemParts, history, message, model: provider.model });
}

// El detalle real que manda el proveedor (err.details.detail, el body
// crudo de la respuesta) va siempre al log — antes solo se logueaba
// err.message ("El asistente no pudo responder (400)...") sin la causa de
// fondo, así que diagnosticar un fallo nuevo obligaba a reproducirlo aparte
// en vez de simplemente leer el log del pedido que ya falló.
function logProviderFailure(prefix, err) {
  console.error(prefix, err.message, err.details?.detail ? `| detalle: ${err.details.detail}` : "");
}

// Bloque 43 (pedido explícito): saber cuál proveedor respondió de verdad
// en cada request — para diagnosticar cuál está cargando el tráfico real
// y detectar si el principal (Gemini) está fallando seguido y cayendo
// siempre al respaldo.
function logProviderSuccess(provider) {
  console.log(`[ai] respondió: ${provider.name}`);
}

// Bloque 43 (Capa 1 — cambio automático entre proveedores, Parte 3 —
// "modelo no encontrado/deprecado" nunca rompe la petición): reemplaza el
// [primary, fallback] fijo de 2 por una cadena que recorre TODOS los
// proveedores activos en orden de prioridad. Cualquier error de un
// proveedor (red, 429 de cuota, 404/400/403 de modelo inexistente o
// deprecado — cualquiera) es SOLO un fallo de ESE proveedor: se loguea y
// se pasa al siguiente, nunca se propaga como si fuera el fallo final
// mientras quede alguno más para probar. Recién si TODOS los activos
// fallan se lanza el error genérico de siempre (Bloque 33 lo convierte en
// la tarjeta de "problemas técnicos").
async function callWithFallbackChain(providers, callFn, genericErrorMessage) {
  let lastErr;
  for (let i = 0; i < providers.length; i++) {
    const provider = providers[i];
    const start = Date.now();
    try {
      const result = await callFn(provider);
      // Bloque 99: cada respuesta buena retroalimenta el orden de la
      // próxima vez (ver sortByMeasuredSpeed/getActiveProviders) — "el más
      // rápido" deja de ser una medición congelada de una vez, se actualiza
      // solo con tráfico real.
      recordLatency(provider.name, Date.now() - start);
      logProviderSuccess(provider);
      return result;
    } catch (err) {
      lastErr = err;
      const next = providers[i + 1];
      logProviderFailure(`[ai] ${provider.name} falló${next ? `, reintentando con ${next.name}` : " (era el último proveedor activo)"}:`, err);
      // Bloque 99 (pedido explícito — "apenas se desconecte, que el sistema
      // lo detecte y busque el modelo adecuado"): dispara la reparación en
      // segundo plano, SIN esperarla — el pedido actual ya sigue probando
      // el siguiente proveedor de la cadena, la reparación es para que el
      // PRÓXIMO pedido ya no tenga que volver a fallar contra este mismo
      // modelo roto. repairProviderModel tiene su propio cooldown por
      // proveedor, así que una ráfaga de fallos simultáneos no dispara
      // búsquedas repetidas.
      // provider.model puede venir null (sin override en AdminIntegrations,
      // "usa el default del archivo") — hay que resolver el nombre REAL que
      // se acaba de usar (mismo criterio que generateWithX: model || DEFAULT_MODEL)
      // para que la reparación pruebe/excluya el modelo correcto, no "null".
      const brokenModel = provider.model || REPAIR_PROVIDERS[provider.name]?.defaultModel;
      void repairProviderModel(provider.name, provider.apiKey, brokenModel, err?.details?.detail || err?.message).catch(() => {});
    }
  }
  throw new AppError(genericErrorMessage, 500, { detail: lastErr?.details?.detail });
}

// Usado por vendors.controller.js (getVendorBySlug) para decirle al
// frontend si tiene sentido mostrar el widget de chat — sin esto, con
// todos los proveedores apagados el cliente vería un botón que solo lleva a un
// error 503 apenas escribe algo.
export async function isAIAvailable() {
  return (await getActiveProviders()).length > 0;
}

export async function generateDescription(kind, context) {
  const providers = await getActiveProviders();
  if (!providers.length) {
    throw new AppError("La integración de IA no está configurada. Pedile al admin que active un proveedor en Integraciones.", 503);
  }
  const { siteName } = await getBrandSettings();
  const prompt = (PROMPTS[kind] ?? PROMPTS.product)({ ...context, siteName });
  return callWithFallbackChain(providers, (provider) => callGenerate(provider, prompt), "La IA no pudo generar el texto — prueba de nuevo en un momento.");
}

// Bloque 52 (bug real reportado en vivo): último recurso de la barra de
// búsqueda cuando ni unaccent()+ILIKE (tildes/mayúsculas) encontró nada —
// probablemente un typo real (ver search.controller.js). A diferencia de
// generateDescription/chatWithStoreAssistant de arriba, ESTO NUNCA TIRA: sin
// proveedor activo o si la IA falla, la búsqueda tiene que seguir andando
// igual (cae al fallback de similarity()/pg_trgm en la DB, sin IA) — nunca
// tiene sentido romper una búsqueda porque el "autocorrector" no estaba
// disponible. Devuelve null en cualquiera de los dos casos (nunca "").
export async function correctSearchQuery(rawQuery) {
  const providers = await getActiveProviders();
  if (!providers.length) return null;
  try {
    const { siteName } = await getBrandSettings();
    const prompt = searchQueryCorrectionPrompt(rawQuery, siteName);
    const corrected = await callWithFallbackChain(providers, (provider) => callGenerate(provider, prompt), "");
    return corrected?.trim() || null;
  } catch {
    return null;
  }
}

// Bloque 26/27: fallback real en vivo — si el proveedor principal falla
// respondiendo esta consulta puntual (red, error del proveedor, timeout,
// modelo deprecado/inexistente, cuota agotada) se reintenta automático con
// el siguiente proveedor activo en la cadena antes de mostrarle error al
// cliente. Regla clave (Bloque 43): el cliente nunca se queda sin
// respuesta si al menos un proveedor activo funciona.
export async function chatWithStoreAssistant({ systemParts, history, message }) {
  const providers = await getActiveProviders();
  if (!providers.length) throw new AppError("El chat con esta tienda no está disponible en este momento.", 503);
  return callWithFallbackChain(
    providers,
    (provider) => callChat(provider, { systemParts, history, message }),
    "El asistente no pudo responder — prueba de nuevo en un momento."
  );
}

// Bloque 32: transcripción de audio (ambos bots) — a diferencia del resto
// de este archivo, no hay despacho primario/respaldo entre proveedores:
// ni Gemini ni NVIDIA NIM tienen una función de transcripción implementada
// acá (solo Groq/Whisper), así que esto SOLO funciona si Groq está activo.
// Con Groq apagado, se avisa claro que por ahora no se puede transcribir
// en vez de fallar con un 500 pelado o intentar un proveedor que no sabe
// hacerlo.
export async function transcribeAudio({ audioBuffer, mimeType, filename }) {
  const providers = await getActiveProviders();
  const groqProvider = providers.find((p) => p.name === "groq");
  if (!groqProvider) throw new AppError("La transcripción de audio no está disponible en este momento — escribe tu mensaje.", 503);
  return transcribeAudioWithGroq({ apiKey: groqProvider.apiKey, audioBuffer, mimeType, filename });
}
