// Bloque 281 (pedido explícito — "que el chatbot no tenga que leer toda la
// conversación en cada mensaje; que tenga una memoria propia y gaste menos
// tokens"): en vez de mandarle a la IA los últimos N mensajes completos, se le
// manda solo lo más reciente tal cual y una MEMORIA corta del resto: una línea
// por intercambio anterior, recortada. La memoria se arma aquí mismo, sin otra
// llamada a la IA (resumir con IA gastaría justo los tokens que se quieren
// ahorrar), así que no cuesta nada.
//
// Archivo hoja (sin imports) para que lo usen el chat de las tiendas, el bot
// general y el asistente de negocio.

const clip = (text, max) => {
  const s = String(text ?? "").replace(/\s+/g, " ").trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
};

// rows: mensajes en orden cronológico ({ role: "user" | "model" | "assistant", content }).
// Devuelve { history, memory }: `history` son los últimos `keepRecent` mensajes
// (recortados a `recentChars`) y `memory` el texto de memoria del resto, o null.
export function compactHistory(rows, { keepRecent = 4, recentChars = 500, olderChars = 110, maxOlderLines = 12 } = {}) {
  const list = Array.isArray(rows) ? rows : [];
  const recent = list.slice(-keepRecent).map((m) => ({ ...m, content: clip(m.content, recentChars) }));
  const older = list.slice(0, Math.max(0, list.length - keepRecent)).slice(-maxOlderLines);
  if (older.length === 0) return { history: recent, memory: null };
  const lines = older.map((m) => `- ${m.role === "user" ? "Cliente" : "Tú"}: ${clip(m.content, olderChars)}`);
  const memory = `MEMORIA DE ESTA CONVERSACIÓN (resumen de lo hablado antes; úsalo solo como contexto):\n${lines.join("\n")}`;
  return { history: recent, memory };
}

// Cuántos mensajes leer de la base para armar historia + memoria.
export const MEMORY_FETCH_LIMIT = 16;
