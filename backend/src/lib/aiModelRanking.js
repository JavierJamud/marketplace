// Bloque 245: orden de "del más reciente al más antiguo" para elegir un
// modelo de reemplazo. Medido en vivo contra las APIs reales de esta cuenta:
//   - Groq entrega `created` (fecha real de publicación).
//   - NVIDIA entrega un `created` falso (el mismo valor en los 80 modelos),
//     así que no se usa.
//   - Gemini no entrega fecha.
// Para los dos últimos la única señal pública es el número de versión que va
// en el nombre ("gemini-3.1-pro", "nemotron-3.5-lightning"). No es perfecto, y
// por eso este orden solo PRE-ORDENA: la decisión final la toma otra IA del
// sistema entre estos candidatos, y la respuesta se valida contra la lista
// real (aiModelRepair.js).

// Primer número de versión razonable del nombre ("llama-3.3-70b" -> 3.3,
// "gemma-4-31b" -> 4, "qwen3.8-27b" -> 3.8). Se ignoran los números de 3 o
// más cifras: son tamaños ("120b") o fechas ("2411"), no versiones.
export function versionOf(modelId) {
  const matches = String(modelId).matchAll(/(\d{1,2}(?:\.\d{1,2})?)(?!\d)/g);
  for (const match of matches) {
    const value = Number(match[1]);
    if (Number.isFinite(value) && value > 0) return value;
  }
  return 0;
}

// Las versiones "preview"/"exp"/"beta" cambian o se retiran sin aviso: a
// igualdad de versión, el estable va primero.
function isUnstable(modelId) {
  return /preview|exp|beta|alpha/i.test(modelId);
}

// `models`: [{ id, created }] (created en segundos Unix o null).
// Devuelve los ids, del candidato más probable de ser el más nuevo al menos.
export function rankNewestFirst(models) {
  return [...models]
    .sort((a, b) => {
      if (a.created != null && b.created != null && a.created !== b.created) return b.created - a.created;
      if (a.created != null && b.created == null) return -1;
      if (a.created == null && b.created != null) return 1;
      const byVersion = versionOf(b.id) - versionOf(a.id);
      if (byVersion !== 0) return byVersion;
      const byStability = Number(isUnstable(a.id)) - Number(isUnstable(b.id));
      if (byStability !== 0) return byStability;
      return a.id.localeCompare(b.id);
    })
    .map((m) => m.id);
}
