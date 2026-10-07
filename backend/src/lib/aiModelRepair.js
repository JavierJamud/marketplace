import { prisma } from "./prisma.js";
import { notifyAdminActionNeeded } from "./adminNotify.js";
import { logError } from "./errorLog.js";
import { generateWithGemini, listGeminiModels, listGeminiModelsDetailed, listGeminiModelsCatalog, DEFAULT_MODEL as GEMINI_DEFAULT } from "./gemini.js";
import { generateWithGroq, listGroqModels, listGroqModelsDetailed, listGroqModelsCatalog, DEFAULT_MODEL as GROQ_DEFAULT } from "./groq.js";
import { generateWithNvidia, listNvidiaModels, listNvidiaModelsDetailed, listNvidiaModelsCatalog, DEFAULT_MODEL as NVIDIA_DEFAULT } from "./nvidia.js";
import { rankNewestFirst } from "./aiModelRanking.js";
import { getEffectiveActiveModels } from "./aiModels.js";
import { getUnavailableModel, getModelAvailable } from "./aiModelCatalog.js";
import { getModelHealth, getModelHealthRows, upsertModelHealth, patchModelHealth, deleteModelHealth } from "./aiProviderHealth.js";

// Bloque 99 (pedido explícito — "cuando un modelo se desconecte, que el
// sistema lo detecte y busque el modelo adecuado automáticamente") y Bloque
// 245 (pedido explícito — varios modelos por proveedor, aviso de falla, y
// reparación VERIFICADA con aviso de "problema resuelto"): este es el ÚNICO
// lugar que decide qué hacer cuando un modelo falla. Lo disparan tres
// caminos distintos, siempre con la misma política:
//   - ai.js, en vivo, cuando un pedido real de un cliente falla ("live").
//   - aiChatbotAvailability.job.js, cada 2 minutos ("proactive").
//   - aiHealthCheck.job.js, una vez al día a las 3am ("daily").
// Política: marcar caído y avisar UNA vez → el chat sigue con los otros
// modelos activos → pedir la lista real de modelos a la API → una IA del
// sistema (distinta del modelo roto) elige el mejor candidato → se prueba de
// verdad antes de cargarlo → aviso de "problema resuelto"; si ninguno
// funciona, aviso de que no se pudo reparar y reintento espaciado.

export const HEALTH_PROMPT = "Responde solo con la palabra: listo";
// Bloque 100 (bug real encontrado en vivo): la lista de modelos de Gemini
// incluye agentes especializados ("antigravity-preview", "deep-research-*",
// "computer-use") y generadores de imagen/audio/música que Google SÍ marca
// como capaces de generateContent, pero que nunca sirven como reemplazo de un
// modelo de CHAT/texto simple roto. Se excluyen categorías completas.
const EXCLUDE_MODEL_PATTERN =
  /whisper|guard|tts|embed|orpheus|safeguard|moderation|vision|prompt-guard|transcribe|lyria|image|robotics|computer-use|deep-research|antigravity|customtools|nano-banana|omni-|-omni|live/i;

// Cuántos candidatos (los más nuevos primero) se le muestran a la IA que
// elige, y cuántos se prueban de verdad como máximo antes de rendirse.
const CANDIDATES_FOR_ADVISOR = 12;
const MAX_PROBES_PER_REPAIR = 3;
// Una reparación fallida se reintenta pasado este tiempo (no en cada tick de
// 2 minutos), y solo se avisa por correo las primeras veces — después de eso
// la caída sigue visible en Integraciones sin llenar la bandeja del admin.
const REPAIR_RETRY_MS = 2 * 60 * 60 * 1000;
const MAX_REPAIR_FAILURE_NOTICES = 3;
// Un pedido real que falla dispara un chequeo; una ráfaga de pedidos
// fallando contra el mismo modelo no debe disparar 50 pruebas en paralelo.
const LIVE_RECHECK_COOLDOWN_MS = 60 * 1000;
// Bloque 263 (pedido explícito — "a cada rato me llegan correos de que se cayó un
// modelo"): causa real medida en la base: un modelo lento como el de NVIDIA
// (4 a 100 s) falla UNA prueba por timeout, se marcaba caído y mandaba correo; la
// prueba siguiente (2 minutos después) respondía bien y mandaba otro de
// "resuelto". Decenas de correos al día por un modelo que solo es inestable.
// Ahora un fallo pasajero (timeout, red, cuota) solo cuenta como caída tras
// este número de fallos SEGUIDOS; un fallo permanente (modelo dado de baja,
// clave inválida) se atiende de inmediato porque no se arregla solo.
const FAILURES_BEFORE_DOWN = 3;
const failureStreak = new Map();
// Un modelo inestable que cae y vuelve no debe llenar la bandeja: si ya se avisó de su
// caída hace menos de este tiempo, la nueva caída (y su "vuelve a responder") se
// registran pero no mandan correo.
const MAIL_QUIET_MS = 6 * 60 * 60 * 1000;
const lastDownMailAt = new Map();
const silentDowns = new Set();

