import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { getSiteTimezone } from "../controllers/settings.controller.js";
import { runAiModelsCheck } from "./aiChatbotAvailability.job.js";

// Bloque 85 (pedido explícito): tercer cron del proyecto — verificación
// diaria de que cada modelo de IA activo (Gemini/Groq/NVIDIA NIM) sigue
// respondiendo de verdad. A diferencia de vendorLifecycle.job.js/
// verificationPayment.job.js (que corren siempre a una hora FIJA de Cuba),
// acá la hora depende de `SiteSettings.timezone`, editable por el admin — así
// que este cron no se programa una sola vez a una hora fija: corre cada hora
// y se AUTOCHEQUEA por dentro (ver startAiHealthCheckJob) contra la zona
// horaria configurada AL MOMENTO de cada tick. Esto evita el problema real de
// node-cron: su `timezone` se fija una sola vez al arrancar el servidor — si
// el admin cambia la zona horaria después, un cron programado a mano con esa
// opción quedaría desincronizado hasta el próximo reinicio del backend.
//
// Bloque 245: este job ya NO tiene su propia lógica de reparación (antes
// duplicaba la de aiModelRepair.js y avisaba distinto que el camino en vivo).
// Corre el mismo recorrido que el chequeo de cada 2 minutos, pero con
// trigger "daily": reintenta la reparación de los modelos que sigan caídos
// aunque todavía no haya pasado el tiempo de espera entre reintentos.

// Exportado por separado (no solo el scheduler) para poder correrlo a mano
// en un smoke test sin esperar al horario del cron.
export async function runAiHealthCheckJob() {
  const results = await runAiModelsCheck("daily");
  const summary = results.map((r) => `${r.provider}/${r.model}:${r.status}`).join(" ");
  console.log(`[aiHealthCheck] resumen — ${summary || "sin modelos activos"}`);
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
