import { prisma } from "../lib/prisma.js";

// Reintentos seguros para lo que se hace sin conexión (lib/offlineQueue.js en el frontend). Si la petición trae la cabecera
// Idempotency-Key:
//  - la primera vez se procesa normal y se guarda la respuesta;
//  - si vuelve a llegar (la respuesta se perdió y el dispositivo reintenta) se devuelve la misma respuesta, sin repetir la venta;
//  - si llega mientras la primera aún se procesa, 409 y el dispositivo reintenta después.
// Solo se guarda una respuesta definitiva. Los 5xx (la operación no se hizo) y los rechazos que dependen del momento y no de la
// operación (sesión vencida, falta el código de confirmación, demasiadas peticiones) no se guardan: el reintento se procesa de verdad.
const KEY_RE = /^[A-Za-z0-9-]{16,64}$/;
const KEEP_MS = 7 * 24 * 60 * 60 * 1000;
let lastCleanup = 0;
const NOT_FINAL = new Set([401, 403, 408, 429]);
const isFinal = (status) => status < 500 && !NOT_FINAL.has(status);

export async function idempotency(req, res, next) {
  const key = req.get("idempotency-key");
  if (!key || req.method === "GET" || !KEY_RE.test(key)) return next();

  if (Date.now() - lastCleanup > 60 * 60 * 1000) {
    lastCleanup = Date.now();
    prisma.idempotentRequest.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - KEEP_MS) } } }).catch(() => {});
  }

  const path = req.originalUrl.split("?")[0].slice(0, 300);
  try {
    await prisma.idempotentRequest.create({ data: { key, method: req.method, path } });
  } catch {
    const prev = await prisma.idempotentRequest.findUnique({ where: { key } });
    if (!prev || prev.method !== req.method || prev.path !== path) return res.status(422).json({ error: "Clave de operación repetida." });
    if (prev.status == null) return res.status(409).json({ error: "Esta operación todavía se está procesando.", retry: true });
    res.set("Idempotent-Replay", "1");
    return res.status(prev.status).json(prev.body ?? {});
  }

  const json = res.json.bind(res);
  res.json = (body) => {
    const status = res.statusCode;
    const save = !isFinal(status)
      ? prisma.idempotentRequest.delete({ where: { key } })
      : prisma.idempotentRequest.update({ where: { key }, data: { status, body: body ?? {} } });
    save.catch(() => {});
    return json(body);
  };
  // Respuestas sin cuerpo JSON (204, errores de red a mitad): se libera la clave para que el reintento se procese.
  res.on("finish", () => {
    if (res.statusCode === 204) prisma.idempotentRequest.update({ where: { key }, data: { status: 204, body: {} } }).catch(() => {});
  });
  res.on("close", () => {
    if (!res.writableFinished) prisma.idempotentRequest.deleteMany({ where: { key, status: null } }).catch(() => {});
  });
  next();
}