export const PROVIDERS = {
  gemini: { generate: generateWithGemini, list: listGeminiModels, listDetailed: listGeminiModelsDetailed, catalog: listGeminiModelsCatalog, defaultModel: GEMINI_DEFAULT, label: "Gemini" },
  groq: { generate: generateWithGroq, list: listGroqModels, listDetailed: listGroqModelsDetailed, catalog: listGroqModelsCatalog, defaultModel: GROQ_DEFAULT, label: "Groq" },
  nvidia: { generate: generateWithNvidia, list: listNvidiaModels, listDetailed: listNvidiaModelsDetailed, catalog: listNvidiaModelsCatalog, defaultModel: NVIDIA_DEFAULT, label: "NVIDIA NIM" },
};

// ai.js registra acá la función que le consulta a OTRA IA del sistema. Va
// inyectada y no importada porque ai.js ya importa este archivo (un import
// directo crearía un ciclo).
let repairAdvisor = null;
export function setRepairAdvisor(fn) {
  repairAdvisor = fn;
}

// Prueba un modelo puntual con un prompt trivial — reusa exactamente las
// mismas funciones generateWithX que ya usa el chat/generador real (mismo
// timeout de 20s ya aplicado ahí desde el Bloque 83), así que este chequeo
// mide la MISMA ruta de código que usan los clientes de verdad, nunca un
// mock aparte que podría no reflejar un fallo real.
export async function probeModel(providerName, apiKey, model) {
  const start = Date.now();
  await PROVIDERS[providerName].generate({ apiKey, prompt: HEALTH_PROMPT, model });
  return Date.now() - start;
}

export function errorDetailOf(err) {
  return err?.details?.detail || err?.message || "Error desconocido";
}

// Traduce el error crudo del proveedor a una causa y una solución sugerida en
// español, para que el correo diga qué hacer y no solo "falló".
export function classifyFailure(detail) {
  const text = String(detail || "").toLowerCase();
  if (/\b401\b|\b403\b|api key|apikey|unauthor|forbidden|permission|invalid.*key|key.*invalid/.test(text)) {
    return { kind: "auth", cause: "la clave no es válida o no tiene permisos", fix: "Revisa o rota la clave en Admin → Integraciones: puede estar vencida, revocada o la cuenta sin permisos." };
  }
  if (/\b404\b|\b410\b|not found|not_found|decommission|deprecat|no longer|does not exist|\bgone\b|model_not_found/.test(text)) {
    return { kind: "gone", cause: "el modelo fue dado de baja o ya no existe", fix: "No hace falta hacer nada si el reemplazo automático funciona; si no, elige otro modelo de la lista en Admin → Integraciones." };
  }
  if (/\b429\b|\b402\b|quota|rate.?limit|exhaust|too many|prepayment|credits are depleted|billing/.test(text)) {
    return { kind: "quota", cause: "se agotó la cuota o el límite de uso", fix: "Espera a que se renueve la cuota del proveedor, o sube de plan; mientras tanto el chat usa los otros modelos." };
  }
  if (/timeout|tiempo de espera|network|fetch failed|econn|enotfound|\b5\d\d\b|unavailable|overloaded/.test(text)) {
    return { kind: "transient", cause: "el proveedor no respondió a tiempo o tuvo un problema temporal", fix: "Suele resolverse solo; el sistema vuelve a probar cada pocos minutos." };
  }
  return { kind: "unknown", cause: "el proveedor devolvió un error inesperado", fix: "Revisa el detalle del error abajo y la clave en Admin → Integraciones." };
}

