import { ZodError } from "zod";
import { AppError } from "../utils/AppError.js";
import { logError } from "../lib/errorLog.js";

// Bloque 33: a qué "origen" de Admin > Errores cae un 5xx que llega hasta
// ACÁ (no fue atrapado explícitamente por un controller más específico —
// chat.controller.js/assistant.controller.js ya atrapan y loggean sus
// propios fallos de bot con el origen correcto ANTES de responder, así que
// nunca llegan hasta este handler; esto es la red de seguridad para
// cualquier otra ruta, o un fallo inesperado que ese try/catch no haya
// anticipado). Basado en el path, no en el body — nunca hace falta
// modificar cada endpoint a mano para que quede clasificado razonablemente.
function inferOrigin(req) {
  const path = req.path;
  if (/^\/vendors\/[^/]+\/chat/.test(path)) return "BOT_TIENDA";
  if (path.startsWith("/assistant/chat")) return "BOT_GENERAL";
  if (path.startsWith("/ai/transcribe")) return "TRANSCRIPCION_AUDIO";
  if (path.startsWith("/stripe/webhook")) return "STRIPE";
  return "OTRO";
}

export function errorHandler(err, req, res, _next) {
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "Datos inválidos.", details: err.flatten() });
  }
  if (err instanceof AppError) {
    // Bloque 26: antes esta rama nunca loggeaba nada — un AppError con
    // detail de un proveedor externo (Gemini/Groq caído, key inválida,
    // etc.) llegaba al cliente pero se perdía del lado del servidor, sin
    // rastro para diagnosticar. 5xx = algo real falló (nuestro código o un
    // proveedor externo), vale la pena verlo en el log; 4xx (validación,
    // permisos, "no encontrado") son parte del uso normal de la API y no
    // hace falta ensuciar el log con cada uno.
    if (err.statusCode >= 500) {
      console.error(`[${req.method} ${req.originalUrl}] ${err.statusCode} ${err.message}`, err.details ?? "");
      // Bloque 33: mismo criterio — solo 5xx se registra en Admin > Errores,
      // nunca en la respuesta al cliente (eso lo sigue manejando la línea de
      // abajo, sin cambios).
      logError({
        origin: inferOrigin(req),
        message: err.message,
        context: { method: req.method, path: req.originalUrl, statusCode: err.statusCode, detail: err.details?.detail },
      });
    }
    return res.status(err.statusCode).json({ error: err.message, ...(err.details ? { details: err.details } : {}) });
  }
  console.error(`[${req.method} ${req.originalUrl}]`, err);
  logError({
    origin: inferOrigin(req),
    message: err instanceof Error ? err.message : String(err),
    context: { method: req.method, path: req.originalUrl, stack: err?.stack?.slice(0, 2000) },
  });
  res.status(500).json({ error: "Error interno del servidor." });
}
