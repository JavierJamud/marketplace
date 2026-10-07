import { api } from "./api.js";

// Pedido explícito: los chats de tienda y general escriben la respuesta EN VIVO.
// El servidor manda una línea JSON por evento (ver backend/src/lib/ndjsonStream.js):
//   delta  -> trozo de texto recién escrito
//   reset  -> lo escrito se descarta (se cambió de modelo)
//   done   -> el resultado final, con el mismo cuerpo que la respuesta normal
//   error  -> falló a mitad de camino
// Se usa axios (no fetch) para conservar la sesión y la renovación del token.
// Devuelve `{ data }` como api.post, y ante un error lanza algo con `response`.
export async function postChatStreaming(path, body, { onDelta, onReset } = {}) {
  let processed = 0;
  let final = null;
  const consume = (text, complete) => {
    const lines = text.split("\n");
    const upTo = complete ? lines.length : lines.length - 1;
    for (; processed < upTo; processed++) {
      const line = lines[processed].trim();
      if (!line) continue;
      let event;
      try {
        event = JSON.parse(line);
      } catch {
        continue;
      }
      if (event.type === "delta") onDelta?.(event.text);
      else if (event.type === "reset") onReset?.();
      else final = event;
    }
  };
  let res;
  try {
    res = await api.post(`${path}?stream=1`, body, {
      responseType: "text",
      transformResponse: [(data) => data],
      onDownloadProgress: (e) => consume(e.event?.target?.responseText ?? "", false),
    });
  } catch (err) {
    // Errores normales de la ruta (validación, límite de uso): el cuerpo viene como texto.
    if (typeof err.response?.data === "string") {
      try {
        err.response.data = JSON.parse(err.response.data);
      } catch {
        /* se deja como está */
      }
    }
    throw err;
  }
  const raw = typeof res.data === "string" ? res.data : "";
  // Sin streaming (la ruta respondió con un JSON normal de una sola vez).
  if (raw.trim().startsWith("{") && !raw.includes('"type":"done"') && !raw.includes('"type":"delta"') && !raw.includes('"type":"error"')) {
    try {
      return { data: JSON.parse(raw) };
    } catch {
      /* sigue abajo */
    }
  }
  consume(raw, true);
  if (!final || final.type === "error") {
    const err = new Error(final?.message ?? "Sin respuesta del asistente.");
    err.response = { status: 500, data: { error: final?.message } };
    throw err;
  }
  const { type, statusCode, ...data } = final;
  if (statusCode >= 400) {
    const err = new Error(data.error ?? "No se pudo obtener la respuesta.");
    err.response = { status: statusCode, data };
    throw err;
  }
  return { data };
}