async function countOtherHealthyModels(provider, model) {
  const rows = await getModelHealthRows();
  return rows.filter((r) => r.status === "healthy" && !(r.provider === provider && r.model === model)).length;
}

async function notifyDown({ provider, model, errorDetail, failure }) {
  const others = await countOtherHealthyModels(provider, model);
  const coverage = others > 0
    ? `El chat y el generador siguen respondiendo con los otros ${others} modelo(s) que están sanos.`
    : "Ahora mismo NO queda ningún otro modelo sano: el chat de las tiendas puede estar mostrando que no está disponible.";
  await notifyAdminActionNeeded(
    `🔴 IA: el modelo ${model} de ${PROVIDERS[provider].label} falló`,
    `El modelo "${model}" de ${PROVIDERS[provider].label} dejó de responder.\n\n` +
      `Causa probable: ${failure.cause}.\n` +
      `Qué hacer: ${failure.fix}\n\n` +
      `${coverage}\n\n` +
      (failure.kind === "auth"
        ? "No se intenta un reemplazo automático porque el problema es la clave, no el modelo.\n\n"
        : "El sistema va a intentar repararlo solo (buscar un modelo nuevo, probarlo y cargarlo) y te avisa del resultado.\n\n") +
      `Detalle del error: ${String(errorDetail).slice(0, 400)}`
  );
}

async function notifyRecovered({ provider, model }) {
  await notifyAdminActionNeeded(
    `✅ IA: ${PROVIDERS[provider].label} vuelve a responder`,
    `El modelo "${model}" de ${PROVIDERS[provider].label} volvió a responder por sí solo. El problema que te avisamos antes quedó resuelto, no tienes que hacer nada.`
  );
}

async function notifyRepaired({ provider, brokenModel, newModel, ms, chosenBy, deactivated }) {
  await notifyAdminActionNeeded(
    `✅ IA: problema resuelto en ${PROVIDERS[provider].label}`,
    `El modelo "${brokenModel}" de ${PROVIDERS[provider].label} había fallado y el sistema ya lo reparó solo.\n\n` +
      `Modelo nuevo: "${newModel}" (${chosenBy}).\n` +
      `Verificación: se le hizo una consulta real y respondió bien en ${ms}ms, y ya está activo.\n` +
      (deactivated ? `El modelo roto "${brokenModel}" quedó desactivado (puedes reactivarlo en Admin → Integraciones si vuelve a funcionar).\n` : "") +
      `\nPuedes revisar o ajustar los modelos en Admin → Integraciones.`
  );
}

async function notifyRepairFailed({ provider, brokenModel, errorDetail, tried, reason, attempt }) {
  const triedText = tried.length ? tried.map((t) => `- ${t.model}: ${String(t.error).slice(0, 160)}`).join("\n") : "- (no se pudo probar ningún candidato)";
  await notifyAdminActionNeeded(
    `🔴 IA: no se pudo reparar ${PROVIDERS[provider].label}`,
    `El sistema intentó reparar el modelo "${brokenModel}" de ${PROVIDERS[provider].label} y NO lo logró (intento ${attempt} de ${MAX_REPAIR_FAILURE_NOTICES}; después de eso deja de escribirte, pero sigue reintentando cada ${REPAIR_RETRY_MS / 3600000} horas).\n\n` +
      `Motivo: ${reason}\n\nModelos probados:\n${triedText}\n\n` +
      `Qué hacer: entra a Admin → Integraciones, revisa la clave de ${PROVIDERS[provider].label} y elige a mano un modelo de la lista.\n\n` +
      `Detalle del fallo original: ${String(errorDetail).slice(0, 300)}`
  );
}

