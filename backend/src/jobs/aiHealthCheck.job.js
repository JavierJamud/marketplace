import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { getDecryptedCredential } from "../controllers/integrations.controller.js";
import { getAiModelOverrides, getSiteTimezone } from "../controllers/settings.controller.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { logError } from "../lib/errorLog.js";
// Bloque 99: probeModel/findFastestWorkingModel/PROVIDERS ya no viven acá —
// se movieron a lib/aiModelRepair.js para que `ai.js` pueda reusar
// EXACTAMENTE la misma lógica de "buscar reemplazo" en el momento en que un
// pedido real falla, no solo en esta corrida nocturna. Este job sigue
// siendo el chequeo PROACTIVO de las 3am (prueba aunque nada haya fallado
// todavía); ai.js dispara la reparación REACTIVA (solo cuando algo falla de
// verdad, en cualquier momento del día).
import { PROVIDERS, probeModel, findFastestWorkingModel } from "../lib/aiModelRepair.js";

// Bloque 85 (pedido explícito): tercer cron del proyecto — verificación
// diaria de que el modelo configurado de cada proveedor de IA activo
// (Gemini/Groq/NVIDIA NIM) sigue respondiendo de verdad. A diferencia de
// vendorLifecycle.job.js/verificationPayment.job.js (que corren siempre a
// una hora FIJA de Cuba), acá la hora depende de `SiteSettings.timezone`,
// editable por el admin — así que este cron no se programa una sola vez a
// una hora fija: corre cada hora y se AUTOCHEQUEA por dentro (ver
// startAiHealthCheckJob) contra la zona horaria configurada AL MOMENTO de
// cada tick. Esto evita el problema real de node-cron: su `timezone` se fija
// una sola vez al arrancar el servidor — si el admin cambia la zona horaria
// después, un cron programado a mano con esa opción quedaría desincronizado
// hasta el próximo reinicio del backend.

function fmtMs(ms) {
  return `${ms}ms`;
}

// Chequea UN proveedor activo — nunca lanza, siempre devuelve un resumen
// (para que un proveedor caído no le impida al job seguir con los demás).
async function checkProvider(providerName) {
  const apiKey = await getDecryptedCredential(providerName);
  if (!apiKey) return { provider: providerName, status: "inactive" };

  const overrides = await getAiModelOverrides();
  const configuredModel = overrides[providerName]; // null = usa el default del archivo
  const modelToTest = configuredModel || PROVIDERS[providerName].defaultModel;

  try {
    const ms = await probeModel(providerName, apiKey, modelToTest);
    console.log(`[aiHealthCheck] ${providerName} (${modelToTest}) OK en ${fmtMs(ms)}`);
    return { provider: providerName, status: "ok", model: modelToTest, ms };
  } catch (err) {
    const errorDetail = err?.details?.detail || err?.message || "Error desconocido";
    console.error(`[aiHealthCheck] ${providerName} (${modelToTest}) FALLÓ — buscando reemplazo:`, errorDetail);

    let replacement = null;
    try {
      replacement = await findFastestWorkingModel(providerName, apiKey, modelToTest);
    } catch (listErr) {
      console.error(`[aiHealthCheck] ${providerName}: no se pudo listar modelos para buscar reemplazo:`, listErr.message);
    }

    if (replacement) {
      const settings = await prisma.siteSettings.findFirst({ select: { id: true } });
      await prisma.siteSettings.update({ where: { id: settings.id }, data: { [PROVIDERS[providerName].settingsField]: replacement.model } });
      await notifyAdminActionNeeded(
        `⚠ IA: modelo de ${providerName} reemplazado automáticamente`,
        `La verificación automática diaria detectó que el modelo configurado de ${providerName} ("${modelToTest}") dejó de funcionar.\n\n` +
          `Motivo del fallo: ${errorDetail}\n\n` +
          `Se cambió automáticamente al modelo más rápido disponible que sí respondió: "${replacement.model}" (${fmtMs(replacement.ms)}).\n\n` +
          `Puedes revisar o ajustar esto manualmente en Admin → Integraciones.`
      );
      await logError({
        origin: "AI_HEALTH_CHECK",
        message: `Modelo de ${providerName} reemplazado automáticamente: "${modelToTest}" -> "${replacement.model}"`,
        context: { provider: providerName, brokenModel: modelToTest, errorDetail, replacement },
      });
      return { provider: providerName, status: "switched", from: modelToTest, to: replacement.model, ms: replacement.ms };
    }

    // Ni el modelo configurado ni ningún candidato de respaldo funcionó —
    // el proveedor entero parece estar caído (key inválida/revocada, cuenta
    // suspendida, servicio caído del lado de ellos, etc.).
    await notifyAdminActionNeeded(
      `🔴 IA: la integración de ${providerName} no responde`,
      `La verificación automática diaria de proveedores de IA encontró que ${providerName} no responde con NINGÚN modelo probado (ni el configurado "${modelToTest}", ni ningún candidato de respaldo).\n\n` +
        `Motivo del fallo original: ${errorDetail}\n\n` +
        `El resto de proveedores activos sigue cubriendo el chat/generador mientras tanto (ver el orden de respaldo en Admin → Integraciones), pero conviene revisar la clave de ${providerName} ahí — puede estar vencida, revocada, o la cuenta sin saldo/permisos.`
    );
    await logError({
      origin: "AI_HEALTH_CHECK",
      message: `Proveedor ${providerName} no responde con ningún modelo probado`,
      context: { provider: providerName, brokenModel: modelToTest, errorDetail },
    });
    return { provider: providerName, status: "down", model: modelToTest, errorDetail };
  }
}

