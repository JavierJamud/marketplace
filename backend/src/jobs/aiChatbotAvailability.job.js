import cron from "node-cron";
import { getDecryptedCredential } from "../controllers/integrations.controller.js";
import { checkModel } from "../lib/aiModelRepair.js";
import { AI_PROVIDER_NAMES, getEffectiveActiveModels } from "../lib/aiModels.js";
import { getModelHealthRows, upsertModelHealth, deleteModelHealth } from "../lib/aiProviderHealth.js";

// Bloque 238 (pedido explícito — "cuando se accede al sitio, el sistema debe
// verificar en segundo plano que el chatbot funciona antes de mostrarlo"): a
// diferencia de aiHealthCheck.job.js (chequeo PROFUNDO una vez al día a las
// 3am), este cron es el chequeo LIVIANO y FRECUENTE que decide, casi en
// tiempo real, si el chatbot se muestra a los clientes — nunca espera hasta
// el día siguiente para ocultar un modelo caído. El resultado se cachea en
// AiModelHealth (lib/aiProviderHealth.js), que es lo que lee isAIAvailable()
// (ai.js) y getSettings() — ningún cliente real dispara una llamada a la IA
// con solo visitar el sitio, siempre lee el último resultado ya calculado acá.
//
// Bloque 245: ya no hay lógica de reparación duplicada acá — chequea CADA
// modelo activo de CADA proveedor y delega todo (aviso único, reparación
// verificada, "problema resuelto") en checkModel (lib/aiModelRepair.js), la
// misma política que usan ai.js en vivo y el chequeo diario de las 3am.

const CHECK_INTERVAL_CRON = "*/2 * * * *"; // cada 2 minutos
let running = false;

// Chequea todos los modelos activos de UN proveedor en paralelo (la espera es
// la del más lento, no la suma). Nunca lanza.
async function checkProvider(providerName, trigger) {
  const apiKey = await getDecryptedCredential(providerName);
  const health = await getModelHealthRows();

  if (!apiKey) {
    // Sin clave activa: se limpian sus modelos y queda un único marcador
    // "inactive" para que isChatbotHealthy distinga "apagado" de "sin chequear".
    await Promise.all(health.filter((h) => h.provider === providerName && h.model !== "").map((h) => deleteModelHealth(providerName, h.model)));
    await upsertModelHealth(providerName, "", { status: "inactive", lastError: null, lastLatencyMs: null, downSince: null });
    return [];
  }

  await deleteModelHealth(providerName, "");
  const models = await getEffectiveActiveModels(providerName);
  const activeNames = new Set(models.map((m) => m.model));
  // Un modelo que el admin desactivó o borró ya no cuenta para la salud.
  await Promise.all(health.filter((h) => h.provider === providerName && h.model !== "" && !activeNames.has(h.model)).map((h) => deleteModelHealth(providerName, h.model)));

  const results = await Promise.all(models.map((m) => checkModel({ provider: providerName, apiKey, model: m.model, trigger })));
  return models.map((m, i) => ({ provider: providerName, model: m.model, ...results[i] }));
}

// Exportada aparte (no solo el scheduler) para poder correrla a mano en un
// smoke test sin esperar el próximo tick, y para que el chequeo diario de las
// 3am reuse exactamente el mismo recorrido con `trigger: "daily"`.
export async function runAiModelsCheck(trigger = "proactive") {
  const all = [];
  for (const providerName of AI_PROVIDER_NAMES) {
    try {
      all.push(...(await checkProvider(providerName, trigger)));
    } catch (err) {
      console.error(`[aiChatbotAvailability] ${providerName}:`, err);
    }
  }
  return all;
}

export async function runAiChatbotAvailabilityCheck() {
  // Un chequeo de NVIDIA puede tardar bastante (medido hasta ~100s en un mal
  // día): sin esta guarda, dos ticks de 2 minutos se solaparían.
  if (running) return [];
  running = true;
  try {
    return await runAiModelsCheck("proactive");
  } finally {
    running = false;
  }
}

export function startAiChatbotAvailabilityJob() {
  // Corrida inmediata al arrancar — sin esperar el primer tick, para que
  // AiModelHealth no quede vacía/desactualizada justo después de un deploy o
  // reinicio del backend.
  runAiChatbotAvailabilityCheck().catch((err) => console.error("[aiChatbotAvailabilityJob] error en la corrida inicial:", err));

  cron.schedule(CHECK_INTERVAL_CRON, () => {
    runAiChatbotAvailabilityCheck().catch((err) => console.error("[aiChatbotAvailabilityJob] error:", err));
  });
}