// Pide a OTRA IA activa del sistema que elija, entre los candidatos reales,
// el más adecuado para un chat de atención al cliente. Devuelve null si no
// hay otra IA disponible o contesta algo que no está en la lista (mismo
// patrón anti-alucinación del resto del proyecto: la respuesta se valida
// contra la lista real, nunca se confía en el texto libre).
async function askAdvisorToPick({ provider, brokenModel, candidates }) {
  if (!repairAdvisor || candidates.length === 0) return null;
  const prompt =
    `Eres un ingeniero que elige modelos de IA. El modelo "${brokenModel}" de ${PROVIDERS[provider].label} dejó de funcionar.\n` +
    `Elige UN reemplazo de esta lista real de modelos del proveedor (ordenada de más nuevo a más antiguo según su fecha o versión). ` +
    `Se usará para un chat de atención al cliente de tiendas en línea: necesita ser rápido, de uso general (instruct/chat), estable y bueno en español. ` +
    `Prefiere los más nuevos, pero evita modelos experimentales, de visión, de código o especializados.\n\n` +
    `Lista:\n${candidates.map((m, i) => `${i + 1}. ${m}`).join("\n")}\n\n` +
    `Responde SOLO con JSON, sin texto extra: {"model":"<nombre exacto copiado de la lista>"}`;
  try {
    const raw = await repairAdvisor(prompt, { excludeProvider: provider, excludeModel: brokenModel });
    const match = String(raw ?? "").match(/\{[\s\S]*?\}/);
    const picked = match ? JSON.parse(match[0])?.model : null;
    return typeof picked === "string" && candidates.includes(picked) ? picked : null;
  } catch {
    return null;
  }
}

// Reemplaza un modelo roto: lista los modelos reales → los ordena del más
// nuevo al más viejo → una IA del sistema elige → se PRUEBA de verdad → recién
// ahí se carga como modelo AUTO activo. Nunca lanza.
async function runRepair({ provider, apiKey, brokenModel, errorDetail, failure, health }) {
  await patchModelHealth(provider, brokenModel, { lastRepairAttemptAt: new Date() });

  const configured = await prisma.aiModelConfig.findMany({ where: { provider } });
  const configuredNames = new Set(configured.map((c) => c.model));
  const brokenConfig = configured.find((c) => c.model === brokenModel) ?? null;

  let detailed;
  try {
    detailed = await PROVIDERS[provider].listDetailed({ apiKey });
  } catch (listErr) {
    return failRepair({ provider, brokenModel, errorDetail, health, tried: [], reason: `no se pudo pedir la lista de modelos a ${PROVIDERS[provider].label} (${errorDetailOf(listErr)})` });
  }

  // Bloque 266b: los que ya se comprobó que dan 404 para esta cuenta no se prueban, y los
  // comprobados como disponibles van primero.
  const usable = detailed
    .filter((m) => m.id !== brokenModel && !configuredNames.has(m.id) && !EXCLUDE_MODEL_PATTERN.test(m.id) && !getUnavailableModel(provider, m.id))
    .sort((a, b) => Number(!!getModelAvailable(provider, b.id)) - Number(!!getModelAvailable(provider, a.id)));
  const ranked = rankNewestFirst(usable);
  if (ranked.length === 0) {
    return failRepair({ provider, brokenModel, errorDetail, health, tried: [], reason: "la API no listó ningún modelo de chat nuevo para probar" });
  }

  const shortlist = ranked.slice(0, CANDIDATES_FOR_ADVISOR);
  const advisorPick = await askAdvisorToPick({ provider, brokenModel, candidates: shortlist });
  const order = [...new Set([...(advisorPick ? [advisorPick] : []), ...shortlist])].slice(0, MAX_PROBES_PER_REPAIR);

  const tried = [];
  for (const candidate of order) {
    try {
      const ms = await probeModel(provider, apiKey, candidate);
      const permanent = failure.kind === "gone";
      await prisma.aiModelConfig.upsert({
        where: { provider_model: { provider, model: candidate } },
        create: { provider, model: candidate, isActive: true, priority: brokenConfig?.priority ?? 0, source: "AUTO" },
        update: { isActive: true },
      });
      await upsertModelHealth(provider, candidate, { status: "healthy", lastError: null, lastLatencyMs: ms, downSince: null, downNotifiedAt: null, lastRepairAttemptAt: null, repairFailedCount: 0 });
      // Un modelo dado de baja no vuelve: se desactiva para que no se siga
      // intentando ni avisando. Un fallo pasajero (cuota, red) NO desactiva
      // nada — el modelo original puede volver y el sistema lo notará solo.
      if (permanent) {
        if (brokenConfig) await prisma.aiModelConfig.update({ where: { id: brokenConfig.id }, data: { isActive: false } });
        await deleteModelHealth(provider, brokenModel);
      } else {
        await patchModelHealth(provider, brokenModel, { repairFailedCount: 0 });
      }
      const chosenBy = candidate === advisorPick ? "elegido por otra IA del sistema entre los más recientes de la lista real" : "el más reciente de la lista real que respondió bien";
      await notifyRepaired({ provider, brokenModel, newModel: candidate, ms, chosenBy, deactivated: permanent && !!brokenConfig });
      await logError({
        origin: "AI_HEALTH_CHECK",
        message: `Modelo de ${provider} reparado automáticamente: "${brokenModel}" -> "${candidate}"`,
        context: { provider, brokenModel, newModel: candidate, errorDetail, advisorPick, ms },
      });
      console.log(`[aiModelRepair] ${provider} reparado: "${brokenModel}" -> "${candidate}" (${ms}ms, ${chosenBy})`);
      return { outcome: "repaired", model: candidate, ms };
    } catch (probeErr) {
      tried.push({ model: candidate, error: errorDetailOf(probeErr) });
    }
  }
  return failRepair({ provider, brokenModel, errorDetail, health, tried, reason: `ninguno de los ${tried.length} candidatos más recientes respondió` });
}

