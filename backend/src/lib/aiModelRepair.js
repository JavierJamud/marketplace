import { prisma } from "./prisma.js";
import { notifyAdminActionNeeded } from "./adminNotify.js";
import { logError } from "./errorLog.js";
import { generateWithGemini, listGeminiModels, DEFAULT_MODEL as GEMINI_DEFAULT } from "./gemini.js";
import { generateWithGroq, listGroqModels, DEFAULT_MODEL as GROQ_DEFAULT } from "./groq.js";
import { generateWithNvidia, listNvidiaModels, DEFAULT_MODEL as NVIDIA_DEFAULT } from "./nvidia.js";

// Bloque 99 (pedido explícito — "cuando un modelo se desconecte, que el
// sistema lo detecte y busque el modelo adecuado automáticamente"): lo que
// antes vivía solo dentro de aiHealthCheck.job.js (probeModel,
// findFastestWorkingModel, PROVIDERS, etc. — el chequeo nocturno de las
// 3am) se saca a este archivo compartido para que `ai.js` pueda usar
// EXACTAMENTE la misma lógica de "buscar reemplazo" en el momento en que un
// pedido real falla, no solo una vez al día. Un solo lugar que sabe cómo
// reparar un proveedor, dos disparadores distintos (reactivo en vivo acá,
// proactivo nocturno en el job).

export const HEALTH_PROMPT = "Responde solo con la palabra: listo";
// Bloque 100 (bug real encontrado en vivo): la lista de modelos de Gemini
// creció mucho — hoy incluye agentes especializados ("antigravity-preview",
// "deep-research-*", "computer-use") y generadores de imagen/audio/música
// ("*-image", "transcribe", "tts", "lyria", "nano-banana", "omni",
// "robotics") que Google SÍ marca como capaces de generateContent, pero que
// nunca sirven como reemplazo de un modelo de CHAT/texto simple roto. Como
// los candidatos se ordenan alfabéticamente, los primeros de la lista de
// Gemini resultaron ser puros agentes de este tipo — se gastaban los 6
// intentos ahí y nunca se llegaba a probar un "flash"/"pro" real (probado
// en vivo: findFastestWorkingModel devolvía null en <1s con esta cuenta,
// ni un solo candidato real llegó a intentarse). Patrón ampliado para
// excluir estas categorías completas, no solo audio/moderación como antes.
const EXCLUDE_MODEL_PATTERN =
  /whisper|guard|tts|embed|orpheus|safeguard|moderation|vision|prompt-guard|transcribe|lyria|image|robotics|computer-use|deep-research|antigravity|customtools|nano-banana|omni-|-omni|live/i;
// Techo de candidatos a probar por proveedor cuando el modelo configurado
// falla — sube de 6 a 10 (Bloque 90 ya los prueba EN PARALELO, así que más
// candidatos no significa más espera, solo más chances reales de encontrar
// uno bueno en catálogos grandes como el de Gemini).
const MAX_CANDIDATES_TO_PROBE = 10;

export const PROVIDERS = {
  gemini: { generate: generateWithGemini, list: listGeminiModels, defaultModel: GEMINI_DEFAULT, settingsField: "aiModelGemini" },
  groq: { generate: generateWithGroq, list: listGroqModels, defaultModel: GROQ_DEFAULT, settingsField: "aiModelGroq" },
  nvidia: { generate: generateWithNvidia, list: listNvidiaModels, defaultModel: NVIDIA_DEFAULT, settingsField: "aiModelNvidia" },
};

