import { AppError } from "../utils/AppError.js";
import { recordAiResponse } from "./aiQuota.js";

// Respuesta de la IA en streaming (pedido explícito — "el asistente nunca debe
// escribir en segundo plano: tiene que escribir en tiempo real y el cliente ir
// viendo cómo va escribiendo"). Los tres proveedores devuelven el texto por
// trozos (SSE); aquí se leen y cada trozo se pasa a `onDelta` en cuanto llega.
// El texto completo se devuelve al final, igual que las funciones de siempre.

const STREAM_TIMEOUT_MS = 40_000; // techo de toda la respuesta
const MAX_TOKENS = 1500;
const TEMPERATURE = 0.4; // respuestas de negocio: menos creatividad, más fidelidad a los datos

const ENDPOINTS = {
  groq: "https://api.groq.com/openai/v1/chat/completions",
  nvidia: "https://integrate.api.nvidia.com/v1/chat/completions",
  gemini: "https://generativelanguage.googleapis.com/v1beta/models",
};

function describe(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "Se agotó el tiempo de espera sin respuesta.";
  return err?.message || "Error de red desconocido.";
}

// Lee un cuerpo SSE y entrega el JSON de cada línea "data: ...".
async function readSse(res, onData) {
  const decoder = new TextDecoder();
  let buffer = "";
  for await (const chunk of res.body) {
    buffer += decoder.decode(chunk, { stream: true });
    let nl;
    while ((nl = buffer.indexOf("\n")) !== -1) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line.startsWith("data:")) continue;
      const payload = line.slice(5).trim();
      if (!payload || payload === "[DONE]") continue;
      try {
        onData(JSON.parse(payload));
      } catch {
        /* línea incompleta o ajena: se ignora */
      }
    }
  }
}

