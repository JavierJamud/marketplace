import { z } from "zod";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { getPlanConfig, isPremiumActive } from "../lib/planConfig.js";
import { prisma } from "../lib/prisma.js";
import { startOfDayInTimezone } from "../lib/timezone.js";
import { runAssistant, listConversations, getConversation, deleteConversation, clearHistory } from "../services/businessAssistant.service.js";

// Bloque 246 (pedido explícito — asistente de negocio con IA): rutas del admin y
// del vendedor. El asistente solo LEE y recomienda (ver
// services/businessAssistant.service.js).
//
// Bloque 260: varias conversaciones por persona. El id de conversación llega del
// cliente, así que el servicio siempre lo comprueba contra el dueño de la sesión.

const messageSchema = z.object({
  message: z.string().trim().min(1, "Escribe tu pregunta.").max(600, "La pregunta es muy larga (máximo 600 caracteres)."),
  conversationId: z.string().trim().min(1).max(64).optional(),
});

// Quién puede usarlo (vendedor): el DUEÑO de cualquier tienda, tenga o no plan
// de pago (un usuario de sistema, VENDOR_STAFF, no: son consejos sobre todo el
// negocio). Bloque 259 (pedido explícito — "también en las tiendas sin
// suscripción, para sugerirles cambios y recomendarles obtener la
// suscripción"): antes solo lo usaban las tiendas verificadas con plan de pago.
// Lo que cambia con el plan es lo que el asistente cuenta: una tienda con plan
// activo recibe solo consejos; una sin plan o sin verificar recibe además la
// recomendación honesta de suscribirse, con los beneficios reales del plan.
async function vendorPlanContext(vendor) {
  const premium = isPremiumActive(vendor);
  const config = await getPlanConfig("BUSINESS");
  return {
    premium,
    verificationStatus: vendor.verificationStatus,
    planType: vendor.planType,
    planName: config?.displayName ?? "Premium",
    planFeatures: (config?.features ?? []).slice(0, 8),
  };
}

// Bloque 276 (pedido explícito — "las tiendas gratis tendrán un límite de 5 mensajes por día, que el
// admin puede configurar; al agotarlo se les avisa que se suscriban o esperen al día siguiente"):
// cuota diaria del asistente para tiendas SIN plan de pago activo. Cuenta los mensajes de la
// persona desde la medianoche en la zona horaria de la plataforma. Con plan activo no hay tope.
async function freeQuota(owner) {
  if (owner.scope !== "VENDOR" || owner.planContext?.premium) return null;
  const settings = await prisma.siteSettings.findFirst({ select: { freeAssistantDailyLimit: true, timezone: true } });
  const limit = settings?.freeAssistantDailyLimit ?? 5;
  const dayStart = startOfDayInTimezone(new Date(), settings?.timezone || "America/Havana");
  const used = await prisma.assistantMessage.count({ where: { scope: "VENDOR", vendorId: owner.vendorId, role: "user", createdAt: { gte: dayStart } } });
  return { limit, used, remaining: Math.max(0, limit - used), resetsAt: new Date(dayStart.getTime() + 24 * 60 * 60 * 1000).toISOString() };
}

// Las mismas cinco rutas para los dos ámbitos: lo único que cambia es quién es
// la persona (`resolveOwner`) y qué se le cuenta extra al abrir el chat.
function makeHandlers({ scope, resolveOwner }) {
  return {
    // Abre el chat: lista de conversaciones y la más reciente ya cargada.
    async get(req, res) {
      const owner = await resolveOwner(req);
      const conversations = await listConversations(owner);
      const active = conversations[0] ? await getConversation({ ...owner, conversationId: conversations[0].id }) : null;
      res.json({ access: { ...owner.access, quota: await freeQuota(owner) }, conversations, active });
    },
    async open(req, res) {
      const owner = await resolveOwner(req);
      const conversation = await getConversation({ ...owner, conversationId: String(req.params.id) });
      if (!conversation) throw new AppError("No encontré esa conversación.", 404);
      res.json({ conversation });
    },
    async ask(req, res) {
      const { message, conversationId } = messageSchema.parse(req.body);
      const owner = await resolveOwner(req);
      const quota = await freeQuota(owner);
      if (quota && quota.remaining <= 0) {
        res.status(429).json({
          error: `Usaste tus ${quota.limit} mensajes de hoy. Para seguir administrando tu negocio con el asistente, suscríbete al plan de pago; si no, vuelve mañana y tu cuota se restablece.`,
          code: "ASSISTANT_QUOTA",
          quota,
        });
        return;
      }
      const run = (onProgress) => runAssistant({ scope, userId: owner.userId, vendorId: owner.vendorId, who: owner.who, message, planContext: owner.planContext, conversationId, onProgress });

      const after = quota ? { quota: { ...quota, used: quota.used + 1, remaining: quota.remaining - 1 } } : {};
      if (req.query.stream !== "1") {
        res.json({ ...(await run()), ...after });
        return;
      }
      // Bloque 262 (pedido explícito — "animación de pensando, qué sección o qué
      // datos está consultando y el tiempo que va demorando"): una línea JSON por
      // evento. Las validaciones de arriba ya respondieron con error normal; desde
      // aquí todo, incluso un error, viaja como evento para que el chat lo muestre.
      res.status(200);
      res.setHeader("Content-Type", "application/x-ndjson; charset=utf-8");
      res.setHeader("Cache-Control", "no-cache, no-transform");
      res.setHeader("X-Accel-Buffering", "no");
      res.flushHeaders?.();
      const send = (event) => res.write(`${JSON.stringify(event)}\n`);
      try {
        const result = await run((progress) => send({ type: "progress", ...progress }));
        send({ type: "done", ...result, ...after });
      } catch (err) {
        if (!(err instanceof AppError)) console.error("[businessAssistant] error:", err);
        send({ type: "error", status: err?.statusCode ?? 500, message: err instanceof AppError ? err.message : "No se pudo obtener la respuesta. Prueba de nuevo." });
      }
      res.end();
    },
    async remove(req, res) {
      const owner = await resolveOwner(req);
      const done = await deleteConversation({ ...owner, conversationId: String(req.params.id) });
      if (!done) throw new AppError("No encontré esa conversación.", 404);
      res.json({ ok: true });
    },
    async clear(req, res) {
      const owner = await resolveOwner(req);
      await clearHistory(owner);
      res.json({ ok: true });
    },
  };
}

const vendorHandlers = makeHandlers({
  scope: "VENDOR",
  async resolveOwner(req) {
    const vendor = await resolveMyVendor(req.user.id);
    const planContext = await vendorPlanContext(vendor);
    return { scope: "VENDOR", userId: req.user.id, vendorId: vendor.id, who: `el dueño del negocio "${vendor.companyName}"`, planContext, access: { allowed: true, premium: planContext.premium } };
  },
});

const adminHandlers = makeHandlers({
  scope: "ADMIN",
  async resolveOwner(req) {
    return { scope: "ADMIN", userId: req.user.id, vendorId: null, who: "la persona administradora de la plataforma", planContext: null, access: { allowed: true } };
  },
});

export const getVendorAssistant = vendorHandlers.get;
export const openVendorConversation = vendorHandlers.open;
export const askVendorAssistant = vendorHandlers.ask;
export const deleteVendorConversation = vendorHandlers.remove;
export const clearVendorAssistant = vendorHandlers.clear;

export const getAdminAssistant = adminHandlers.get;
export const openAdminConversation = adminHandlers.open;
export const askAdminAssistant = adminHandlers.ask;
export const deleteAdminConversation = adminHandlers.remove;
export const clearAdminAssistant = adminHandlers.clear;