// Exportado por separado (no solo el scheduler) para poder correrlo a mano
// en un smoke test sin esperar al horario del cron.
export async function runAiHealthCheckJob() {
  const results = [];
  for (const providerName of Object.keys(PROVIDERS)) {
    results.push(await checkProvider(providerName));
  }
  const summary = results.map((r) => `${r.provider}:${r.status}`).join(" ");
  console.log(`[aiHealthCheck] resumen — ${summary}`);
  return results;
}

// "HH" en 24h de una fecha, en una zona horaria IANA dada — Intl con
// hourCycle:"h23" para que medianoche dé "00", nunca "24" (algunos locales
// lo hacen con hour12:false a secas).
function hourInTimezone(date, timezone) {
  return Number(new Intl.DateTimeFormat("en-US", { timeZone: timezone, hour: "2-digit", hourCycle: "h23" }).format(date));
}

// "YYYY-MM-DD" de una fecha en una zona horaria dada — en-CA formatea así
// nativamente, sin tener que armar el string a mano.
function dateStringInTimezone(date, timezone) {
  return new Intl.DateTimeFormat("en-CA", { timeZone: timezone }).format(date);
}

const TARGET_HOUR = 3; // 3:00am en la zona horaria configurada — horario de menos tráfico.

// Corre cada hora en punto y se autochequea por dentro contra la zona
// horaria ACTUAL configurada (nunca una fija capturada al arrancar el
// servidor) — así, si el admin cambia la zona horaria desde el panel, el
// próximo tick ya la respeta sin necesitar reiniciar el backend.
export function startAiHealthCheckJob() {
  cron.schedule("0 * * * *", async () => {
    try {
      const timezone = await getSiteTimezone();
      const now = new Date();
      if (hourInTimezone(now, timezone) !== TARGET_HOUR) return;

      const settings = await prisma.siteSettings.findFirst({ select: { id: true, lastAiHealthCheckAt: true } });
      const today = dateStringInTimezone(now, timezone);
      // Ya corrió hoy (mismo día calendario en la zona configurada) — evita
      // un doble disparo si el tick de las 3am coincide más de una vez
      // (reinicio del servidor a mitad de esa hora, DST, etc.).
      if (settings.lastAiHealthCheckAt && dateStringInTimezone(settings.lastAiHealthCheckAt, timezone) === today) return;

      await runAiHealthCheckJob();
      await prisma.siteSettings.update({ where: { id: settings.id }, data: { lastAiHealthCheckAt: new Date() } });
    } catch (err) {
      console.error("[aiHealthCheckJob] error:", err);
    }
  });
}
