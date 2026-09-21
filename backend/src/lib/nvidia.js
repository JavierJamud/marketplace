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
// vacío/no configurado todavía.
//
// Bloque 193 (bug real reportado en vivo, con captura — "Probar conexión"
// tirando timeout con moonshotai/kimi-k3 pese a aparecer disponible en
// build.nvidia.com): verificado en vivo con la key real de este proyecto —
// 1) el meta/llama-3.3-70b-instruct que estaba acá como default resultó
// estar RETIRADO por NVIDIA (410 Gone, "reached its end of life on
// 2026-08-26") — exactamente la deriva que ya advertía el comentario
// anterior de este bloque. 2) kimi-k3 SÍ figura en GET /v1/models (la key
// tiene acceso), pero su endpoint de chat completions nunca respondió nada
// ni siquiera esperando 60s reales (no es "lento", no responde) — un
// modelo de ~2.8T parámetros recién publicado, probablemente sin
// capacidad real en el free tier todavía pese a estar listado en el
// catálogo. Reemplazado por nvidia/nemotron-3.5-lightning-30b-a3b — mismo
// key, probado en vivo: ~0.5-10s según el prompt, formato de respuesta
// compatible (content limpio, aunque es un modelo "de razonamiento": el
// pensamiento intermedio viaja en choices[0].message.reasoning_content,
// NUNCA en choices[0].message.content, así que el parseo existente de
// este archivo ya lo ignora solo, sin ningún cambio de código). Si vuelve
// a pasar esto con OTRO modelo: revisar primero con GET /v1/models si
// sigue en la lista y, si sigue, sospechar del endpoint gratuito en sí
// (no asumir que es un bug de este archivo) antes que nada.
export const DEFAULT_MODEL = "nvidia/nemotron-3.5-lightning-30b-a3b";
const API_BASE = "https://integrate.api.nvidia.com/v1/chat/completions";
const MODELS_API_BASE = "https://integrate.api.nvidia.com/v1/models";

// Bloque 83 (bug real medido en vivo): sin ningún timeout, un fetch a NVIDIA
// NIM colgado (medido una vez en 109 SEGUNDOS reales, contra esta misma
// cuenta) bloqueaba al cliente esperando una respuesta durante más de un
// minuto y medio — NVIDIA es a propósito el ÚLTIMO proveedor de la cadena de
// respaldo (ver ai.js), pero "último recurso lento" solo tiene sentido si
// tiene un techo razonable, nunca minutos. `AbortSignal.timeout()` corta la
// conexión sola pasado el plazo — ai.js lo trata como un fallo más de este
// proveedor (nunca rompe la cadena entera, solo lo salta).
const REQUEST_TIMEOUT_MS = 20_000;

// Bloque 90: ver la nota larga equivalente en gemini.js — antes este catch
// perdía el motivo real del fallo de red (timeout/DNS/etc.) detrás de un
// texto genérico; ahora el health check y el botón "Probar conexión" lo ven.
function describeFetchFailure(err) {
  if (err?.name === "TimeoutError" || err?.name === "AbortError") return "Se agotó el tiempo de espera (20s) sin respuesta.";
  return err?.message || "Error de red desconocido.";
}

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
        // Bloque 193 (verificado en vivo): con el modelo de razonamiento
        // que pasa a ser el default (ver DEFAULT_MODEL más arriba), el
        // "pensamiento" intermedio (reasoning_content, nunca visible en
        // `content`) sale del MISMO presupuesto de max_tokens — probado en
        // vivo con 900: un prompt real de oferta se cortó a mitad de
        // frase (finish_reason "length") porque el razonamiento se comió
        // la mayoría del margen. 2000 le da lugar de sobra a pensar Y
        // terminar la respuesta visible completa.
        max_tokens: 2000,
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError("No se pudo conectar con el servicio de IA. Intenta de nuevo.", 500, { detail: describeFetchFailure(err) });
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
        // Bloque 193: mismo motivo que generateWithNvidia — un modelo de
        // razonamiento gasta parte de este presupuesto "pensando" antes de
        // emitir el JSON final, 260 se quedaba corto para dejarle margen a
        // las dos cosas (probado en vivo, la respuesta de chat SÍ entra
        // completa con 800).
        max_tokens: 800,
        response_format: { type: "json_object" },
      }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (err) {
    throw new AppError("No se pudo conectar con el asistente. Prueba de nuevo.", 500, { detail: describeFetchFailure(err) });
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
// Bloque 100: mismo timeout defensivo que generateWithNvidia — sin esto, un
// cuelgue de red dejaba "Actualizar lista" (AdminIntegrations.jsx) girando
// para siempre sin ningún error visible.
export async function listNvidiaModels({ apiKey }) {
  let res;
  try {
    res = await fetch(MODELS_API_BASE, { headers: { Authorization: `Bearer ${apiKey}` }, signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS) });
  } catch (err) {
    throw new AppError("No se pudo conectar con NVIDIA NIM para listar modelos.", 500, { detail: describeFetchFailure(err) });
  }
  if (!res.ok) {
    const body = await res.text().catch(() => "");
    throw new AppError(`NVIDIA NIM devolvió un error (${res.status}) listando modelos.`, 500, { detail: body.slice(0, 300) });
  }
  const data = await res.json();
  return (data?.data ?? []).map((m) => m.id).sort();
}