export async function streamFromProvider({ provider, apiKey, model, prompt, messages, json = false, maxTokens = MAX_TOKENS, temperature = TEMPERATURE, onDelta }) {
  let url;
  let headers;
  let body;
  if (provider === "gemini") {
    url = `${ENDPOINTS.gemini}/${model}:streamGenerateContent?alt=sse&key=${apiKey}`;
    headers = { "Content-Type": "application/json" };
    body = { contents: [{ parts: [{ text: prompt }] }], generationConfig: { temperature: TEMPERATURE, maxOutputTokens: 3000, thinkingConfig: { thinkingBudget: 1 } } };
  } else {
    url = ENDPOINTS[provider];
    headers = { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` };
    body = { model, messages: messages ?? [{ role: "user", content: prompt }], temperature, max_tokens: maxTokens, stream: true };
    if (json) body.response_format = { type: "json_object" };
    // Los modelos gpt-oss de Groq "piensan" antes de escribir; en esfuerzo bajo
    // responden en una fracción del tiempo y para estas consultas rinden igual.
    if (provider === "groq" && /gpt-oss/i.test(model)) body.reasoning_effort = "low";
    if (provider === "groq") body.stream_options = { include_usage: true };
  }

  let res;
  try {
    res = await fetch(url, { method: "POST", headers, body: JSON.stringify(body), signal: AbortSignal.timeout(STREAM_TIMEOUT_MS) });
  } catch (err) {
    throw new AppError("No se pudo conectar con el servicio de IA. Intenta de nuevo.", 500, { detail: describe(err) });
  }
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    await recordAiResponse({ provider, model, headers: res.headers, status: res.status, errorText: text });
    throw new AppError(`El servicio de IA devolvió un error (${res.status}). Intenta de nuevo en un momento.`, 500, { detail: text.slice(0, 300) });
  }

  let full = "";
  let tokens = 0;
  try {
    await readSse(res, (data) => {
      let piece = "";
      if (provider === "gemini") {
        piece = (data?.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? "").join("");
        tokens = data?.usageMetadata?.totalTokenCount ?? tokens;
      } else {
        piece = data?.choices?.[0]?.delta?.content ?? "";
        tokens = data?.usage?.total_tokens ?? data?.x_groq?.usage?.total_tokens ?? tokens;
      }
      if (piece) {
        full += piece;
        onDelta?.(piece);
      }
    });
  } catch (err) {
    throw new AppError("Se cortó la conexión con el servicio de IA.", 500, { detail: describe(err) });
  }
  await recordAiResponse({ provider, model, headers: res.headers, status: res.status, tokens });
  if (!full.trim()) throw new AppError("La IA no devolvió texto.", 500);
  return full.trim();
}

// Extrae, mientras llega el JSON del asistente, solo el texto del campo "final"
// ya decodificado, para escribirlo en vivo. Si la respuesta es un pedido de
// herramienta ({"tool":...}) no emite nada.
export function createFinalTextStreamer(onText, key = "final") {
  let buffer = "";
  let started = false;
  let finished = false;
  let pos = 0;
  let pendingEscape = "";
  const START = new RegExp(`"${key}"\\s*:\\s*"`);

  function decodeSlice(raw) {
    let out = "";
    let i = 0;
    const s = pendingEscape + raw;
    pendingEscape = "";
    while (i < s.length) {
      const ch = s[i];
      if (ch === "\\") {
        const next = s[i + 1];
        if (next === undefined) {
          pendingEscape = ch;
          break;
        }
        if (next === "u") {
          if (i + 6 > s.length) {
            pendingEscape = s.slice(i);
            break;
          }
          out += String.fromCharCode(parseInt(s.slice(i + 2, i + 6), 16) || 63);
          i += 6;
          continue;
        }
        out += next === "n" ? "\n" : next === "t" ? "\t" : next;
        i += 2;
        continue;
      }
      if (ch === '"') {
        finished = true;
        break;
      }
      out += ch;
      i++;
    }
    return out;
  }

  return {
    push(piece) {
      if (finished) return;
      buffer += piece;
      if (!started) {
        const m = START.exec(buffer);
        if (!m) return;
        started = true;
        pos = m.index + m[0].length;
      }
      const text = decodeSlice(buffer.slice(pos));
      pos = buffer.length;
      const clean = text.replace(/\*\*/g, "").replace(/\s*—\s*/g, ", ");
      if (clean) onText(clean);
    },
    get started() {
      return started;
    },
  };
}

// Respuesta de los chats de tienda y general: mismo objeto que devuelven
// chatWithGroq/chatWithNvidia, a partir del texto completo que llegó por streaming.
function extractJsonObject(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return raw;
  return raw.slice(start, end + 1);
}

export function parseChatJson(raw) {
  try {
    const p = JSON.parse(extractJsonObject(raw));
    const strings = (v) => (Array.isArray(v) ? v.filter((x) => typeof x === "string") : []);
    return {
      text: String(p.text ?? "").trim(),
      productIds: strings(p.productIds),
      addToCart: Array.isArray(p.addToCart) ? p.addToCart : [],
      removeFromCart: strings(p.removeFromCart),
      reduceCart: Array.isArray(p.reduceCart) ? p.reduceCart.filter((r) => r && typeof r === "object") : [],
      clearCart: p.clearCart === true,
      vendorIds: strings(p.vendorIds),
      showAllStoresButton: p.showAllStoresButton === true,
      suggestedFollowUps: strings(p.suggestedFollowUps),
    };
  } catch {
    return { text: raw, productIds: [], addToCart: [], removeFromCart: [], reduceCart: [], clearCart: false, vendorIds: [], showAllStoresButton: false, suggestedFollowUps: [] };
  }
}

// Mensajes en formato OpenAI para Groq/NVIDIA (mismo armado que buildGroqMessages).
export function buildChatMessages({ systemParts, history, message }) {
  const systemText = systemParts
    .filter((p) => typeof p.text === "string")
    .map((p) => p.text)
    .join("\n\n");
  return [
    { role: "system", content: `${systemText}\n\nResponde siempre en formato JSON, con el objeto exacto descripto arriba.` },
    ...history.map((m) => ({ role: m.role === "model" ? "assistant" : "user", content: m.content })),
    { role: "user", content: message },
  ];
}
