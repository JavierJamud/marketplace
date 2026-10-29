import { prisma } from "./prisma.js";
import { captureOrderRequest } from "./orderRequestInfo.js";
import { describeUserAgent } from "./userAgent.js";

// Registro de todo lo que hace un administrador (pedido del dueño, 2026-10-29: "todos los movimientos y acciones deben
// quedar registrados: dónde, en qué sección, por qué, a qué hora"). Va en el router del admin: cada cambio que termina bien
// (POST, PATCH, PUT, DELETE con respuesta 2xx) deja una fila en ActivityLog con quién, sección, qué se hizo, sobre qué,
// el motivo si lo escribió, la IP y el dispositivo. Si la acción ya escribió su propio registro (logActivity con más
// detalle), no se duplica: se le agregan estos datos a ese mismo registro.
//
// Nunca se guardan valores de contraseñas, claves, tokens ni códigos: de lo enviado solo quedan los nombres de los campos
// que se cambiaron y los textos de motivo.

const SECTIONS = {
  customers: "Clientes",
  vendors: "Tiendas",
  "vendor-staff": "Tiendas · equipo",
  "vendor-staff-sales": "Tiendas · ventas del equipo",
  "change-requests": "Tiendas · cambios solicitados",
  verifications: "Verificaciones",
  "verification-archive": "Verificaciones · archivo",
  "subscription-payments": "Suscripciones · pagos",
  plans: "Planes",
  "plan-configs": "Planes",
  "plan-features": "Planes · funciones",
  orders: "Pedidos",
  products: "Productos",
  "customer-listings": "Ventas rápidas",
  reports: "Reportes de fraude",
  moderation: "Moderación",
  blacklist: "Lista negra",
  reviews: "Comentarios",
  "ranking-anomalies": "Anomalías de ranking",
  offers: "Ofertas",
  "store-offers": "Ofertas de tienda",
  "targeted-offers": "Ofertas dirigidas",
  "discount-codes": "Códigos de descuento",
  campaigns: "Campañas",
  announcements: "Anuncios",
  emails: "Correos",
  messages: "Mensajes",
  "support-tickets": "Casos de soporte",
  "support-cases": "Casos de soporte",
  suggestions: "Sugerencias",
  partners: "Socios API",
  "partner-applications": "Socios API · solicitudes",
  integrations: "Integraciones",
  "ai-models": "Integraciones · modelos de IA",
  "business-assistant": "Asistente de negocio",
  "chat-review": "Asistente · entrenamiento",
  settings: "Configuración",
  security: "Seguridad",
  locations: "Ubicaciones",
  "location-suggestions": "Ubicaciones · solicitudes",
  catalog: "Catálogo",
  "business-categories": "Categorías de negocio",
  "product-categories": "Categorías de producto",
  "static-pages": "Páginas",
  faq: "Preguntas frecuentes",
  errors: "Errores",
  usage: "Uso de la plataforma",
};

const VERB = { POST: "Creó o ejecutó", PATCH: "Modificó", PUT: "Modificó", DELETE: "Eliminó" };
// Campos cuyo valor nunca se guarda (solo su nombre).
const SECRET = /pass|secret|token|key|code|otp|totp|hash|card|cvv|iban/i;
// Campos de texto que explican el porqué: se guardan tal cual (recortados).
const REASON = /^(reason|blacklistReason|note|notes|motivo|message|comment|resolution|rejectionReason|blockReason)$/;

function describeBody(body) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return { fields: [], reason: null };
  const fields = [];
  let reason = null;
  for (const [k, v] of Object.entries(body)) {
    if (k === "clientInfo" || k === "actionCode") continue;
    fields.push(k);
    if (!reason && REASON.test(k) && !SECRET.test(k) && typeof v === "string" && v.trim()) reason = v.trim().slice(0, 500);
  }
  return { fields: fields.slice(0, 30), reason };
}

export function adminAudit(req, res, next) {
  if (!["POST", "PATCH", "PUT", "DELETE"].includes(req.method)) return next();
  const startedAt = new Date();
  res.on("finish", () => {
    if (res.statusCode >= 400 || !req.user?.id) return;
    // Pedir el código de confirmación no es la acción todavía: la acción se registra cuando se confirma.
    if (/\/action-codes?\b/.test(req.originalUrl)) return;
    record(req, res, startedAt).catch(() => {});
  });
  next();
}

async function record(req, res, startedAt) {
  const path = String(req.originalUrl ?? "").split("?")[0].replace(/^\/(api\/)?admin\/?/, "");
  const parts = path.split("/").filter(Boolean);
  const section = SECTIONS[parts[0]] ?? parts[0] ?? "Panel";
  // El primer segmento con forma de id es el objeto sobre el que se actuó.
  const targetId = parts.find((p, i) => i > 0 && /^[a-z0-9]{20,}$/i.test(p)) ?? null;
  const ctx = captureOrderRequest(req, req.body?.clientInfo);
  const device = ctx?.userAgent ? describeUserAgent(ctx.userAgent) : null;
  const { fields, reason } = describeBody(req.body);
  const target = targetId ? await targetLabel(targetId) : null;
  const audit = {
    section,
    target,
    method: req.method,
    path: `/admin/${path}`.slice(0, 300),
    targetId,
    fields,
    reason,
    status: res.statusCode,
    ip: ctx?.ip ?? null,
    device: device ? `${device.browser} en ${device.os}, ${device.device}` : null,
    userAgent: ctx?.userAgent ?? null,
    at: new Date().toISOString(),
  };

  // ¿La acción ya dejó su propio registro durante esta misma petición? Se completa ese en vez de crear otro.
  const own = await prisma.activityLog.findFirst({
    where: { actorId: req.user.id, actorRole: "ADMIN", createdAt: { gte: startedAt } },
    orderBy: { createdAt: "desc" },
  });
  if (own) {
    const meta = own.meta && typeof own.meta === "object" && !Array.isArray(own.meta) ? own.meta : { value: own.meta };
    await prisma.activityLog.update({ where: { id: own.id }, data: { meta: { ...meta, audit } } });
    return;
  }
  const what = [target, parts.slice(1).filter((p) => p !== targetId).join(" / ")].filter(Boolean).join(" · ");
  await prisma.activityLog.create({
    data: {
      actorId: req.user.id,
      actorRole: "ADMIN",
      vendorId: parts[0] === "vendors" && targetId ? await vendorIdIfExists(targetId) : null,
      action: `ADMIN_${req.method}`,
      description: `${section}: ${VERB[req.method] ?? req.method}${what ? ` (${what})` : ""}${reason ? `. Motivo: ${reason}` : ""}`.slice(0, 500),
      meta: { audit },
    },
  });
}

// Nombre legible de lo que se tocó: una cuenta, una tienda o un producto.
async function targetLabel(id) {
  const [user, vendor, product] = await Promise.all([
    prisma.user.findUnique({ where: { id }, select: { fullName: true, email: true, deletedEmail: true } }),
    prisma.vendor.findUnique({ where: { id }, select: { companyName: true } }),
    prisma.product.findUnique({ where: { id }, select: { name: true } }),
  ]);
  if (user) return [user.fullName, user.deletedEmail ?? user.email].filter(Boolean).join(", ");
  return vendor?.companyName ?? product?.name ?? null;
}

async function vendorIdIfExists(id) {
  const v = await prisma.vendor.findUnique({ where: { id }, select: { id: true } });
  return v?.id ?? null;
}