async function failRepair({ provider, brokenModel, errorDetail, health, tried, reason }) {
  const attempt = (health?.repairFailedCount ?? 0) + 1;
  await patchModelHealth(provider, brokenModel, { repairFailedCount: attempt, lastRepairAttemptAt: new Date() });
  if (attempt <= MAX_REPAIR_FAILURE_NOTICES && !silentDowns.has(`${provider}::${brokenModel}`)) {
    await notifyRepairFailed({ provider, brokenModel, errorDetail, tried, reason, attempt });
  }
  await logError({
    origin: "AI_HEALTH_CHECK",
    message: `No se pudo reparar el modelo ${brokenModel} de ${provider} (intento ${attempt}): ${reason}`,
    context: { provider, brokenModel, errorDetail, tried },
  });
  return { outcome: "repair_failed", attempt };
}

// Un modelo cayó y se confirmó. Marca el estado, avisa UNA vez por caída y
// decide si corresponde intentar la reparación ahora.
async function handleConfirmedFailure({ provider, apiKey, model, errorDetail, force }) {
  const failure = classifyFailure(errorDetail);
  const previous = await getModelHealth(provider, model);
  const row = await upsertModelHealth(provider, model, {
    status: "down",
    lastError: String(errorDetail).slice(0, 500),
    downSince: previous?.status === "down" ? previous.downSince ?? new Date() : new Date(),
  });

  if (!row.downNotifiedAt) {
    const key = `${provider}::${model}`;
    const quiet = Date.now() - (lastDownMailAt.get(key) ?? 0) < MAIL_QUIET_MS;
    if (quiet) silentDowns.add(key);
    else {
      lastDownMailAt.set(key, Date.now());
      await notifyDown({ provider, model, errorDetail, failure });
    }
    await patchModelHealth(provider, model, { downNotifiedAt: new Date() });
  }

  // El problema es la clave, no el modelo: cambiar de modelo no lo arregla.
  if (failure.kind === "auth") return { status: "down", outcome: "auth_problem" };

  // Bloque 263: cambiar de modelo SOLO arregla un modelo dado de baja (404/410).
  // Un fallo pasajero (timeout, red, cuota, 5xx) se arregla solo: reemplazar el
  // modelo por eso es lo que generaba los correos de "no se pudo reparar". Se
  // queda marcado caído (el chat usa los otros) hasta que vuelva a responder.
  if (failure.kind !== "gone") return { status: "down", outcome: "waiting_recovery" };

  const due = force || !row.lastRepairAttemptAt || Date.now() - row.lastRepairAttemptAt.getTime() >= REPAIR_RETRY_MS;
  if (!due) return { status: "down", outcome: "waiting_retry" };

  const result = await runRepair({ provider, apiKey, brokenModel: model, errorDetail, failure, health: row });
  return { status: result.outcome === "repaired" ? "repaired" : "down", ...result };
}

