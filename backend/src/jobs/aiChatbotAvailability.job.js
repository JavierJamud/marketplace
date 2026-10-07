import cron from "node-cron";
import { getDecryptedCredential } from "../controllers/integrations.controller.js";
import { checkModel, PROVIDERS } from "../lib/aiModelRepair.js";
import { AI_PROVIDER_NAMES, getEffectiveActiveModels } from "../lib/aiModels.js";
import { getModelHealthRows, upsertModelHealth, deleteModelHealth } from "../lib/aiProviderHealth.js";
import { getQuotaStatus } from "../lib/aiQuota.js";

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

// Bloque 280/281: cada 10 minutos (antes cada 2), y sin gastar cupo (ver checkProvider).
const CHECK_INTERVAL_CRON = "*/10 * * * *";
// Un modelo caído se vuelve a probar con una consulta real como mucho una vez en este plazo.
const RECENT_OK_MS = 60 * 60_000;
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

  // Bloque 281 (pedido explícito — "que no se gasten tokens si nadie usa los
  // servicios"): la vigilancia de fondo ya NO le hace preguntas a la IA. Para saber
  // si un modelo sigue existiendo se pide la LISTA de modelos de la API, que es
  // gratis y no gasta cupo. Solo se hace una consulta real cuando hace falta de
  // verdad: un modelo marcado caído (máximo una vez por hora, para ver si volvió) o
  // uno que desapareció de la lista (para confirmar la baja y buscar reemplazo).
  // Si hay tráfico real, ese tráfico es el que dice si responde.
  let listed = null;
  try {
    listed = new Set(await PROVIDERS[providerName].list({ apiKey }));
  } catch {
    listed = null; // la lista falló (red): no se decide nada con eso, se espera al próximo turno
  }
  const healthByModel = new Map(health.filter((h) => h.provider === providerName).map((h) => [h.model, h]));
  const results = await Promise.all(
    models.map(async (m) => {
      const quota = await getQuotaStatus(providerName, m.model);
      if (!quota.available) return { status: "skipped", outcome: "near_free_limit" };
      const row = healthByModel.get(m.model);
      const checkedAgo = row?.lastCheckedAt ? Date.now() - new Date(row.lastCheckedAt).getTime() : Infinity;
      if (row?.status === "down") {
        if (checkedAgo < RECENT_OK_MS) return { status: "down", outcome: "waiting_recheck" };
        return checkModel({ provider: providerName, apiKey, model: m.model, trigger });
      }
      if (!listed) return { status: row?.status ?? "unknown", outcome: "list_unavailable" };
      if (listed.has(m.model)) {
        await upsertModelHealth(providerName, m.model, { status: "healthy", lastError: null, downSince: null });
        return { status: "healthy", outcome: "listed_by_api" };
      }
      return checkModel({ provider: providerName, apiKey, model: m.model, trigger });
    })
  );
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
