import { prisma } from "./prisma.js";
import { DEFAULT_MODEL as GEMINI_DEFAULT } from "./gemini.js";
import { DEFAULT_MODEL as GROQ_DEFAULT } from "./groq.js";
import { DEFAULT_MODEL as NVIDIA_DEFAULT } from "./nvidia.js";

// Bloque 245: acceso a los modelos configurados de cada proveedor de IA.
// Archivo hoja a propósito (solo prisma + los DEFAULT_MODEL de cada
// proveedor): lo importan ai.js, aiModelRepair.js, los dos jobs y los
// controllers, y ninguno de ellos puede importar a otro sin crear un ciclo.

export const AI_PROVIDER_NAMES = ["groq", "gemini", "nvidia"];
export const DEFAULT_MODELS = { gemini: GEMINI_DEFAULT, groq: GROQ_DEFAULT, nvidia: NVIDIA_DEFAULT };

// Un proveedor SIN filas usa su modelo por defecto (mismo comportamiento de
// antes de que existiera AiModelConfig, y de un proveedor recién configurado
// que el admin todavía no tocó). En cuanto tiene una fila, el default deja de
// usarse: el admin manda.
export async function getEffectiveModels(provider) {
  const rows = await prisma.aiModelConfig.findMany({
    where: { provider },
    orderBy: [{ priority: "asc" }, { createdAt: "asc" }],
  });
  if (rows.length === 0) {
    return [{ id: null, provider, model: DEFAULT_MODELS[provider], isActive: true, priority: 0, source: "DEFAULT" }];
  }
  return rows;
}

export async function getEffectiveActiveModels(provider) {
  return (await getEffectiveModels(provider)).filter((m) => m.isActive);
}

// Se usa para armar la lista que ve el admin: cada proveedor con sus modelos
// (o su default si no tiene ninguno) en una sola consulta.
export async function getAllEffectiveModels() {
  const rows = await prisma.aiModelConfig.findMany({ orderBy: [{ priority: "asc" }, { createdAt: "asc" }] });
  const byProvider = Object.fromEntries(AI_PROVIDER_NAMES.map((p) => [p, []]));
  for (const row of rows) byProvider[row.provider]?.push(row);
  for (const p of AI_PROVIDER_NAMES) {
    if (byProvider[p].length === 0) {
      byProvider[p] = [{ id: null, provider: p, model: DEFAULT_MODELS[p], isActive: true, priority: 0, source: "DEFAULT" }];
    }
  }
  return byProvider;
}
