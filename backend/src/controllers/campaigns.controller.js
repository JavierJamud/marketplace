import { z } from "zod";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Resend } from "resend";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getIntegrationConfig } from "./integrations.controller.js";
import { getBrandSettings, SITE_UPLOAD_DIR } from "./settings.controller.js";
import { emailShell, ctaButton, resolveAssetUrl } from "../templates/_shared.js";

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
      status: "ACTIVE",
      planType: planFilter,
      locations: provinceId ? { some: { provinceId } } : undefined,
    },
    include: { user: { select: { email: true } } },
  });
  return vendors.map((v) => v.user.email);
}

// Mismo criterio que assertImageLinkAllowed en storeOffers.controller.js —
// apagable desde el admin (SiteSettings.allowProductImageLinks).
async function assertImageLinkAllowed() {
  const settings = await prisma.siteSettings.findFirst();
  if (settings && settings.allowProductImageLinks === false) {
    throw new AppError("El administrador desactivó agregar imágenes por link. Sube un archivo en su lugar.", 403);
  }
}

function deleteLocalCampaignImage(imageUrl) {
  if (!imageUrl || /^https?:\/\//.test(imageUrl)) return Promise.resolve();
  return unlink(join(SITE_UPLOAD_DIR, imageUrl.replace(/^\/uploads\/site\//, ""))).catch(() => {});
}

// Bloque 67 (pedido explícito): imagen banner opcional (archivo o link
// externo) + botón de llamado a la acción opcional (label+url van siempre
// juntos) — "más personalización" del correo, más allá de solo asunto/texto.
const campaignContentSchema = z.object({
  subject: z.string().trim().min(2),
  content: z.string().trim().min(2),
  segment: z.enum(["all_customers", "all_vendors", "regular_vendors", "business_vendors"]),
  provinceId: z.string().optional(),
  imageUrl: z.string().trim().optional(),
  ctaLabel: z.string().trim().max(40).optional(),
  ctaUrl: z.string().trim().optional(),
});

function assertCtaComplete(ctaLabel, ctaUrl) {
  if (!!ctaLabel !== !!ctaUrl) {
    throw new AppError("El botón necesita tanto un texto como un link — completa los dos o ninguno.", 400);
  }
}

// Único punto de envío real — reusado por createCampaign (primer envío) y
// resendCampaign (reenvío, mismo contenido guardado). Nunca simula un envío
// exitoso: si Resend rechaza, tira y el llamador revierte el status.
async function dispatchCampaignEmail(campaign) {
  const config = await getIntegrationConfig("resend");
  if (!config) {
    throw new AppError("No hay una integración de Resend activa. Configúrala en Integraciones antes de enviar campañas.", 400);
  }

  const recipients = await resolveRecipients(campaign.segment, campaign.provinceId);
  if (recipients.length === 0) {
    throw new AppError("No hay destinatarios para ese segmento/provincia.", 400);
  }

  const { siteName } = await getBrandSettings();
  const resend = new Resend(config.apiKey);
  const imgSrc = resolveAssetUrl(campaign.imageUrl);
  const html = await emailShell({
    title: campaign.subject,
    storeName: siteName,
    bodyMjml: `
      ${imgSrc ? `<mj-image src="${imgSrc}" alt="${campaign.subject}" border-radius="12px" padding="0 0 16px" />` : ""}
      <mj-text color="#44474c" font-size="14px" line-height="22px">${campaign.content.replace(/\n/g, "<br/>")}</mj-text>
      ${campaign.ctaLabel && campaign.ctaUrl ? ctaButton(campaign.ctaLabel, campaign.ctaUrl) : ""}
    `,
  });
  // El SDK de Resend NUNCA lanza excepción por errores a nivel de API (ej.
  // API key inválida) — siempre resuelve { data, error }. Hay que chequear
  // "error" a mano o una key falsa quedaría registrada como "enviada".
  const result = await resend.emails.send({
    from: `${siteName} <${config.fromEmail || RESEND_SANDBOX_FROM}>`,
    to: recipients,
    subject: campaign.subject,
    html,
  });
  if (result.error) throw new Error(result.error.message ?? "Resend rechazó el envío.");
  return recipients.length;
}

// Envío real vía Resend (sin mock). Si no hay integración activa, falla con
// un mensaje claro en vez de simular un envío exitoso.
export async function createCampaign(req, res) {
  const data = campaignContentSchema.parse(req.body);
  const ctaLabel = data.ctaLabel || null;
  const ctaUrl = data.ctaUrl || null;
  assertCtaComplete(ctaLabel, ctaUrl);

  let imageUrl = null;
  if (req.file) {
    imageUrl = `/uploads/site/${req.file.filename}`;
  } else if (data.imageUrl) {
    await assertImageLinkAllowed();
    imageUrl = data.imageUrl;
  }

  const campaign = await prisma.campaign.create({
    data: {
      title: data.subject,
      subject: data.subject,
      content: data.content,
      segment: data.segment,
      provinceId: data.provinceId ?? null,
      imageUrl,
      ctaLabel,
      ctaUrl,
      status: "SENDING",
    },
  });

  try {
    const sentCount = await dispatchCampaignEmail(campaign);
    const sent = await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENT", sentCount, sentAt: new Date() } });
    res.status(201).json({ campaign: sent });
  } catch (err) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "DRAFT" } });
    throw new AppError(`No se pudo enviar la campaña: ${err.message}`, 502);
  }
}