function fmtMs(ms) {
  return `${ms}ms`;
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

// El modelo configurado (o el default del proveedor) falló — busca un
// reemplazo real probando la lista de modelos REALES que esa key puede usar
// hoy (mismo endpoint que ya usa AdminIntegrations.jsx para el selector),
// nunca una lista hardcodeada que podría estar vieja. Devuelve el más
// rápido de los que sí respondieron, o null si ninguno funcionó.
//
// Bloque 90: los candidatos se prueban EN PARALELO (Promise.allSettled) —
// la espera total es la del más lento de los 6, no la suma de todos.
export async function findFastestWorkingModel(providerName, apiKey, brokenModel) {
  const allModels = await PROVIDERS[providerName].list({ apiKey });
  const candidates = allModels.filter((m) => m !== brokenModel && !EXCLUDE_MODEL_PATTERN.test(m)).slice(0, MAX_CANDIDATES_TO_PROBE);

  const settled = await Promise.allSettled(
    candidates.map(async (model) => ({ model, ms: await probeModel(providerName, apiKey, model) }))
  );
  const results = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
  if (results.length === 0) return null;
  return results.sort((a, b) => a.ms - b.ms)[0];
}

// Bloque 99: un pedido real le pega a `ai.js`, el proveedor principal falla
// — en vez de esperar hasta las 3am para que alguien note que el modelo
// está roto, se dispara ACÁ MISMO (desde callWithFallbackChain, sin bloquear
// la respuesta al cliente que ya está cayendo al siguiente proveedor de la
// cadena) la búsqueda de un reemplazo. Cooldown por proveedor: una ráfaga de
// pedidos fallando al mismo tiempo contra el mismo modelo roto NUNCA debe
// disparar 50 búsquedas en paralelo — una sola reparación intentada cada
// REPAIR_COOLDOWN_MS alcanza, el resto de esos pedidos ya está cubierto por
// el fallback normal de todos modos.
const REPAIR_COOLDOWN_MS = 5 * 60 * 1000;
const lastRepairAttemptAt = new Map();

export async function repairProviderModel(providerName, apiKey, brokenModel, errorDetail) {
  const now = Date.now();
  const last = lastRepairAttemptAt.get(providerName) ?? 0;
  if (now - last < REPAIR_COOLDOWN_MS) return;
  lastRepairAttemptAt.set(providerName, now);

  // Confirma que el modelo sigue roto ANTES de tocar nada — un timeout
  // puntual de red no debe hacer que el sistema cambie de modelo por
  // ruido pasajero. Si esta segunda prueba responde bien, no hay nada que
  // reparar: se deja tal cual (el chequeo de las 3am lo vuelve a mirar de
  // todos modos, por si acaso).
  try {
    await probeModel(providerName, apiKey, brokenModel);
    return;
  } catch {
    // Confirmado: sigue fallando de verdad, vale la pena buscar reemplazo.
  }

  let replacement = null;
  try {
    replacement = await findFastestWorkingModel(providerName, apiKey, brokenModel);
  } catch (listErr) {
    console.error(`[aiModelRepair] ${providerName}: no se pudo listar modelos para buscar reemplazo:`, listErr.message);
  }

  if (replacement) {
    const settings = await prisma.siteSettings.findFirst({ select: { id: true } });
    await prisma.siteSettings.update({ where: { id: settings.id }, data: { [PROVIDERS[providerName].settingsField]: replacement.model } });
    // Pedido explícito: una reparación que SÍ funcionó no hace falta
    // avisarla por correo (el sistema ya resolvió solo) — queda igual
    // registrada en Admin → Errores para quien quiera auditar qué cambió y
    // cuándo, sin ensuciar la bandeja del admin por algo que no necesita
    // acción de su parte.
    await logError({
      origin: "AI_HEALTH_CHECK",
      message: `Modelo de ${providerName} reparado automáticamente en vivo: "${brokenModel}" -> "${replacement.model}"`,
      context: { provider: providerName, brokenModel, errorDetail, replacement, trigger: "live" },
    });
    console.log(`[aiModelRepair] ${providerName} reparado en vivo: "${brokenModel}" -> "${replacement.model}" (${fmtMs(replacement.ms)})`);
    return;
  }

  // Ni el modelo configurado ni ningún candidato de respaldo funcionó — esto
  // sí es un error persistente que amerita avisar de inmediato (pedido
  // explícito), no solo esperar al resumen de las 3am.
  await notifyAdminActionNeeded(
    `🔴 IA: la integración de ${providerName} no responde`,
    `Un pedido real detectó que ${providerName} no responde con NINGÚN modelo probado (ni el configurado "${brokenModel}", ni ningún candidato de respaldo).\n\n` +
      `Motivo del fallo: ${errorDetail}\n\n` +
      `El resto de proveedores activos sigue cubriendo el chat/generador mientras tanto (ver el orden de respaldo en Admin → Integraciones), pero conviene revisar la clave de ${providerName} ahí — puede estar vencida, revocada, o la cuenta sin saldo/permisos.`
  );
  await logError({
    origin: "AI_HEALTH_CHECK",
    message: `Proveedor ${providerName} no responde con ningún modelo probado (detectado en vivo)`,
    context: { provider: providerName, brokenModel, errorDetail, trigger: "live" },
  });
}
