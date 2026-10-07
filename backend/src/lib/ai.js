import { AppError } from "../utils/AppError.js";
import { getDecryptedCredential } from "../controllers/integrations.controller.js";
import { getBrandSettings } from "../controllers/settings.controller.js";
import { generateWithGemini, chatWithGemini } from "./gemini.js";
import { generateWithGroq, chatWithGroq, transcribeAudioWithGroq, TRANSCRIBE_MODEL as GROQ_TRANSCRIBE_MODEL } from "./groq.js";
import { generateWithNvidia, chatWithNvidia } from "./nvidia.js";
import { PROMPTS, searchQueryCorrectionPrompt } from "./aiPrompts.js";
import { checkModel, setRepairAdvisor, classifyFailure } from "./aiModelRepair.js";
import { markProviderCooldown, isProviderCoolingDown, clearProviderCooldown } from "./aiProviderCooldown.js";
import { isChatbotHealthy, getModelHealthRows } from "./aiProviderHealth.js";
import { getEffectiveActiveModels } from "./aiModels.js";
import { AI_PRIORITY, getQuotaStatus, isWithinFreeQuota } from "./aiQuota.js";

// Bloque 83 (pedido explícito, con medición real): benchmark inicial en
// vivo contra los 3 proveedores reales de esta cuenta — Groq ~400-800ms,
// Gemini ~1-2.5s, NVIDIA NIM 109 SEGUNDOS. getActiveProviders() solo
// devuelve los que están con el switch en "Activo" en AdminIntegrations —
// con uno inactivo, el fallback simplemente lo salta (nunca se llama a un
// proveedor apagado).
//
// Bloque 99 ordenaba los proveedores por su velocidad medida. Bloque 280 (pedido
// explícito) lo reemplaza por un orden FIJO — Groq, NVIDIA, Gemini — y por el
// cupo gratis que le queda a cada modelo (lib/aiQuota.js).

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

// Bloque 280: la latencia ya no decide el orden (ahora es fijo: Groq → NVIDIA →
// Gemini); se sigue midiendo solo para mostrarla y diagnosticar.
export function getMeasuredLatencies() {
  return Object.fromEntries([...latencyByProvider.entries()].map(([k, v]) => [k, Math.round(v)]));
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
  const healthRows = await getModelHealthRows();
  const isDown = (name, model) => healthRows.some((h) => h.provider === name && h.model === model && h.status === "down");

  // Bloque 280 (pedido explícito): el orden ya no es por velocidad sino FIJO —
  // Groq es la principal, después NVIDIA y por último Gemini. Dentro de cada
  // proveedor se usa primero el modelo que menos cupo gastó (y, a igual consumo,
  // el orden que fijó el admin). Un modelo cerca de su límite gratis NO entra en
  // la cadena: nunca se le manda un pedido que pueda pasarse del plan gratis.
  const pairs = [];
  for (const name of AI_PRIORITY) {
    const apiKey = await getDecryptedCredential(name);
    if (!apiKey) continue;
    const models = await getEffectiveActiveModels(name);
    const withQuota = await Promise.all(models.map(async (config, index) => ({ config, index, quota: await getQuotaStatus(name, config.model) })));
    withQuota
      .filter((m) => m.quota.available)
      .sort((a, b) => Math.round(a.quota.usageRatio * 10) - Math.round(b.quota.usageRatio * 10) || a.index - b.index)
      .forEach((m) => pairs.push({ name, apiKey, model: m.config.model }));
  }
  // Bloque 260: un proveedor que acaba de responder "clave inválida" o "cuota
  // agotada" descansa (aiProviderCooldown.js) y queda fuera hasta que pase el plazo.
  const usable = pairs.filter((p) => !isProviderCoolingDown(p.name));
  const healthy = usable.filter((p) => !isDown(p.name, p.model));
  const down = usable.filter((p) => isDown(p.name, p.model));
  return [...healthy, ...down];
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
//
// Bloque 260 (pedido explícito — "si se consume la cuota de una API, no probar
// otro modelo de la MISMA API: saltar a otra de las API de respaldo y seguir
// probando hasta que la principal se restablezca"): un error de CUOTA agotada
// o de CLAVE inválida es de la cuenta del proveedor, no del modelo, así que sus
// otros modelos fallarían igual. En ese caso el proveedor entero descansa
// (aiProviderCooldown.js) y sus modelos restantes se dejan para el FINAL de
// esta misma cadena, solo como último recurso si ningún otro proveedor
// respondió. Pasado el descanso, el proveedor vuelve solo a su lugar.
export async function callWithFallbackChain(providers, callFn, genericErrorMessage, { reportFailures = true } = {}) {
  let lastErr;
  const queue = [...providers];
  while (queue.length > 0) {
    const provider = queue.shift();
    // Bloque 280: el cupo se vuelve a mirar justo antes de cada pedido (otro pedido
    // en paralelo pudo gastar lo que quedaba). Cerca del límite se salta, sin llamar.
    if (!(await isWithinFreeQuota(provider.name, provider.model))) continue;
    const start = Date.now();
    try {
      const result = await callFn(provider);
      recordLatency(provider.name, Date.now() - start);
      clearProviderCooldown(provider.name);
      logProviderSuccess(provider);
      return result;
    } catch (err) {
      lastErr = err;
      const failureText = `${err?.message ?? ""} ${err?.details?.detail ?? ""}`;
      const failure = classifyFailure(failureText);
      const accountLevel = failure.kind === "quota" || failure.kind === "auth";
      if (accountLevel) {
        // Bloque 260 + 280: cuota agotada o clave inválida es de la CUENTA del
        // proveedor: sus otros modelos fallarían igual y, con cuota, insistir
        // podría pasarse del plan gratis. Se sacan todos de la cadena (ya no se
        // reintentan "como último recurso") y el proveedor descansa.
        markProviderCooldown(provider.name, failure.kind, failureText);
        for (let i = queue.length - 1; i >= 0; i--) if (queue[i].name === provider.name) queue.splice(i, 1);
      }
      const next = queue[0];
      logProviderFailure(
        `[ai] ${provider.name}/${provider.model} falló${accountLevel ? ` (${failure.kind === "quota" ? "cuota agotada" : "clave inválida"}: se salta todo ${provider.name})` : ""}${next ? `, reintentando con ${next.name}/${next.model}` : " (era el último modelo disponible)"}:`,
        err
      );
      // La autorreparación solo se dispara por fallos del MODELO; una cuota agotada
      // no se "repara" probando (cada prueba gastaría más cupo).
      if (reportFailures && !accountLevel) void checkModel({ provider: provider.name, apiKey: provider.apiKey, model: provider.model, trigger: "live" }).catch(() => {});
    }
  }
  throw new AppError(genericErrorMessage, 503, { detail: lastErr?.details?.detail ?? "Todas las IA están cerca de su límite gratis o no respondieron." });
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
    throw new AppError("La integración de IA no está configurada. Pídele al admin que active un proveedor en Integraciones.", 503);
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
  const apiKey = await getDecryptedCredential("groq");
  // Bloque 280: la transcripción tiene su propio cupo gratis en Groq; cerca del límite no se usa.
  if (!apiKey || isProviderCoolingDown("groq") || !(await isWithinFreeQuota("groq", GROQ_TRANSCRIBE_MODEL))) {
    throw new AppError("La transcripción de audio no está disponible en este momento — escribe tu mensaje.", 503);
  }
  return transcribeAudioWithGroq({ apiKey, audioBuffer, mimeType, filename });
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