const inFlight = new Set();
const lastLiveCheckAt = new Map();

// Punto de entrada ÚNICO: prueba el modelo ahora mismo y aplica la política.
//   trigger "live"      — un pedido real de un cliente falló contra este modelo.
//   trigger "proactive" — chequeo de fondo cada 2 minutos.
//   trigger "daily"     — chequeo profundo de las 3am (reintenta la reparación
//                         aunque no haya pasado el tiempo de espera).
// Nunca lanza: un modelo caído no debe impedir que se chequeen los demás.
export async function checkModel({ provider, apiKey, model, trigger = "proactive" }) {
  const key = `${provider}::${model}`;
  if (inFlight.has(key)) return { status: "skipped", outcome: "already_running" };
  // Solo se vigilan los modelos ACTIVOS. Un pedido que falló justo cuando el
  // admin (o la autorreparación) acababa de apagar ese modelo no debe
  // resucitar su estado de salud ni disparar avisos de algo ya resuelto.
  if (!(await getEffectiveActiveModels(provider)).some((m) => m.model === model)) return { status: "skipped", outcome: "not_active" };
  if (trigger === "live") {
    const last = lastLiveCheckAt.get(key) ?? 0;
    if (Date.now() - last < LIVE_RECHECK_COOLDOWN_MS) return { status: "skipped", outcome: "live_cooldown" };
    lastLiveCheckAt.set(key, Date.now());
  }
  inFlight.add(key);
  try {
    let ms;
    try {
      // Se confirma con una prueba propia ANTES de tocar nada: un timeout
      // puntual de red no debe hacer que el sistema marque caído ni cambie de
      // modelo por ruido pasajero.
      ms = await probeModel(provider, apiKey, model);
    } catch (err) {
      const errorDetail = errorDetailOf(err);
      // Bloque 266b (medido en vivo): el Free Endpoint de NVIDIA responde 404 "Function
      // not found for account" de forma INTERMITENTE con un modelo que casi siempre
      // funciona, así que un 404 suelto tampoco es una baja. Solo una clave inválida
      // se atiende de inmediato; todo lo demás necesita fallos SEGUIDOS.
      const permanent = classifyFailure(errorDetail).kind === "auth";
      const streak = (failureStreak.get(key) ?? 0) + 1;
      failureStreak.set(key, streak);
      // Un fallo pasajero suelto no es una caída: se espera a confirmarlo.
      if (!permanent && streak < FAILURES_BEFORE_DOWN) return { status: "suspect", outcome: "waiting_confirmation", streak };
      return await handleConfirmedFailure({ provider, apiKey, model, errorDetail, force: trigger === "daily" });
    }
    failureStreak.delete(key);
    const previous = await getModelHealth(provider, model);
    await upsertModelHealth(provider, model, {
      status: "healthy",
      lastError: null,
      lastLatencyMs: ms,
      downSince: null,
      downNotifiedAt: null,
      lastRepairAttemptAt: null,
      repairFailedCount: 0,
    });
    // Había avisado que cayó y volvió solo: cierra el ciclo con el aviso de
    // "resuelto" para que el admin no se quede esperando una acción.
    if (previous?.status === "down" && previous.downNotifiedAt && !silentDowns.delete(key)) await notifyRecovered({ provider, model });
    return { status: "healthy", ms };
  } catch (err) {
    console.error(`[aiModelRepair] ${provider}/${model}: error inesperado:`, err);
    return { status: "error", error: err?.message };
  } finally {
    inFlight.delete(key);
  }
}
