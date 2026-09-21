import { ZodError } from "zod";
import { AppError } from "../utils/AppError.js";
import { logError } from "../lib/errorLog.js";

// Pedido explícito: el toast de "Datos inválidos." no decía a qué dato se
// refería — pasaba en CUALQUIER endpoint (registro, login, crear producto,
// reportar fraude, etc.), porque errorHandler.js es el único lugar que
// arma la respuesta cuando falla un z.object().parse(...). En vez de tocar
// mensaje por mensaje en cada controller, se arregla acá una sola vez: se
// arma un mensaje específico por campo a partir de zodError.errors (no de
// .flatten(), que ya perdió el detalle de cada issue).
//
// Los schemas que SÍ definen un mensaje propio (ej. phone en
// auth.controller.js: "El teléfono debe incluir código de país...") ya
// vienen en español y se usan tal cual — nunca se pisan. Solo se traduce
// cuando el mensaje es el default en inglés de zod (detectado por patrón,
// ver isRawZodDefault), que es lo que generaba mensajes como "Invalid
// email" o "String must contain at least 8 character(s)" en la respuesta.
const FIELD_LABELS = {
  email: "Correo", password: "Contraseña", fullName: "Nombre completo", phone: "Teléfono",
  name: "Nombre", description: "Descripción", price: "Precio", message: "Mensaje",
  code: "Código", country: "País", address: "Dirección", currency: "Moneda",
  quantity: "Cantidad", comment: "Comentario", rating: "Calificación", reason: "Motivo",
  title: "Título", newEmail: "Correo nuevo", currentPassword: "Contraseña actual",
  resolutionNote: "Nota", evidenceMessage: "Mensaje de evidencia", screenshotUrl: "Captura",
  productId: "Producto", vendorId: "Tienda", customerListingId: "Anuncio de venta rápida",
  companyName: "Nombre de la empresa", whatsapp: "WhatsApp", slug: "Enlace", stock: "Stock",
  images: "Imágenes", tags: "Etiquetas", oldPrice: "Precio anterior", categoryId: "Categoría",
  provinceId: "Provincia", municipalityId: "Municipio", browserId: "Dispositivo",
};

function humanizeField(path) {
  const last = [...path].reverse().find((p) => typeof p === "string");
  if (!last) return "Este dato";
  if (FIELD_LABELS[last]) return FIELD_LABELS[last];
  const spaced = last.replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/_/g, " ").toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

const RAW_ZOD_DEFAULTS = [
  /^Invalid email$/,
  /^Required$/,
  /^String must contain at least \d+ character\(s\)$/,
  /^String must contain at most \d+ character\(s\)$/,
  /^String must contain exactly \d+ character\(s\)$/,
  /^Number must be (greater|less) than( or equal to)? .+$/,
  /^Array must contain at (least|most) \d+ element\(s\)$/,
  /^Invalid enum value\./,
  /^Expected \w+, received \w+$/,
  /^Invalid$/,
];

function isRawZodDefault(message) {
  return RAW_ZOD_DEFAULTS.some((re) => re.test(message));
}

function translateIssue(issue) {
  // Mensaje propio del schema (ej. "Contanos qué pasó (mínimo 10
  // caracteres).") — ya es específico y está en español, se usa tal cual.
  if (!isRawZodDefault(issue.message)) return issue.message;

  // "{label}: campo obligatorio." en vez de "{label} es obligatorio." a
  // propósito — con un label arbitrario (Contraseña, Teléfono, Nombre...)
  // "es obligatorio/a" necesita concordancia de género que no se puede
  // resolver en genérico; ":  campo obligatorio." queda correcto siempre.
  const label = humanizeField(issue.path);
  switch (issue.code) {
    case "invalid_type":
      return issue.received === "undefined" ? `${label}: campo obligatorio.` : `${label}: formato inválido.`;
    case "too_small":
      if (issue.type === "string") {
        if (issue.exact) return `${label} debe tener exactamente ${issue.minimum} caracteres.`;
        return issue.minimum <= 1 ? `${label}: campo obligatorio.` : `${label} debe tener al menos ${issue.minimum} caracteres.`;
      }
      if (issue.type === "number") return `${label} debe ser mayor o igual a ${issue.minimum}.`;
      if (issue.type === "array") return `${label}: selecciona al menos ${issue.minimum}.`;
      return `${label}: falta contenido.`;
    case "too_big":
      if (issue.type === "string") {
        if (issue.exact) return `${label} debe tener exactamente ${issue.maximum} caracteres.`;
        return `${label} no puede tener más de ${issue.maximum} caracteres.`;
      }
      if (issue.type === "number") return `${label} debe ser menor o igual a ${issue.maximum}.`;
      if (issue.type === "array") return `${label}: como máximo ${issue.maximum}.`;
      return `${label}: contenido demasiado extenso.`;
    case "invalid_string":
      if (issue.validation === "email") return `${label}: el formato de correo no es válido.`;
      return `${label}: formato inválido.`;
    case "invalid_enum_value":
      return `${label}: valor no permitido.`;
    default:
      return `${label}: dato inválido.`;
  }
}

// Junta todos los campos con problemas en un solo mensaje legible — si es
// uno solo, va directo ("Correo: el formato de correo no es válido.");
// si son varios, se listan todos para que quede clarísimo cuáles corregir
// en vez de un "Datos inválidos." genérico que no dice nada.
function formatZodError(zodError) {
  const messages = [...new Set(zodError.errors.map(translateIssue))];
  if (messages.length === 0) return "Datos inválidos.";
  if (messages.length === 1) return messages[0];
  return `Revisa estos datos — ${messages.join(" ")}`;
}

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
    return res.status(400).json({ error: formatZodError(err), details: err.flatten() });
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
