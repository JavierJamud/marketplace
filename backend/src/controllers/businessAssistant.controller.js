import { z } from "zod";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { getPlanConfig, isPremiumActive } from "../lib/planConfig.js";
import { runAssistant, getHistory, clearHistory } from "../services/businessAssistant.service.js";

// Bloque 246 (pedido explícito — asistente de negocio con IA "solo para
// negocios verificados"): rutas del admin y del vendedor. El asistente solo
// LEE y recomienda (ver services/businessAssistant.service.js).

const messageSchema = z.object({ message: z.string().trim().min(1, "Escribe tu pregunta.").max(600, "La pregunta es muy larga (máximo 600 caracteres).") });

// Quién puede usarlo (vendedor): el DUEÑO de una tienda verificada, con el
// plan de pago activo (verificación + plan, la misma doble condición del
// resto de funciones Premium) Y el interruptor del plan encendido. Un usuario
// de sistema (VENDOR_STAFF) no: son consejos sobre todo el negocio.
async function vendorAccess(vendor) {
  if (vendor.verificationStatus !== "VERIFIED") {
    return { allowed: false, reason: "NOT_VERIFIED", message: "El asistente está disponible solo para negocios verificados." };
  }
  if (!isPremiumActive(vendor)) {
    return { allowed: false, reason: "NO_PAID_PLAN", message: "El asistente forma parte del plan de pago de tu negocio." };
  }
  const config = await getPlanConfig(vendor.planType);
  if (!config?.allowAiAssistant) {
    return { allowed: false, reason: "PLAN_EXCLUDES", message: "Tu plan actual no incluye el asistente de negocio." };
  }
  return { allowed: true };
}

async function requireVendorAccess(req) {
  const vendor = await resolveMyVendor(req.user.id);
  const access = await vendorAccess(vendor);
  if (!access.allowed) throw new AppError(access.message, 403, { reason: access.reason });
  return vendor;
}

// --- Vendedor -------------------------------------------------------------

// Siempre responde 200 con `access`, para que la pantalla pueda explicar la
// ventaja del plan de pago en vez de mostrar un error.
export async function getVendorAssistant(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const access = await vendorAccess(vendor);
  const messages = access.allowed ? await getHistory({ scope: "VENDOR", userId: req.user.id, vendorId: vendor.id }) : [];
  res.json({ access, messages });
}

export async function askVendorAssistant(req, res) {
  const { message } = messageSchema.parse(req.body);
  const vendor = await requireVendorAccess(req);
  const result = await runAssistant({ scope: "VENDOR", userId: req.user.id, vendorId: vendor.id, who: `el dueño del negocio "${vendor.companyName}"`, message });
  res.json(result);
}

export async function clearVendorAssistant(req, res) {
  const vendor = await requireVendorAccess(req);
  await clearHistory({ scope: "VENDOR", userId: req.user.id, vendorId: vendor.id });
  res.json({ ok: true });
}

// --- Admin ------------------------------------------------------------------

export async function getAdminAssistant(req, res) {
  res.json({ access: { allowed: true }, messages: await getHistory({ scope: "ADMIN", userId: req.user.id }) });
}

export async function askAdminAssistant(req, res) {
  const { message } = messageSchema.parse(req.body);
  const result = await runAssistant({ scope: "ADMIN", userId: req.user.id, who: "la persona administradora de la plataforma", message });
  res.json(result);
}

export async function clearAdminAssistant(req, res) {
  await clearHistory({ scope: "ADMIN", userId: req.user.id });
  res.json({ ok: true });
}
