import { AppError } from "../utils/AppError.js";
import { getDecryptedCredential } from "../controllers/integrations.controller.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { generateWithGemini, chatWithGemini } from "./gemini.js";
import { generateWithGroq, chatWithGroq, transcribeAudioWithGroq } from "./groq.js";
import { generateWithNvidia, chatWithNvidia } from "./nvidia.js";
import { PROMPTS, searchQueryCorrectionPrompt } from "./aiPrompts.js";
import { checkModel, setRepairAdvisor } from "./aiModelRepair.js";
import { isChatbotHealthy, getModelHealthRows } from "./aiProviderHealth.js";
import { AI_PROVIDER_NAMES, getEffectiveActiveModels } from "./aiModels.js";

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
const PROVIDER_NAMES = AI_PROVIDER_NAMES;
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
// proveedor (editable en AdminIntegrations.jsx) — antes era una constante fija
// en cada archivo de proveedor. Con esto, una deprecación de modelo (ya pasó
// dos veces con Groq) se resuelve desde la web, sin tocar código ni
// redesplegar.
//
// Bloque 245: un proveedor puede tener VARIOS modelos activos, así que la
// cadena de respaldo ya no es de proveedores sino de pares proveedor+modelo.
// Orden: los proveedores por velocidad real medida (Bloque 99); dentro de
// cada uno, sus modelos por la prioridad que fijó el admin. Los modelos que
// la última verificación marcó caídos van AL FINAL de la cadena (se siguen
// intentando como último recurso, pero nunca antes de uno que sí responde).
async function getActiveProviders() {
  const providers = [];
  for (const name of PROVIDER_NAMES) {
    const apiKey = await getDecryptedCredential(name);
    if (apiKey) providers.push({ name, apiKey });
  }
  const healthRows = await getModelHealthRows();
  const isDown = (name, model) => healthRows.some((h) => h.provider === name && h.model === model && h.status === "down");

  const pairs = [];
  for (const provider of sortByMeasuredSpeed(providers)) {
    for (const config of await getEffectiveActiveModels(provider.name)) {
      pairs.push({ name: provider.name, apiKey: provider.apiKey, model: config.model });
    }
  }
  return [...pairs.filter((p) => !isDown(p.name, p.model)), ...pairs.filter((p) => isDown(p.name, p.model))];
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
//
// Bloque 245: `reportFailures: false` lo usa la consulta al "consejero" de la
// autorreparación — si esa propia consulta fallara no debe disparar otra
// reparación (sería un bucle: reparar → consultar IA → fallar → reparar).
async function callWithFallbackChain(providers, callFn, genericErrorMessage, { reportFailures = true } = {}) {
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
      logProviderFailure(`[ai] ${provider.name}/${provider.model} falló${next ? `, reintentando con ${next.name}/${next.model}` : " (era el último modelo activo)"}:`, err);
      // Bloque 99 (pedido explícito — "apenas se desconecte, que el sistema
      // lo detecte y busque el modelo adecuado"): dispara la reparación en
      // segundo plano, SIN esperarla — el pedido actual ya sigue probando
      // el siguiente proveedor de la cadena, la reparación es para que el
      // PRÓXIMO pedido ya no tenga que volver a fallar contra este mismo
      // modelo roto.
      // Bloque 245: checkModel es el único punto que decide qué hacer (aviso
      // único, reparación verificada, "problema resuelto") — ai.js solo le
      // dice QUÉ modelo falló. Tiene su propio cooldown, así que una ráfaga
      // de pedidos fallando contra el mismo modelo no dispara pruebas
      // repetidas.
      if (reportFailures) void checkModel({ provider: provider.name, apiKey: provider.apiKey, model: provider.model, trigger: "live" }).catch(() => {});
    }
  }
  throw new AppError(genericErrorMessage, 500, { detail: lastErr?.details?.detail });
}

// Usado por vendors.controller.js/products.controller.js (aiAvailable) para
// decirle al frontend si tiene sentido mostrar el widget de chat — sin esto,
// con todos los proveedores caídos el cliente vería un botón que solo lleva
// a un error 503 apenas escribe algo.
//
// Bloque 238: antes solo miraba si había alguna API key ACTIVA configurada
// (getActiveProviders().length > 0) — nunca si el proveedor respondía de
// verdad. Pasa a leer el estado de salud real, cacheado en AiProviderHealth
// y refrescado cada 2 minutos por aiChatbotAvailability.job.js (nunca
// probado en el momento mismo de esta llamada).
export async function isAIAvailable() {
  return isChatbotHealthy();
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

// Bloque 246: texto libre de IA para el asistente de negocio — misma cadena de
// respaldo entre modelos que el resto (si un modelo cae, sigue con el
// siguiente y la autorreparación se entera). Devuelve el texto crudo; quien lo
// llama valida el formato. Con ninguna IA disponible lanza un 503 claro y no
// un error genérico, para que el panel pueda decir "no disponible ahora".
export async function generateRawText(prompt) {
  const providers = await getActiveProviders();
  if (!providers.length) throw new AppError("El asistente no está disponible en este momento: no hay ninguna IA activa.", 503);
  try {
    return await callWithFallbackChain(providers, (provider) => callGenerate(provider, prompt), "El asistente no pudo responder.");
  } catch (err) {
    throw new AppError("El asistente no está disponible en este momento porque la IA no respondió. Prueba de nuevo en unos minutos.", 503, { detail: err?.details?.detail });
  }
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

// Bloque 245: la autorreparación (aiModelRepair.js) necesita consultar a OTRA
// IA del sistema para elegir el modelo de reemplazo. Se registra acá, y no se
// importa allá, porque ai.js ya importa aiModelRepair.js (un import directo
// sería circular). Prefiere modelos de OTROS proveedores y recién después los
// hermanos del mismo proveedor; nunca el modelo roto.
setRepairAdvisor(async (prompt, { excludeProvider, excludeModel }) => {
  const providers = (await getActiveProviders()).filter((p) => !(p.name === excludeProvider && p.model === excludeModel));
  if (!providers.length) throw new AppError("No hay otra IA activa para consultar.", 503);
  const others = providers.filter((p) => p.name !== excludeProvider);
  const siblings = providers.filter((p) => p.name === excludeProvider);
  return callWithFallbackChain([...others, ...siblings], (provider) => callGenerate(provider, prompt), "La IA consejera no respondió.", { reportFailures: false });
});
