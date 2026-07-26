import { AppError } from "../utils/AppError.js";

// Bloque 45: reemplaza a Cerebras (sacado del sistema — su cuenta gratuita
// devolvía 402 Payment Required para gpt-oss-120b, no sirve para uso
// gratuito). NVIDIA NIM (build.nvidia.com) — misma interfaz pública que
// groq.js/gemini.js (generateWithNvidia/chatWithNvidia), para que ai.js
// pueda despachar sin que a los controllers les importe cuál corrió. API
// compatible con OpenAI (chat completions), mismo patrón de
// mensajes/parseo que groq.js.
//
// El nombre del modelo NO es fijo — ai.js lo resuelve desde
// SiteSettings.aiModelNvidia (editable en AdminIntegrations.jsx) y lo pasa
// como parámetro; DEFAULT_MODEL es el fallback si ese setting está
// vacío/no configurado todavía. meta/llama-3.3-70b-instruct es el "Free
// Endpoint" de Meta en NVIDIA NIM al momento de este bloque — si NVIDIA lo
// deprecia/retira, verificar el nombre real vigente en build.nvidia.com
// antes de asumir que es un bug de este archivo (mismo tipo de deriva ya
// visto con Groq y con el alias de Gemini).
export const DEFAULT_MODEL = "meta/llama-3.3-70b-instruct";
const API_BASE = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODELS_API_BASE = "https://integrate.api.nvidia.com/v1/models";

export async function generateWithNvidia({ apiKey, prompt, model }) {
  let res;
  try {
    res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages: [{ role: "user", content: prompt }],
        temperature: 0.8,
        // Bloque 49: ver nota igual en groq.js — el prompt de warranty pide
        // 5 cláusulas numeradas, 400 lo cortaba a mitad de la primera.
        max_tokens: 900,
      }),
    });
  } catch {
    throw new AppError("No se pudo conectar con el servicio de IA. Intenta de nuevo.", 500);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`El servicio de IA devolvió un error (${res.status}). Intenta de nuevo en un momento.`, 500, { detail: body.slice(0, 300) });
  }

  const data = await res.json();
  const text = data?.choices?.[0]?.message?.content?.trim();
  if (!text) throw new AppError("La IA no devolvió una descripción. Intenta con un texto más específico.", 500);

  return text;
}

// systemParts llega en formato Gemini ({text}/{inlineData}, ver
// chat.controller.js) — igual que Groq, NVIDIA NIM no lee documentos
// adjuntos nativos, así que acá se concatenan solo las partes de texto en
// un único mensaje "system" y la parte {inlineData} (el PDF del vendedor)
// se descarta en silencio (mismo criterio/degradación aceptada que groq.js).
function buildNvidiaMessages({ systemParts, history, message }) {
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

// Bloque 42 (bug real reportado en vivo — probando deepseek-ai/deepseek-v4-flash
// como modelo alternativo de NVIDIA NIM): "response_format: json_object" no
// es garantía de que el modelo arranque la respuesta CON el JSON — este
// modelo puntual devolvió texto suelto pegado antes ("We{...}"), lo que
// rompía JSON.parse y mostraba el JSON crudo como si fuera la respuesta del
// bot. Nunca confiar en que el modelo respeta el formato al 100% (mismo
// criterio anti-alucinación de todo este proyecto): se extrae el objeto
// JSON real (desde el primer "{" hasta el último "}") antes de parsear, sin
// importar qué texto haya alrededor.
function extractJsonObject(raw) {
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return raw;
  return raw.slice(start, end + 1);
}

export async function chatWithNvidia({ apiKey, systemParts, history, message, model }) {
  const messages = buildNvidiaMessages({ systemParts, history, message });

  let res;
  try {
    res = await fetch(API_BASE, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: model || DEFAULT_MODEL,
        messages,
        temperature: 0.2,
        max_tokens: 260,
        response_format: { type: "json_object" },
      }),
    });
  } catch {
    throw new AppError("No se pudo conectar con el asistente. Prueba de nuevo.", 500);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`El asistente no pudo responder (${res.status}). Prueba de nuevo en un momento.`, 500, { detail: body.slice(0, 300) });
  }

  const data = await res.json();
  const raw = data?.choices?.[0]?.message?.content?.trim();
  if (!raw) throw new AppError("El asistente no devolvió una respuesta. Prueba reformular tu pregunta.", 500);

  try {
    const parsed = JSON.parse(extractJsonObject(raw));
    return {
      text: String(parsed.text ?? "").trim(),
      productIds: Array.isArray(parsed.productIds) ? parsed.productIds.filter((id) => typeof id === "string") : [],
      addToCart: Array.isArray(parsed.addToCart) ? parsed.addToCart : [],
      removeFromCart: Array.isArray(parsed.removeFromCart) ? parsed.removeFromCart.filter((id) => typeof id === "string") : [],
      clearCart: parsed.clearCart === true,
      vendorIds: Array.isArray(parsed.vendorIds) ? parsed.vendorIds.filter((id) => typeof id === "string") : [],
      showAllStoresButton: parsed.showAllStoresButton === true,
      suggestedFollowUps: Array.isArray(parsed.suggestedFollowUps) ? parsed.suggestedFollowUps.filter((s) => typeof s === "string") : [],
    };
  } catch {
    return { text: raw, productIds: [], addToCart: [], removeFromCart: [], clearCart: false, vendorIds: [], showAllStoresButton: false, suggestedFollowUps: [] };
  }
}

// Bloque 45 (pedido explícito): lista los modelos REALES que esta key de
// NVIDIA NIM puede usar — misma forma OpenAI-compatible que Groq/Cerebras
// (no verificado en vivo por falta de key real; si NVIDIA usa una forma
// distinta, este endpoint es el primer lugar a revisar). AdminIntegrations.jsx
// los muestra como lista seleccionable en vez de un input de texto libre.
export async function listNvidiaModels({ apiKey }) {
  let res;
  try {
    res = await fetch(MODELS_API_BASE, { headers: { Authorization: `Bearer ${apiKey}` } });
  } catch {
    throw new AppError("No se pudo conectar con NVIDIA NIM para listar modelos.", 500);
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`NVIDIA NIM devolvió un error (${res.status}) listando modelos.`, 500, { detail: body.slice(0, 300) });
  }
  const data = await res.json();
  return (data?.data ?? []).map((m) => m.id).sort();
}
