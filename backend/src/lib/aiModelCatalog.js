// Bloque 263 (pedido explícito — "los modelos deben diferenciarse por lo que son
// (audio, video, imagen u otros) y especificar para qué es cada uno"): clasifica
// cada modelo que lista la API de un proveedor por TIPO y PROPÓSITO.
//
// Ninguna de las tres APIs dice de forma fiable qué es cada modelo: Gemini da los
// métodos que soporta, Groq solo el nombre y quién lo publica, NVIDIA solo el
// nombre. Por eso la clasificación sale de lo que SÍ es verificable (los métodos
// de Gemini) y, cuando no hay otra señal, del nombre. No es perfecta, pero se
// equivoca hacia lo seguro: un modelo dudoso queda como "Otro" y no se puede
// agregar a la cadena de respaldo de texto.
//
// Qué usa hoy la plataforma: TEXTO (chat de tiendas, asistentes, descripciones,
// autocorrección de búsqueda) y AUDIO (voz a texto con Whisper de Groq). Los
// modelos de VISIÓN (texto + imagen) se podrán usar para analizar tiendas y
// páginas; por eso ya se distinguen.

export const CATEGORIES = {
  text: { label: "Texto", purpose: "Responde preguntas y redacta: alimenta el chat de las tiendas, los asistentes y las descripciones de productos.", usedNow: true, addable: true },
  vision: { label: "Texto + imagen", purpose: "Entiende imágenes además de texto. Sirve como modelo de texto y se podrá usar para analizar tiendas y páginas visualmente.", usedNow: true, addable: true },
  transcription: { label: "Audio: voz a texto", purpose: "Transcribe notas de voz a texto (hoy lo usa el micrófono del chat, solo con Whisper de Groq).", usedNow: true, addable: false },
  speech: { label: "Audio: texto a voz", purpose: "Convierte texto en voz hablada. La plataforma todavía no lo usa.", usedNow: false, addable: false },
  image: { label: "Imagen: crear o editar", purpose: "Genera o edita imágenes. La plataforma todavía no lo usa.", usedNow: false, addable: false },
  video: { label: "Video: crear", purpose: "Genera video. La plataforma todavía no lo usa.", usedNow: false, addable: false },
  embedding: { label: "Embeddings", purpose: "Convierte texto en vectores para buscar por significado. La plataforma todavía no lo usa.", usedNow: false, addable: false },
  safety: { label: "Moderación", purpose: "Detecta contenido dañino o inseguro. No responde preguntas.", usedNow: false, addable: false },
  code: { label: "Código", purpose: "Especializado en programar. No es adecuado para atender clientes.", usedNow: false, addable: false },
  other: { label: "Otro", purpose: "No se pudo identificar para qué sirve; no se agrega a la cadena de texto.", usedNow: false, addable: false },
};

// El orden en que se muestran los grupos.
export const CATEGORY_ORDER = ["text", "vision", "transcription", "speech", "image", "video", "embedding", "safety", "code", "other"];

const RULES = [
  ["safety", /guard|safeguard|moderation|shield|nemoguard|content-safety/i],
  ["embedding", /embed|rerank|bge-|e5-|nv-embed|arctic-embed|retriev/i],
  ["transcription", /whisper|transcribe|canary|parakeet|speech-to-text|asr\b/i],
  ["speech", /tts|orpheus|playai|text-to-speech|speech-synth|\bspeech\b|voice|magpie/i],
  ["other", /detector|classifier|diffusion|calibration|ising/i],
  ["video", /veo|video|sora|cosmos(?!-reason)|\bwan\b/i],
  ["image", /imagen|image-gen|flux|stable-diffusion|sdxl|sd3|nano-banana|dall-e|-image|edify|picasso/i],
  ["code", /coder|codestral|starcoder|codellama|code-|-code|deepseek-coder|granite-.*code/i],
  ["vision", /vision|-vl\b|-vl-|vl-|llava|pixtral|paligemma|kosmos|neva|vila|fuyu|maverick|scout|gemma-?[34]|multimodal|gemini|phi-.*(vision|multimodal)|qwen.*-vl/i],
];

// `meta` (opcional) trae lo que la API sí sabe del modelo: en Gemini, `methods`
// (los métodos soportados) permite distinguir con certeza embeddings, imagen y
// video de los modelos de texto.
export function classifyModel(provider, id, meta = {}) {
  const methods = meta.methods ?? null;
  let category = null;
  if (methods) {
    if (methods.includes("embedContent") || methods.includes("batchEmbedContents")) category = "embedding";
    else if (methods.includes("predictLongRunning")) category = "video";
    else if (methods.includes("predict")) category = "image";
    else if (methods.includes("bidiGenerateContent") && !methods.includes("generateContent")) category = "speech";
  }
  if (!category) {
    for (const [name, pattern] of RULES) {
      if (pattern.test(id)) {
        category = name;
        break;
      }
    }
  }
  // Gemini: todo modelo de generateContent entiende imágenes, salvo los
  // especializados que las reglas de arriba ya apartaron (tts, image, live...).
  if (!category && provider === "gemini" && methods?.includes("generateContent")) category = "vision";
  if (category === "vision" && provider === "gemini" && /tts|image|live|audio|robotics|computer-use|deep-research|antigravity/i.test(id)) category = /tts|audio|live/i.test(id) ? "speech" : /image/i.test(id) ? "image" : "other";
  if (!category) category = "text";
  const info = CATEGORIES[category];
  return { id, category, label: info.label, purpose: info.purpose, addable: info.addable, description: meta.description ?? null, owner: meta.owner ?? null, contextWindow: meta.contextWindow ?? null };
}

