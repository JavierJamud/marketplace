import { z } from "zod";
import { unlink } from "node:fs/promises";
import { basename, join } from "node:path";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { getBrandSettings, SITE_UPLOAD_DIR } from "./settings.controller.js";
import { smallVariantName } from "../lib/heroVariants.js";
import { emailShell, ctaButton, resolveAssetUrl, esc } from "../templates/_shared.js";
import { unsubscribeFooter } from "../templates/customerReminders.js";
import { sendToEach, UNSUBSCRIBE_URL_MARK } from "../lib/massEmail.js";
import { logActivity } from "../lib/activityLog.js";
import { parseAudienceSegment, planFilterForSegment, planSegmentLabel } from "../lib/planSegments.js";

// segmentLabel: el público por plan con el nombre del plan de la base ("Tiendas del plan Básico"); null en los demás.
export async function listCampaigns(_req, res) {
  const campaigns = await prisma.campaign.findMany({ orderBy: { createdAt: "desc" } });
  res.json({ campaigns: await Promise.all(campaigns.map(async (c) => ({ ...c, segmentLabel: await planSegmentLabel(c.segment) }))) });
}

// Públicos que no dependen del plan. Los públicos por plan (plan por defecto, planes de pago o un plan concreto) los
// valida y traduce lib/planSegments.js, sin lista fija de claves.
const FIXED_SEGMENTS = ["all_customers", "all_vendors"];

// Devuelve [{ id, email, marketingEmails }] (el id firma el enlace de baja de cada correo). Fuera las cuentas borradas o
// en proceso de borrarse (deletionRequestedAt: la persona pidió darse de baja y está en su período de gracia; en la tienda,
// también la eliminación que pidió el admin): su dirección deja de ser de esa persona (o ya es la anonimizada), un rebote
// daña el envío y a quien pidió irse no se le manda publicidad. Lo usan el envío y el estimado (estimateCampaignRecipients),
// así el número que ve el admin antes de enviar es el mismo que se envía.
async function resolveRecipients(segment, provinceId) {
  if (segment === "all_customers") {
    return prisma.user.findMany({
      where: { role: "CUSTOMER", isSuspended: false, deletedAt: null, deletionRequestedAt: null, provinceId: provinceId || undefined },
      select: { id: true, email: true, marketingEmails: true },
    });
  }

  const planFilter = await planFilterForSegment(segment);
  const vendors = await prisma.vendor.findMany({
    where: {
      isBlocked: false,
      status: "ACTIVE",
      deletedAt: null,
      deletionRequestedAt: null,
      adminDeletionRequestedAt: null,
      planType: planFilter,
      locations: provinceId ? { some: { provinceId } } : undefined,
      user: { deletedAt: null, deletionRequestedAt: null },
    },
    select: { user: { select: { id: true, email: true, marketingEmails: true } } },
  });
  return vendors.map((v) => v.user);
}

// GET /admin/campaigns/estimate?segment=&provinceId=: cuántos recibirían la campaña ahora mismo. Antes la pantalla lo
// estimaba con el total de /admin/customers y /admin/vendors, que cuentan con otro criterio (incluyen a quien se dio de
// baja de las promociones o está borrando su cuenta) y el número no coincidía con el envío. `recipients` es lo que se
// enviaría; `optedOut`, los del público que se dieron de baja de los correos de promoción.
export async function estimateCampaignRecipients(req, res) {
  const segment = await parseAudienceSegment(String(req.query.segment ?? ""), FIXED_SEGMENTS);
  const provinceId = typeof req.query.provinceId === "string" && req.query.provinceId ? req.query.provinceId : null;
  const all = await resolveRecipients(segment, provinceId);
  const recipients = all.filter((r) => r.marketingEmails).length;
  res.json({ segment, total: all.length, recipients, optedOut: all.length - recipients });
}

// Mismo criterio que assertImageLinkAllowed en storeOffers.controller.js —
// apagable desde el admin (SiteSettings.allowProductImageLinks).
async function assertImageLinkAllowed() {
  const settings = await prisma.siteSettings.findFirst();
  if (settings && settings.allowProductImageLinks === false) {
    throw new AppError("El administrador desactivó agregar imágenes por link. Sube un archivo en su lugar.", 403);
  }
}

