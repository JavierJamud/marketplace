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
  transcription: { label: "Audio: voz a texto", purpose: "Transcribe notas de voz a texto (hoy lo usa el micrófono del chat, solo con Whisper de Groq).", usedNow: false, addable: false },
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
  ["other", /detector|classifier/i],
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
