import cron from "node-cron";
import { getDecryptedCredential } from "../controllers/integrations.controller.js";
import { getAiModelOverrides } from "../controllers/settings.controller.js";
import { PROVIDERS, probeModel, repairProviderModel } from "../lib/aiModelRepair.js";
import { getProviderHealth, upsertProviderHealth } from "../lib/aiProviderHealth.js";

// Bloque 238 (pedido explícito — "cuando se accede al sitio, el sistema debe
// verificar en segundo plano que el chatbot funciona antes de mostrarlo"): a
// diferencia de aiHealthCheck.job.js (chequeo PROFUNDO una vez al día a las
// 3am, con búsqueda completa de modelo de reemplazo), este cron es el
// chequeo LIVIANO y FRECUENTE que decide, casi en tiempo real, si el chatbot
// se muestra a los clientes — nunca espera hasta el día siguiente para
// ocultar un proveedor caído. El resultado se cachea en AiProviderHealth
// (lib/aiProviderHealth.js), que es lo que lee isAIAvailable() (ai.js) y
// getSettings() — ningún cliente real dispara una llamada a la IA con solo
// visitar el sitio, siempre lee el último resultado ya calculado acá.

const CHECK_INTERVAL_CRON = "*/2 * * * *"; // cada 2 minutos

// Nunca lanza — un proveedor caído no debe impedir que se chequeen los
// demás (mismo criterio que checkProvider en aiHealthCheck.job.js).
async function checkProviderLight(providerName) {
  const apiKey = await getDecryptedCredential(providerName);
  if (!apiKey) {
    await upsertProviderHealth(providerName, { status: "inactive", model: null, lastError: null, downSince: null });
    return;
  }

  const overrides = await getAiModelOverrides();
  const modelToTest = overrides[providerName] || PROVIDERS[providerName].defaultModel;

  try {
    await probeModel(providerName, apiKey, modelToTest);
    await upsertProviderHealth(providerName, { status: "healthy", model: modelToTest, lastError: null, downSince: null });
  } catch (err) {
    const errorDetail = err?.details?.detail || err?.message || "Error desconocido";
    const previous = await getProviderHealth(providerName);

    if (previous?.status === "down") {
      // Ya se intentó reparar en la transición anterior — no repetir la
      // búsqueda de reemplazo ni el correo en cada tick mientras sigue
      // caído (saturaría al admin cada 2 minutos en una caída larga). El
      // cron diario de las 3am y el tráfico real (que sigue reintentando
      // vía el fallback normal de ai.js) quedan como los reintentos de
      // fondo mientras tanto.
      await upsertProviderHealth(providerName, {
        status: "down",
        model: modelToTest,
        lastError: errorDetail,
        downSince: previous.downSince ?? new Date(),
      });
      return;
    }

    // Transición de sano a caído — único momento en que vale la pena
    // reparar (buscar un modelo de reemplazo) y avisar al admin.
    const result = await repairProviderModel(providerName, apiKey, modelToTest, errorDetail, "proactive");
    if (result?.outcome === "recovered" || result?.outcome === "repaired") {
      await upsertProviderHealth(providerName, { status: "healthy", model: result.model, lastError: null, downSince: null });
    } else {
      // "down" o "skipped_cooldown" (otro disparador ya está reparando este
      // mismo proveedor en este momento) — se marca caído igual, el próximo
      // tick ya lo sabrá sin reintentar la búsqueda.
      await upsertProviderHealth(providerName, { status: "down", model: modelToTest, lastError: errorDetail, downSince: new Date() });
    }
  }
}

// Exportada aparte (no solo el scheduler) para poder correrla a mano en un
// smoke test sin esperar el próximo tick.
export async function runAiChatbotAvailabilityCheck() {
  for (const providerName of Object.keys(PROVIDERS)) {
    await checkProviderLight(providerName).catch((err) => console.error(`[aiChatbotAvailability] ${providerName}:`, err));
  }
}

export function startAiChatbotAvailabilityJob() {
  // Corrida inmediata al arrancar — sin esperar el primer tick, para que
  // AiProviderHealth no quede vacía/desactualizada justo después de un
  // deploy o reinicio del backend.
  runAiChatbotAvailabilityCheck().catch((err) => console.error("[aiChatbotAvailabilityJob] error en la corrida inicial:", err));

  cron.schedule(CHECK_INTERVAL_CRON, () => {
    runAiChatbotAvailabilityCheck().catch((err) => console.error("[aiChatbotAvailabilityJob] error:", err));
  });
}