// Borra del disco la imagen subida de una campaña, salvo que otra campaña la siga usando: "Reenviar" crea una fila nueva
// con la misma imageUrl (resendCampaign), así que borrar o editar la original dejaba sin imagen a sus reenvíos (y al
// revés). `campaignId` es la campaña que suelta la imagen, que no cuenta como uso.
// Solo se toca un archivo propio de /uploads/site/ (el nombre, sin carpetas); un link externo nunca es nuestro.
// La carpeta la comparten las imágenes de la portada (con su versión chica para celulares), los anuncios y las ofertas
// dirigidas. Antes el link aceptaba una ruta propia, así que una campaña vieja puede tener como "link" una imagen de la
// portada: si alguno de ellos la usa, no se borra (el refine de imageUrl solo frena las filas nuevas).
async function deleteLocalCampaignImage(imageUrl, campaignId) {
  if (!imageUrl || !imageUrl.startsWith("/uploads/site/")) return;
  const fileName = imageUrl.slice("/uploads/site/".length);
  if (!fileName || fileName !== basename(fileName)) return;
  const [otherCampaigns, offers, announcements, settings] = await Promise.all([
    prisma.campaign.count({ where: { imageUrl, id: { not: campaignId } } }),
    prisma.targetedOffer.count({ where: { imageUrl } }),
    // Announcement guarda solo el nombre del archivo (announcements.controller.js le agrega la carpeta al leer).
    prisma.announcement.count({ where: { imageUrl: { in: [fileName, imageUrl] } } }),
    prisma.siteSettings.findFirst({ select: { heroImages: true } }),
  ]);
  const heroFiles = (settings?.heroImages ?? []).flatMap((url) => {
    const name = url.replace(/^\/uploads\/site\//, "");
    return [name, smallVariantName(name)];
  });
  if (otherCampaigns > 0 || offers > 0 || announcements > 0 || heroFiles.includes(fileName)) return;
  await unlink(join(SITE_UPLOAD_DIR, fileName)).catch(() => {});
}

// Bloque 67 (pedido explícito): imagen banner opcional (archivo o link
// externo) + botón de llamado a la acción opcional (label+url van siempre
// juntos) — "más personalización" del correo, más allá de solo asunto/texto.
const campaignContentSchema = z.object({
  subject: z.string().trim().min(2),
  content: z.string().trim().min(2),
  // Se valida después con parseAudienceSegment (acepta además una clave de plan).
  segment: z.string().trim().min(1).max(40),
  provinceId: z.string().optional(),
  // Link externo de la imagen: solo http(s). Una ruta propia (/uploads/site/...) se aceptaba como link y al borrar la
  // campaña se borraba ese archivo, que podía ser el logo o una imagen de la portada.
  imageUrl: z
    .string()
    .trim()
    .refine((v) => !v || /^https?:\/\/\S+$/i.test(v), "El link de la imagen tiene que empezar con http:// o https://.")
    .optional(),
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
// exitoso: si no salió ningún correo, tira y el llamador revierte el status.
// Cada persona recibe su propio correo con su enlace de baja (lib/massEmail.js):
// antes salía uno solo con todas las direcciones en "to", a la vista de todos.
// Quien se dio de baja de los correos de promoción (User.marketingEmails, el
// mismo interruptor de los recordatorios) queda fuera, si no el enlace del pie
// sería una promesa falsa.
async function dispatchCampaignEmail(campaign) {
  const all = await resolveRecipients(campaign.segment, campaign.provinceId);
  if (all.length === 0) {
    throw new AppError("No hay destinatarios para ese segmento/provincia.", 400);
  }
  const recipients = all.filter((r) => r.marketingEmails);
  const optedOut = all.length - recipients.length;
  if (recipients.length === 0) {
    throw new AppError("Todos los destinatarios de ese segmento se dieron de baja de los correos de promoción.", 400);
  }

  const { siteName } = await getBrandSettings();
  const imgSrc = resolveAssetUrl(campaign.imageUrl);
  const isCustomers = campaign.segment === "all_customers";
  const html = await emailShell({
    title: campaign.subject,
    storeName: siteName,
    footerNote: unsubscribeFooter(UNSUBSCRIBE_URL_MARK, {
      reason: isCustomers ? `Te escribimos porque tienes cuenta en ${esc(siteName)}.` : `Te escribimos porque tienes una tienda en ${esc(siteName)}.`,
      label: "No quiero recibir más correos de promoción",
    }),
    bodyMjml: `
      ${imgSrc ? `<mj-image src="${imgSrc}" alt="${esc(campaign.subject)}" border-radius="12px" padding="0 0 16px" />` : ""}
      <mj-text color="#44474c" font-size="14px" line-height="22px">${campaign.content.replace(/\n/g, "<br/>")}</mj-text>
      ${campaign.ctaLabel && campaign.ctaUrl ? ctaButton(campaign.ctaLabel, campaign.ctaUrl) : ""}
    `,
  });
  const result = await sendToEach({ recipients, subject: campaign.subject, html, source: "campaña" });
  if (result.sent === 0) throw new Error(result.firstError ?? "Resend rechazó el envío.");
  return { sentCount: result.sent, failedCount: result.failed, optedOut };
}

// Un envío que salió a medias (algún lote rechazado) queda como enviado con
// los que sí salieron: volver a DRAFT invitaría a reenviarlo y los que ya lo
// recibieron lo tendrían dos veces. El aviso le dice al admin cuántos faltaron.
function dispatchWarning({ failedCount }) {
  return failedCount > 0 ? `No se pudieron enviar ${failedCount.toLocaleString("es-CU")} correos. El motivo está en Errores.` : null;
}

// Envío real vía Resend (sin mock). Si no hay integración activa, falla con
// un mensaje claro en vez de simular un envío exitoso.
export async function createCampaign(req, res) {
  const data = campaignContentSchema.parse(req.body);
  data.segment = await parseAudienceSegment(data.segment, FIXED_SEGMENTS);
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
    const outcome = await dispatchCampaignEmail(campaign);
    const sent = await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENT", sentCount: outcome.sentCount, sentAt: new Date() } });
    // Historial del correo masivo: quién lo mandó y a cuántos llegó.
    logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "campaign_sent", description: `Envió la campaña "${campaign.subject ?? campaign.id}"`, meta: { campaignId: campaign.id, sentCount: outcome.sentCount, failedCount: outcome.failedCount } });
    res.status(201).json({ campaign: sent, failedCount: outcome.failedCount, optedOut: outcome.optedOut, warning: dispatchWarning(outcome) });
  } catch (err) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "DRAFT" } });
    throw new AppError(`No se pudo enviar la campaña: ${err.message}`, err instanceof AppError ? err.statusCode ?? 502 : 502);
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
  // Sin cambio de público se conserva el guardado aunque su plan se haya archivado después: editar el texto de una campaña
  // vieja no debe fallar por eso.
  data.segment = data.segment === existing.segment ? existing.segment : await parseAudienceSegment(data.segment, FIXED_SEGMENTS);
  const ctaLabel = data.ctaLabel || null;
  const ctaUrl = data.ctaUrl || null;
  assertCtaComplete(ctaLabel, ctaUrl);

  let imageUrl = existing.imageUrl;
  if (req.file) {
    imageUrl = `/uploads/site/${req.file.filename}`;
  } else if (data.imageUrl) {
    await assertImageLinkAllowed();
    imageUrl = data.imageUrl;
  } else if (data.removeImage) {
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
  // La imagen anterior se borra recién con la fila ya guardada: así el conteo de usos de deleteLocalCampaignImage ya no ve
  // esta campaña apuntando a ella, y si el guardado falla la imagen sigue en su lugar.
  if (existing.imageUrl && existing.imageUrl !== imageUrl) await deleteLocalCampaignImage(existing.imageUrl, id);
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
    const outcome = await dispatchCampaignEmail(campaign);
    const sent = await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "SENT", sentCount: outcome.sentCount, sentAt: new Date() } });
    // Historial del correo masivo: quién lo mandó y a cuántos llegó.
    logActivity({ actorId: req.user.id, actorRole: "ADMIN", action: "campaign_sent", description: `Reenvió la campaña "${campaign.subject ?? campaign.id}"`, meta: { campaignId: campaign.id, sentCount: outcome.sentCount, failedCount: outcome.failedCount } });
    res.status(201).json({ campaign: sent, failedCount: outcome.failedCount, optedOut: outcome.optedOut, warning: dispatchWarning(outcome) });
  } catch (err) {
    await prisma.campaign.update({ where: { id: campaign.id }, data: { status: "DRAFT" } });
    throw new AppError(`No se pudo reenviar la campaña: ${err.message}`, err instanceof AppError ? err.statusCode ?? 502 : 502);
  }
}

// Bloque 67 (pedido explícito): borra el registro — nunca "des-envía" un
// correo ya entregado (imposible), solo lo saca del historial del admin.
export async function deleteCampaign(req, res) {
  const { id } = req.params;
  const existing = await prisma.campaign.findUnique({ where: { id } });
  if (!existing) throw new AppError("Campaña no encontrada.", 404);

  await prisma.campaign.delete({ where: { id } });
  // Después de borrar la fila, por el mismo motivo que en updateCampaign.
  await deleteLocalCampaignImage(existing.imageUrl, id);
  res.json({ ok: true });
}