// Mensaje claro (en vez del cuerpo crudo del error del proveedor) cuando un
// modelo de la lista no se puede usar con la clave de este admin.
export function friendlyModelError(providerLabel, model, failureKind) {
  if (failureKind === "gone") return `${providerLabel} lista el modelo "${model}", pero no está disponible para tu cuenta o ya fue retirado. Elige otro de la lista.`;
  if (failureKind === "auth") return `${providerLabel} rechazó la clave al probar "${model}". Revisa la clave de ${providerLabel}.`;
  if (failureKind === "quota") return `${providerLabel} llegó a su límite de uso al probar "${model}". Prueba de nuevo en unos minutos.`;
  if (failureKind === "transient") return `${providerLabel} no respondió a tiempo con "${model}". Puede ser lento o estar saturado; prueba de nuevo.`;
  return `${providerLabel} no respondió con "${model}". Prueba con otro modelo.`;
}

// Modelos que la API lista pero que fallaron al probarlos como "no existe o ya
// no está disponible" (404/410). Vive en memoria (se olvida al reiniciar y a las
// 12 horas, por si el proveedor lo habilita) y sirve para marcarlos en la lista
// en vez de dejar que se intenten agregar una y otra vez.
const UNAVAILABLE_TTL_MS = 12 * 60 * 60 * 1000;
const unavailable = new Map();
export function markModelUnavailable(provider, model, reason) {
  unavailable.set(`${provider}::${model}`, { at: Date.now(), reason: String(reason ?? "").slice(0, 160) });
}
export function getUnavailableModel(provider, model) {
  const key = `${provider}::${model}`;
  const entry = unavailable.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > UNAVAILABLE_TTL_MS) {
    unavailable.delete(key);
    return null;
  }
  return entry;
}
export function clearModelUnavailable(provider, model) {
  unavailable.delete(`${provider}::${model}`);
}

// Disponibilidad REAL con la clave de esta cuenta. Que una API liste un modelo no
// quiere decir que la cuenta pueda usarlo (NVIDIA lista ~80 y a esta cuenta le
// responden 404 "Function not found for account" casi todos). Se prueban en segundo
// plano, de a pocos a la vez, solo los modelos que se podrían agregar al chat (texto
// y texto + imagen), y el resultado se recuerda 6 horas.
const AVAILABLE_TTL_MS = 6 * 60 * 60 * 1000;
const PROBE_CONCURRENCY = 6;
const available = new Map(); // key -> { at, ms }
const probeState = new Map(); // provider -> { running, done, total, startedAt }

export function markModelAvailable(provider, model, ms) {
  available.set(`${provider}::${model}`, { at: Date.now(), ms });
  unavailable.delete(`${provider}::${model}`);
}
export function getModelAvailable(provider, model) {
  const key = `${provider}::${model}`;
  const entry = available.get(key);
  if (!entry) return null;
  if (Date.now() - entry.at > AVAILABLE_TTL_MS) {
    available.delete(key);
    return null;
  }
  return entry;
}
export function getProbeState(provider) {
  const s = probeState.get(provider);
  return s ? { running: s.running, done: s.done, total: s.total } : { running: false, done: 0, total: 0 };
}

// Lanza (sin esperar) la comprobación de los modelos agregables que todavía no se
// probaron o cuyo resultado caducó. `probe(model)` hace la consulta real y lanza si falla;
// `classify(err)` devuelve "gone" para un 404/410 (no existe para esta cuenta).
export function startAvailabilityProbe({ provider, models, probe, classify }) {
  const state = probeState.get(provider);
  if (state?.running) return;
  const pending = models.filter((id) => !getModelAvailable(provider, id) && !getUnavailableModel(provider, id));
  if (pending.length === 0) return;
  const run = { running: true, done: 0, total: pending.length, startedAt: Date.now() };
  probeState.set(provider, run);
  const queue = [...pending];
  const worker = async () => {
    while (queue.length > 0) {
      const id = queue.shift();
      const start = Date.now();
      try {
        await probe(id);
        markModelAvailable(provider, id, Date.now() - start);
      } catch (err) {
        if (classify(err) === "gone") markModelUnavailable(provider, id, err?.details?.detail ?? err?.message);
        // cuota, red o timeout: no se sabe, se deja sin marcar para volver a probar
      }
      run.done++;
    }
  };
  Promise.all(Array.from({ length: PROBE_CONCURRENCY }, worker))
    .catch(() => {})
    .finally(() => {
      run.running = false;
    });
}

// Tipo de fallo a partir del texto del error, para decidir si un modelo "no existe
// para esta cuenta" (gone). Mismos criterios que classifyFailure de aiModelRepair.js,
// duplicados aquí a propósito: este archivo no puede importar aquel (ciclo).
export function failureKindOf(text) {
  const s = String(text || "").toLowerCase();
  if (/401|403|api key|apikey|unauthor|forbidden|permission|invalid.*key|key.*invalid/.test(s)) return "auth";
  if (/404|410|not found|not_found|decommission|deprecat|no longer|does not exist|gone|model_not_found/.test(s)) return "gone";
  if (/429|quota|rate.?limit|exhaust|too many/.test(s)) return "quota";
  return "transient";
}
