import { z } from "zod";
import { AppError } from "../utils/AppError.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";
import { getPlanConfig, isPremiumActive } from "../lib/planConfig.js";
import { runAssistant, getHistory, clearHistory } from "../services/businessAssistant.service.js";

// Bloque 246 (pedido explícito — asistente de negocio con IA "solo para
// negocios verificados"): rutas del admin y del vendedor. El asistente solo
// LEE y recomienda (ver services/businessAssistant.service.js).

const messageSchema = z.object({ message: z.string().trim().min(1, "Escribe tu pregunta.").max(600, "La pregunta es muy larga (máximo 600 caracteres).") });

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

// --- Vendedor -------------------------------------------------------------

export async function getVendorAssistant(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
  const plan = await vendorPlanContext(vendor);
  const messages = await getHistory({ scope: "VENDOR", userId: req.user.id, vendorId: vendor.id });
  res.json({ access: { allowed: true, premium: plan.premium }, messages });
}

export async function askVendorAssistant(req, res) {
  const { message } = messageSchema.parse(req.body);
  const vendor = await resolveMyVendor(req.user.id);
  const planContext = await vendorPlanContext(vendor);
  const result = await runAssistant({ scope: "VENDOR", userId: req.user.id, vendorId: vendor.id, who: `el dueño del negocio "${vendor.companyName}"`, message, planContext });
  res.json(result);
}

export async function clearVendorAssistant(req, res) {
  const vendor = await resolveMyVendor(req.user.id);
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
