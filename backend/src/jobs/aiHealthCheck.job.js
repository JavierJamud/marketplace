import cron from "node-cron";
import { prisma } from "../lib/prisma.js";
import { getSiteTimezone } from "../controllers/settings.controller.js";
import { runAiModelsCheck } from "./aiChatbotAvailability.job.js";
import { beginDailyReport, endDailyReport } from "../lib/aiModelRepair.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";

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
const LABELS = { groq: "Groq", nvidia: "NVIDIA NIM", gemini: "Gemini" };
const PENDING_REASON = {
  auth_problem: "La clave fue rechazada. Revisa o cambia la clave en Admin → Integraciones.",
  quota_wait: "Sin cupo gratis en este momento. Se renueva solo; no hace falta hacer nada.",
  repair_failed: "No se encontró un modelo de reemplazo que respondiera. Elige uno a mano en Admin → Integraciones.",
};

// Bloque 283 (pedido explícito — "en la madrugada el admin recibe en su correo los
// fallos que tuvo el sistema a las 3, las soluciones que se le dieron y lo que quedó
// pendiente; y todo queda registrado en el panel"): se juntan los resultados de la
// revisión, se guarda cada caso en Admin → Errores (resuelto o pendiente) y se manda
// UN solo correo con el resumen. Si todo estaba bien, no se manda nada.
export async function runAiHealthCheckJob() {
  beginDailyReport();
  let results = [];
  let events = [];
  try {
    results = await runAiModelsCheck("daily");
  } finally {
    events = endDailyReport();
  }
  const detail = (provider, model, type) => events.find((e) => e.provider === provider && e.model === model && (!type || e.type === type));

  const solved = [];
  const pending = [];

  for (const r of results) {
    const label = `${LABELS[r.provider] ?? r.provider} · ${r.model}`;
    if (r.recovered) solved.push({ provider: r.provider, model: r.model, text: `${label}: estaba caído y volvió a responder solo.` });
    else if (r.status === "repaired") {
      const d = detail(r.provider, r.model, "repaired");
      solved.push({ provider: r.provider, model: r.model, text: `${label}: no respondía. Se cambió por "${d?.newModel ?? "otro modelo"}"${d?.ms ? ` (respondió en ${d.ms} ms)` : ""} y quedó configurado.` });
    } else if (r.status === "down") {
      const d = detail(r.provider, r.model);
      const reason = PENDING_REASON[r.outcome] ?? "Sigue sin responder. Pruébalo o cámbialo en Admin → Integraciones.";
      const tried = d?.tried?.length ? ` Modelos probados: ${d.tried.map((t) => t.model).join(", ")}.` : "";
      pending.push({ provider: r.provider, model: r.model, text: `${label}: ${reason}${tried}`, errorDetail: r.errorDetail ?? d?.errorDetail ?? null });
    }
  }

  for (const s of solved) {
    await prisma.errorLog.create({ data: { origin: "AI_HEALTH_CHECK", message: `Revisión diaria de IA — resuelto: ${s.text}`, context: { provider: s.provider, model: s.model }, resolved: true } }).catch(() => {});
  }
  for (const p of pending) {
    await prisma.errorLog.create({ data: { origin: "AI_HEALTH_CHECK", message: `Revisión diaria de IA — pendiente: ${p.text}`, context: { provider: p.provider, model: p.model, errorDetail: p.errorDetail }, resolved: false } }).catch(() => {});
  }

  if (solved.length || pending.length) {
    const lines = [
      "Resultado de la revisión diaria de los modelos de IA (3:00am).",
      "",
      solved.length ? "SOLUCIONADO:" : "",
      ...solved.map((s) => `- ${s.text}`),
      solved.length ? "" : "",
      pending.length ? "PENDIENTE (necesita tu revisión):" : "Nada quedó pendiente.",
      ...pending.map((p) => `- ${p.text}`),
      "",
      "Todo queda registrado en Admin → Errores. Los modelos se administran en Admin → Integraciones.",
    ].filter((l, i, a) => !(l === "" && a[i - 1] === ""));
    const subject = pending.length ? `🟠 IA: revisión diaria — ${pending.length} pendiente(s)` : "✅ IA: revisión diaria — todo solucionado";
    await notifyAdminActionNeeded(subject, lines.join("\n"));
  }

  const summary = results.map((r) => `${r.provider}/${r.model}:${r.status}`).join(" ");
  console.log(`[aiHealthCheck] resumen — ${summary || "sin modelos activos"} | resueltos ${solved.length}, pendientes ${pending.length}`);
  return { results, solved, pending };
}

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
