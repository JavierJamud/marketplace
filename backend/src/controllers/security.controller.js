import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { ACTION_LABELS, sendActionCode } from "../lib/adminActionCode.js";

// Bloque 272: códigos de confirmación y ajustes de seguridad del admin.

const requestSchema = z.object({ action: z.string(), target: z.string().trim().max(160).optional() });

export async function requestActionCode(req, res) {
  const { action, target } = requestSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.user.id } });
  if (!user) throw new AppError("Usuario no encontrado.", 404);
  const { expiresAt } = await sendActionCode(user, action, target || null);
  res.json({ ok: true, expiresAt, label: ACTION_LABELS[action], sentTo: user.email.replace(/^(.{2}).*(@.*)$/, "$1***$2") });
}

export async function getSecuritySettings(_req, res) {
  const settings = await prisma.siteSettings.findFirst({ select: { vendorDeletionDays: true, freeAssistantDailyLimit: true } });
  res.json({ settings: { vendorDeletionDays: settings?.vendorDeletionDays ?? 30, freeAssistantDailyLimit: settings?.freeAssistantDailyLimit ?? 5 } });
}

// Cada ajuste es opcional: la pantalla guarda de a uno. Bloque 276: tope diario del asistente de
// negocio para tiendas sin plan de pago (0 = no pueden usarlo).
const settingsSchema = z
  .object({
    vendorDeletionDays: z.number().int().min(1, "Mínimo 1 día.").max(365, "Máximo 365 días."),
    freeAssistantDailyLimit: z.number().int().min(0, "Mínimo 0 mensajes.").max(500, "Máximo 500 mensajes."),
  })
  .partial()
  .refine((d) => Object.keys(d).length > 0, "No hay nada que guardar.");

// Protegido por requireActionCode("CHANGE_SECURITY_SETTINGS") en la ruta.
export async function updateSecuritySettings(req, res) {
  const data = settingsSchema.parse(req.body);
  const existing = await prisma.siteSettings.findFirst({ select: { id: true } });
  if (existing) await prisma.siteSettings.update({ where: { id: existing.id }, data });
  else await prisma.siteSettings.create({ data });
  res.json({ settings: data });
}
