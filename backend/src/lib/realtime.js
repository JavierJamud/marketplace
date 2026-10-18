// Canal en vivo (Server-Sent Events): cada persona con sesión abierta mantiene una conexión y el servidor le avisa al instante de
// lo que cambia, sin que la pantalla tenga que preguntar cada pocos segundos. Los avisos son de dos clases:
//  - "refresh": algo cambió, las pantallas abiertas vuelven a pedir sus datos.
//  - "notify": un aviso para mostrar (título, texto y enlace).
// Vive en la memoria de este proceso: con varios procesos del servidor habría que pasarlo por Redis; hoy corre uno solo.

const MAX_CONNECTIONS_PER_USER = 6;
const HEARTBEAT_MS = 20_000;
const REFRESH_COALESCE_MS = 250;

const connections = new Map(); // userId -> Set<res>
const pendingRefresh = new Map(); // userId -> timer

export function connectedCount() {
  let n = 0;
  for (const set of connections.values()) n += set.size;
  return n;
}

export function isConnected(userId) {
  return (connections.get(userId)?.size ?? 0) > 0;
}

export function connectedUserIds() {
  return [...connections.keys()];
}

function write(res, event, data) {
  try {
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    return true;
  } catch {
    return false;
  }
}

// Abre la conexión de una persona. Devuelve nada: la respuesta queda abierta hasta que el navegador la cierre.
export function openStream(req, res, userId) {
  res.status(200).set({
    "Content-Type": "text/event-stream; charset=utf-8",
    "Cache-Control": "no-cache, no-transform",
    Connection: "keep-alive",
    // nginx no debe guardar la respuesta en memoria: cada aviso tiene que salir de inmediato.
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders?.();
  res.write("retry: 3000\n\n");

  let set = connections.get(userId);
  if (!set) connections.set(userId, (set = new Set()));
  // Con demasiadas pestañas abiertas se cierra la más antigua (casi siempre una que quedó colgada).
  while (set.size >= MAX_CONNECTIONS_PER_USER) {
    const oldest = set.values().next().value;
    set.delete(oldest);
    try {
      oldest.end();
    } catch {
      /* ya cerrada */
    }
  }
  set.add(res);
  write(res, "ready", { at: Date.now() });

  const beat = setInterval(() => {
    try {
      res.write(": ping\n\n");
    } catch {
      cleanup();
    }
  }, HEARTBEAT_MS);
  const cleanup = () => {
    clearInterval(beat);
    const s = connections.get(userId);
    if (s) {
      s.delete(res);
      if (s.size === 0) connections.delete(userId);
    }
  };
  req.on("close", cleanup);
  res.on("error", cleanup);
}

export function sendToUser(userId, event, data) {
  const set = connections.get(userId);
  if (!set) return 0;
  let sent = 0;
  for (const res of set) if (write(res, event, data)) sent++;
  return sent;
}

// "Algo cambió": se agrupan los avisos que llegan casi juntos (una venta con varios renglones) en uno solo.
export function refreshUsers(userIds, topic = "all") {
  for (const id of userIds) {
    if (!connections.has(id) || pendingRefresh.has(id)) continue;
    pendingRefresh.set(
      id,
      setTimeout(() => {
        pendingRefresh.delete(id);
        sendToUser(id, "refresh", { topic, at: Date.now() });
      }, REFRESH_COALESCE_MS)
    );
  }
}