// Bloque 67 (pedido explícito): edita los datos guardados de una campaña YA
// EXISTENTE (enviada o no) — nunca reenvía nada por sí solo, para eso está
// resendCampaign. `removeImage` (checkbox del modal de edición) es la única
// forma de sacar una imagen ya puesta sin reemplazarla por otra.
const updateCampaignSchema = campaignContentSchema.extend({
  removeImage: z.coerce.boolean().optional().default(false),
});

export async function updateCampaign(req, res) {
  const { id } = req.params;
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) throw new AppError("Campaña no encontrada.", 404);

  const data = updateCampaignSchema.parse(req.body);
  const ctaLabel = data.ctaLabel || null;
  const ctaUrl = data.ctaUrl || null;
  assertCtaComplete(ctaLabel, ctaUrl);

  let imageUrl = existing.imageUrl;
  if (req.file) {
    await deleteLocalCampaignImage(existing.imageUrl);
    imageUrl = `/uploads/site/${req.file.filename}`;
  } else if (data.imageUrl) {
    await assertImageLinkAllowed();
    await deleteLocalCampaignImage(existing.imageUrl);
    imageUrl = data.imageUrl;
  } else if (data.removeImage) {
    await deleteLocalCampaignImage(existing.imageUrl);
    imageUrl = null;
  }

  const campaign = await prisma.campaign.update({
    where: { id },
    data: {
      title: data.subject,
      subject: data.subject,
      content: data.content,
      segment: data.segment,
      provinceId: data.provinceId || null,
      imageUrl,
      ctaLabel,
      ctaUrl,
    },
  });
  res.json({ campaign });
}

// Bloque 67 (pedido explícito): "reenviar" crea un envío NUEVO (propia fila,
// propio sentAt/sentCount) con el contenido actual ya guardado de la
// campaña — la campaña original queda intacta en el historial, mismo
// criterio que una herramienta de email marketing real (cada envío es un
// evento propio, no se pisa el anterior).
export async function resendCampaign(req, res) {
  const { id } = req.params;
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) throw new AppError("Campaña no encontrada.", 404);
  if (!existing.subject || !existing.content) {
    throw new AppError("Esta campaña no tiene asunto o mensaje para reenviar.", 400);
  }

  const campaign = await prisma.campaign.create({
    data: {
      title: existing.subject,
      subject: existing.subject,
      content: existing.content,
      segment: existing.segment,
      provinceId: existing.provinceId,
      imageUrl: existing.imageUrl,
      ctaLabel: existing.ctaLabel,
      ctaUrl: existing.ctaUrl,
      status: "SENDING",
    },
  });

  try {
    const sentCount = await dispatchCampaignEmail(campaign);
    const sent = await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENT", sentCount, sentAt: new Date() } });
    res.status(201).json({ campaign: sent });
  } catch (err) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "DRAFT" } });
    throw new AppError(`No se pudo reenviar la campaña: ${err.message}`, 502);
  }
}

// Bloque 67 (pedido explícito): borra el registro — nunca "des-envía" un
// correo ya entregado (imposible), solo lo saca del historial del admin.
export async function deleteCampaign(req, res) {
  const { id } = req.params;
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) throw new AppError("Campaña no encontrada.", 404);

  await deleteLocalCampaignImage(existing.imageUrl);
  await prisma.campaign.delete({ where: { id } });
  res.json({ ok: true });
}
