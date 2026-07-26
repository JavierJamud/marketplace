import { z } from "zod";
import { Resend } from "resend";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getIntegrationConfig } from "./integrations.controller.js";
import { getBrandSettings } from "./settings.controller.js";
import { emailShell } from "../templates/_shared.js";

const RESEND_SANDBOX_FROM = "onboarding@resend.dev";

export async function listCampaigns(_req, res) {
  const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ campaigns });
}

async function resolveRecipients(segment, provinceId) {
  if (segment === "all_customers") {
    const users = await prisma.user.findMany({
      where: { role: "CUSTOMER", isSuspended: false, provinceId: provinceId || undefined },
      select: { email: true },
    });
    return users.map((u) => u.email);
  }

  const planFilter = segment === "regular_vendors" ? "REGULAR" : segment === "business_vendors" ? "BUSINESS" : undefined;
  const vendors = await prisma.vendor.findMany({
    where: {
      isBlocked: false,
      planType: planFilter,
      locations: provinceId ? { some: { provinceId } } : undefined,
    },
    include: { user: { select: { email: true } } },
  });
  return vendors.map((v) => v.user.email);
}

const createCampaignSchema = z.object({
  subject: z.string().min(2),
  content: z.string().min(2),
  segment: z.enum(["all_customers", "all_vendors", "regular_vendors", "business_vendors"]),
  provinceId: z.string().optional(),
});

// Envío real vía Resend (sin mock). Si no hay integración activa, falla con
// un mensaje claro en vez de simular un envío exitoso.
export async function createCampaign(req, res) {
  const data = createCampaignSchema.parse(req.body);

  const config = await getIntegrationConfig("resend");
  if (!config) {
    throw new AppError("No hay una integración de Resend activa. Configurala en Integraciones antes de enviar campañas.", 400);
  }

  const recipients = await resolveRecipients(data.segment, data.provinceId);
  if (recipients.length === 0) {
    throw new AppError("No hay destinatarios para ese segmento/provincia.", 400);
  }

  const campaign = await prisma.campaign.create({
    data: {
      title: data.subject,
      subject: data.subject,
      content: data.content,
      segment: data.segment,
      provinceId: data.provinceId ?? null,
      status: "SENDING",
    },
  });

  try {
    const { siteName } = await getBrandSettings();
    const resend = new Resend(config.apiKey);
    const html = await emailShell({
      title: data.subject,
      storeName: siteName,
      bodyMjml: `<mj-text color="#44474c" font-size="14px" line-height="22px">${data.content.replace(/\n/g, "<br/>")}</mj-text>`,
    });
    // El SDK de Resend NUNCA lanza excepción por errores a nivel de API (ej.
    // API key inválida) — siempre resuelve { data, error }. Hay que chequear
    // "error" a mano o una key falsa quedaría registrada como "enviada".
    const result = await resend.emails.send({
      from: `${siteName} <${config.fromEmail || RESEND_SANDBOX_FROM}>`,
      to: recipients,
      subject: data.subject,
      html,
    });
    if (result.error) throw new Error(result.error.message ?? "Resend rechazó el envío.");

    const sent = await prisma.campaign.update({
      where: { id: campaign.id },
      data: { status: "SENT", sentCount: recipients.length, sentAt: new Date() },
    });
    res.status(201).json({ campaign: sent });
  } catch (err) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "DRAFT" } });
    throw new AppError(`No se pudo enviar la campaña: ${err.message}`, 502);
  }
}
