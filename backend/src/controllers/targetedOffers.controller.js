import { z } from "zod";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { Resend } from "resend";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { env } from "../config/env.js";
import { getIntegrationConfig } from "./integrations.controller.js";
import { getBrandSettings, SITE_UPLOAD_DIR } from "./settings.controller.js";
import { emailShell, ctaButton, resolveAssetUrl } from "../templates/_shared.js";
import { resolveMyVendor } from "../utils/resolveVendor.js";

// Bloque 194 (pedido explícito — "ofertas autodirigidas... para clientes o
// para vendedores... por email o mostrarse en el panel o en la cuenta...
// como popup, o ambas. También lanzar ofertas a vendedores en específico,
// como los registrados en el plan Business, o los no registrados, y a uno
// en específico"): mismo patrón de armado de correo que
// campaigns.controller.js (emailShell/ctaButton/Resend, chequeo manual de
// result.error porque el SDK nunca lanza excepción) — no se reinventa acá.
// A diferencia de Campaign (audiencia fija: todos los clientes o todos los
// vendedores por plan/provincia), TargetedOffer también apunta a UN
// vendedor o UN cliente puntual, y puede mostrarse como popup en vez de (o
// además de) mandarse por correo — ver TargetedOfferDelivery en el schema.

const RESEND_SANDBOX_FROM = "onboarding@resend.dev";

const AUDIENCES = [
  "all_customers",
  "all_vendors",
  "regular_vendors",
  "business_vendors",
  "unverified_vendors",
  "specific_vendor",
  "specific_customer",
];

// Mismo criterio que assertImageLinkAllowed en campaigns.controller.js /
// storeOffers.controller.js — apagable desde el admin (SiteSettings.allowProductImageLinks).
async function assertImageLinkAllowed() {
  const settings = await prisma.siteSettings.findFirst();
  if (settings && settings.allowProductImageLinks === false) {
    throw new AppError("El administrador desactivó agregar imágenes por link. Sube un archivo en su lugar.", 403);
  }
}

function deleteLocalImage(imageUrl) {
  if (!imageUrl || /^https?:\/\//.test(imageUrl)) return Promise.resolve();
  return unlink(join(SITE_UPLOAD_DIR, imageUrl.replace(/^\/uploads\/site\//, ""))).catch(() => {});
}

// Bloque 194: botón interno ("/vendedor/verificacion", "/tienda/mi-tienda")
// o externo absoluto ("https://...") — mismo criterio que buttonUrlSchema
// en adminOffers.controller.js (Bloque 192).
const ctaUrlSchema = z
  .string()
  .trim()
  .max(500)
  .refine((v) => v.startsWith("/") || /^https?:\/\//.test(v), {
    message: "El enlace debe empezar con / (interno) o con http(s):// (externo).",
  });

function assertCtaComplete(ctaLabel, ctaUrl) {
  if (!!ctaLabel !== !!ctaUrl) {
    throw new AppError("Si agregas un botón, también necesita un enlace (y viceversa).", 400);
  }
}

// FormData manda todo como string — z.coerce.boolean() coacciona CUALQUIER
// string no vacío (incluido literal "false") a true, así que no sirve para
// un checkbox de 2 vías real como sendEmail/showPopup (el form SÍ manda
// "false" explícito cuando el admin lo destilda). Mismo helper que ya usan
// announcements.controller.js/verification.controller.js para este caso.
const boolish = z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean());

// Un correo se abre fuera del navegador (sin origin propio) — un enlace
// interno ("/algo") necesita el dominio del FRONTEND antepuesto a mano,
// mismo criterio que cualquier ctaButton(...) de src/templates/*.js.
function resolveCtaHref(ctaUrl) {
  return ctaUrl.startsWith("/") ? `${env.frontendUrl}${ctaUrl}` : ctaUrl;
}

// Bloque 194: resuelve los emails destinatarios según la audiencia elegida.
// "unverified_vendors" es NUEVO respecto a Campaign (que no lo tiene) —
// cualquier tienda activa cuyo verificationStatus no sea VERIFIED, sin
// importar en qué paso del flujo de verificación esté.
async function resolveTargetedOfferRecipients(offer) {
  if (offer.audience === "all_customers") {
    const users = await prisma.user.findMany({ where: { role: "CUSTOMER", isSuspended: false }, select: { email: true } });
    return users.map((u) => u.email);
  }
  if (offer.audience === "specific_customer") {
    const user = await prisma.user.findUnique({ where: { id: offer.targetUserId } });
    return user ? [user.email] : [];
  }
  if (offer.audience === "specific_vendor") {
    const vendor = await prisma.vendor.findUnique({ where: { id: offer.targetVendorId }, include: { user: { select: { email: true } } } });
    return vendor ? [vendor.user.email] : [];
  }

  // Resto: variantes de "vendedores" — all_vendors (sin filtro de plan/
  // verificación), regular_vendors/business_vendors (por plan),
  // unverified_vendors (por verificationStatus).
  const planFilter = offer.audience === "regular_vendors" ? "REGULAR" : offer.audience === "business_vendors" ? "BUSINESS" : undefined;
  const vendors = await prisma.vendor.findMany({
    where: {
      isBlocked: false,
      status: "ACTIVE",
      planType: planFilter,
      verificationStatus: offer.audience === "unverified_vendors" ? { not: "VERIFIED" } : undefined,
    },
    include: { user: { select: { email: true } } },
  });
  return vendors.map((v) => v.user.email);
}

// Único punto de envío real — reusado por createTargetedOffer (primer
// envío) y resendTargetedOfferEmail (reenvío manual). Nunca simula un envío
// exitoso: si Resend rechaza, tira y el llamador decide qué hacer con eso
// (ver el comentario largo en createTargetedOffer sobre por qué acá, a
// diferencia de Campaign, un fallo de envío NO revierte la oferta creada).
async function dispatchTargetedOfferEmail(offer) {
  const config = await getIntegrationConfig("resend");
  if (!config) {
    throw new AppError("No hay una integración de Resend activa. Configúrala en Integraciones antes de enviar.", 400);
  }

  const recipients = await resolveTargetedOfferRecipients(offer);
  if (recipients.length === 0) {
    throw new AppError("No hay destinatarios para esa audiencia.", 400);
  }

  const { siteName } = await getBrandSettings();
  const resend = new Resend(config.apiKey);
  const imgSrc = resolveAssetUrl(offer.imageUrl);
  const html = await emailShell({
    title: offer.title,
    storeName: siteName,
    bodyMjml: `
      ${imgSrc ? `<mj-image src="${imgSrc}" alt="${offer.title}" border-radius="12px" padding="0 0 16px" />` : ""}
      <mj-text color="#44474c" font-size="14px" line-height="22px">${offer.message.replace(/\n/g, "<br/>")}</mj-text>
      ${offer.ctaLabel && offer.ctaUrl ? ctaButton(offer.ctaLabel, resolveCtaHref(offer.ctaUrl)) : ""}
    `,
  });
  const result = await resend.emails.send({
    from: `${siteName} <${config.fromEmail || RESEND_SANDBOX_FROM}>`,
    to: recipients,
    subject: offer.title,
    html,
  });
  if (result.error) throw new Error(result.error.message ?? "Resend rechazó el envío.");
  return recipients.length;
}

// ---------------------------------------------------------------------
// Admin: listar/crear/editar/reenviar/borrar.
// ---------------------------------------------------------------------

export async function listAdminTargetedOffers(_req, res) {
  const offers = await prisma.targetedOffer.findMany({ orderBy: { createdAt: "desc" } });

  // targetVendorId/targetUserId son ids sueltos (sin relación de Prisma a
  // propósito, ver el schema) — se resuelven a mano acá solo para que la
  // lista del admin muestre un nombre en vez de un id críptico.
  const vendorIds = offers.filter((o) => o.targetVendorId).map((o) => o.targetVendorId);
  const userIds = offers.filter((o) => o.targetUserId).map((o) => o.targetUserId);
  const [vendors, users] = await Promise.all([
    vendorIds.length ? prisma.vendor.findMany({ where: { id: { in: vendorIds } }, select: { id: true, companyName: true } }) : [],
    userIds.length ? prisma.user.findMany({ where: { id: { in: userIds } }, select: { id: true, fullName: true, email: true } }) : [],
  ]);
  const vendorMap = new Map(vendors.map((v) => [v.id, v]));
  const userMap = new Map(users.map((u) => [u.id, u]));

  res.json({
    offers: offers.map((o) => ({
      ...o,
      targetVendor: o.targetVendorId ? vendorMap.get(o.targetVendorId) ?? null : null,
      targetUser: o.targetUserId ? userMap.get(o.targetUserId) ?? null : null,
    })),
  });
}

// Bloque 194: en vez de exponer el enum TargetedOfferDelivery crudo al
// formulario del admin, se aceptan 2 checkboxes independientes
// (sendEmail/showPopup) — más natural en la UI que un select de 3 opciones
// — y se calculan acá mismo a EMAIL/POPUP/BOTH. Ninguno de los dos
// marcados es un error explícito (una oferta que no se entrega de ninguna
// forma no tiene sentido).
const targetedOfferContentSchema = z.object({
  title: z.string().trim().min(2, "El título es obligatorio."),
  message: z.string().trim().min(2, "El mensaje es obligatorio."),
  imageUrl: z.string().trim().optional(),
  ctaLabel: z.string().trim().max(40).optional(),
  ctaUrl: ctaUrlSchema.optional(),
  audience: z.enum(AUDIENCES),
  targetVendorId: z.string().optional(),
  targetUserId: z.string().optional(),
  sendEmail: boolish.optional().default(false),
  showPopup: boolish.optional().default(false),
  expiresAt: z.string().trim().optional(),
});

export async function createTargetedOffer(req, res) {
  try {
    const data = targetedOfferContentSchema.parse(req.body);
    const ctaLabel = data.ctaLabel || null;
    const ctaUrl = data.ctaUrl || null;
    assertCtaComplete(ctaLabel, ctaUrl);

    if (!data.sendEmail && !data.showPopup) {
      throw new AppError("Elige al menos una forma de entrega: correo, popup, o ambas.", 400);
    }
    const delivery = data.sendEmail && data.showPopup ? "BOTH" : data.sendEmail ? "EMAIL" : "POPUP";

    let targetVendorId = null;
    let targetUserId = null;
    if (data.audience === "specific_vendor") {
      if (!data.targetVendorId) throw new AppError("Elige la tienda a la que va dirigida.", 400);
      const vendor = await prisma.vendor.findUnique({ where: { id: data.targetVendorId } });
      if (!vendor) throw new AppError("Tienda no encontrada.", 404);
      targetVendorId = vendor.id;
    } else if (data.audience === "specific_customer") {
      if (!data.targetUserId) throw new AppError("Elige el cliente al que va dirigida.", 400);
      const user = await prisma.user.findUnique({ where: { id: data.targetUserId } });
      if (!user || user.role !== "CUSTOMER") throw new AppError("Cliente no encontrado.", 404);
      targetUserId = user.id;
    }

    let imageUrl = null;
    if (req.file) {
      imageUrl = `/uploads/site/${req.file.filename}`;
    } else if (data.imageUrl) {
      await assertImageLinkAllowed();
      imageUrl = data.imageUrl;
    }

    const offer = await prisma.targetedOffer.create({
      data: {
        title: data.title,
        message: data.message,
        imageUrl,
        ctaLabel,
        ctaUrl,
        audience: data.audience,
        targetVendorId,
        targetUserId,
        delivery,
        expiresAt: data.expiresAt ? new Date(data.expiresAt) : null,
      },
    });

    // Bloque 194: si la entrega incluye correo, se despacha de inmediato al
    // crear (igual que createCampaign). A DIFERENCIA de Campaign — que si
    // el envío falla, el registro entero vuelve a DRAFT (nunca queda
    // "enviada" a medias) — acá la oferta YA quedó creada y disponible
    // como popup (si corresponde) sin importar si el correo salió bien:
    // son 2 entregas independientes, el popup no depende de que el mail
    // haya sido exitoso. Un fallo de envío se loguea y se devuelve como
    // aviso en la respuesta, nunca revierte la creación.
    let emailWarning = null;
    if (delivery === "EMAIL" || delivery === "BOTH") {
      try {
        const sentCount = await dispatchTargetedOfferEmail(offer);
        await prisma.targetedOffer.update({ where: { id: offer.id }, data: { emailSentCount: sentCount, emailSentAt: new Date() } });
      } catch (err) {
        console.error("[targeted-offers] no se pudo enviar el correo al crear:", err.message);
        emailWarning = `La oferta se creó, pero el correo no se pudo enviar: ${err.message}`;
      }
    }

    const fresh = await prisma.targetedOffer.findUnique({ where: { id: offer.id } });
    res.status(201).json({ offer: fresh, emailWarning });
  } catch (err) {
    if (req.file) unlink(join(SITE_UPLOAD_DIR, req.file.filename)).catch(() => {});
    throw err;
  }
}

function deliveryToFlags(delivery) {
  return { sendEmail: delivery === "EMAIL" || delivery === "BOTH", showPopup: delivery === "POPUP" || delivery === "BOTH" };
}

// Bloque 194: edita los datos guardados de una oferta dirigida YA
// EXISTENTE — nunca reenvía el correo solo por editar (para eso está
// resendTargetedOfferEmail), mismo criterio que updateCampaign/updateAdminOffer.
const updateTargetedOfferSchema = z.object({
  title: z.string().trim().min(2).optional(),
  message: z.string().trim().min(2).optional(),
  imageUrl: z.string().trim().optional(),
  removeImage: z.coerce.boolean().optional().default(false),
  ctaLabel: z.string().trim().max(40).optional().nullable(),
  ctaUrl: z.union([ctaUrlSchema, z.literal("")]).optional().nullable(),
  audience: z.enum(AUDIENCES).optional(),
  targetVendorId: z.string().optional(),
  targetUserId: z.string().optional(),
  sendEmail: boolish.optional(),
  showPopup: boolish.optional(),
  status: z.enum(["ACTIVE", "ARCHIVED"]).optional(),
  expiresAt: z.string().trim().optional(),
  clearExpiry: z.coerce.boolean().optional(),
});

export async function updateTargetedOffer(req, res) {
  try {
    const { id } = req.params;
    const existing = await prisma.targetedOffer.findUnique({ where: { id } });
    if (!existing) throw new AppError("Oferta dirigida no encontrada.", 404);

    const data = updateTargetedOfferSchema.parse(req.body);
    const patch = {};

    if (data.title !== undefined) patch.title = data.title;
    if (data.message !== undefined) patch.message = data.message;
    if (data.status !== undefined) patch.status = data.status;

    // Botón/enlace van siempre juntos o ninguno — se valida contra el
    // estado FINAL (lo que trae este patch + lo que ya tenía la fila), no
    // contra los 2 campos sueltos del body, mismo criterio que updateAdminOffer.
    if (data.ctaLabel !== undefined) patch.ctaLabel = data.ctaLabel || null;
    if (data.ctaUrl !== undefined) patch.ctaUrl = data.ctaUrl || null;
    const finalCtaLabel = "ctaLabel" in patch ? patch.ctaLabel : existing.ctaLabel;
    const finalCtaUrl = "ctaUrl" in patch ? patch.ctaUrl : existing.ctaUrl;
    if (!!finalCtaLabel !== !!finalCtaUrl) {
      throw new AppError("Si agregas un botón, también necesita un enlace (y viceversa).", 400);
    }

    if (req.file) {
      await deleteLocalImage(existing.imageUrl);
      patch.imageUrl = `/uploads/site/${req.file.filename}`;
    } else if (data.imageUrl) {
      await assertImageLinkAllowed();
      await deleteLocalImage(existing.imageUrl);
      patch.imageUrl = data.imageUrl;
    } else if (data.removeImage) {
      await deleteLocalImage(existing.imageUrl);
      patch.imageUrl = null;
    }

    // Igual que arriba: se valida el estado FINAL de audiencia+target, solo
    // si el patch realmente toca alguno de los 3 campos — un PATCH que solo
    // cambia el título no vuelve a pegarle a la DB por esto.
    if (data.audience !== undefined || "targetVendorId" in data || "targetUserId" in data) {
      const finalAudience = data.audience ?? existing.audience;
      let finalTargetVendorId = "targetVendorId" in data ? data.targetVendorId || null : existing.targetVendorId;
      let finalTargetUserId = "targetUserId" in data ? data.targetUserId || null : existing.targetUserId;

      if (finalAudience === "specific_vendor") {
        if (!finalTargetVendorId) throw new AppError("Elige la tienda a la que va dirigida.", 400);
        const vendor = await prisma.vendor.findUnique({ where: { id: finalTargetVendorId } });
        if (!vendor) throw new AppError("Tienda no encontrada.", 404);
        finalTargetUserId = null;
      } else if (finalAudience === "specific_customer") {
        if (!finalTargetUserId) throw new AppError("Elige el cliente al que va dirigida.", 400);
        const user = await prisma.user.findUnique({ where: { id: finalTargetUserId } });
        if (!user || user.role !== "CUSTOMER") throw new AppError("Cliente no encontrado.", 404);
        finalTargetVendorId = null;
      } else {
        finalTargetVendorId = null;
        finalTargetUserId = null;
      }

      if (data.audience !== undefined) patch.audience = data.audience;
      patch.targetVendorId = finalTargetVendorId;
      patch.targetUserId = finalTargetUserId;
    }

    if (data.sendEmail !== undefined || data.showPopup !== undefined) {
      const current = deliveryToFlags(existing.delivery);
      const sendEmail = data.sendEmail ?? current.sendEmail;
      const showPopup = data.showPopup ?? current.showPopup;
      if (!sendEmail && !showPopup) throw new AppError("Elige al menos una forma de entrega: correo, popup, o ambas.", 400);
      patch.delivery = sendEmail && showPopup ? "BOTH" : sendEmail ? "EMAIL" : "POPUP";
    }

    if (data.clearExpiry) {
      patch.expiresAt = null;
    } else if (data.expiresAt !== undefined) {
      patch.expiresAt = data.expiresAt ? new Date(data.expiresAt) : null;
    }

    const offer = await prisma.targetedOffer.update({ where: { id }, data: patch });
    res.json({ offer });
  } catch (err) {
    if (req.file) unlink(join(SITE_UPLOAD_DIR, req.file.filename)).catch(() => {});
    throw err;
  }
}

// Bloque 194: "reenviar" a diferencia de resendCampaign (que crea una fila
// NUEVA con su propio historial) reusa la MISMA fila — una oferta dirigida
// es contenido persistente con estado propio (vistas/descartes por
// usuario), no un envío puntual de una sola vez; reenviar el correo no
// tiene que duplicar ese registro. Si el envío falla, acá SÍ se propaga el
// error tal cual al admin (a diferencia de createTargetedOffer) — pidió
// reenviar a propósito, tiene que enterarse si no salió.
export async function resendTargetedOfferEmail(req, res) {
  const { id } = req.params;
  const offer = await prisma.targetedOffer.findUnique({ where: { id } });
  if (!offer) throw new AppError("Oferta dirigida no encontrada.", 404);

  try {
    const sentCount = await dispatchTargetedOfferEmail(offer);
    const updated = await prisma.targetedOffer.update({
      where: { id },
      data: { emailSentCount: sentCount, emailSentAt: new Date() },
    });
    res.json({ offer: updated });
  } catch (err) {
    throw new AppError(`No se pudo reenviar el correo: ${err.message}`, 502);
  }
}

export async function deleteTargetedOffer(req, res) {
  const { id } = req.params;
  const existing = await prisma.targetedOffer.findUnique({ where: { id } });
  if (!existing) throw new AppError("Oferta dirigida no encontrada.", 404);

  await deleteLocalImage(existing.imageUrl);
  // onDelete: Cascade en TargetedOfferView — se lleva sus vistas/descartes
  // registrados sin necesidad de borrarlas a mano.
  await prisma.targetedOffer.delete({ where: { id } });
  res.json({ ok: true });
}

// ---------------------------------------------------------------------
// Usuario final: "mis ofertas dirigidas" (popup) + descartar.
// ---------------------------------------------------------------------

// Bloque 194: qué valores de `audience` le corresponden al usuario
// autenticado, según su rol — reusado tanto acá como implícitamente
// documenta el mapeo que el admin ve en el selector del formulario.
export async function listMyTargetedOffers(req, res) {
  const { id: userId, role } = req.user;

  // Un ADMIN nunca es audiencia de esto (crea las ofertas, no las recibe).
  if (role === "ADMIN") return res.json({ offers: [] });

  let audienceWhere;
  if (role === "CUSTOMER") {
    audienceWhere = { OR: [{ audience: "all_customers" }, { audience: "specific_customer", targetUserId: userId }] };
  } else if (role === "VENDOR" || role === "VENDOR_STAFF") {
    // Bloque 194 (decisión deliberada, no bug): un usuario de sistema
    // (VENDOR_STAFF) SÍ ve las ofertas dirigidas al negocio de su
    // empleador — resolveMyVendor ya resuelve su tienda real igual que en
    // cualquier otra sección del panel de vendedor (tables/orders/products/...).
    const vendor = await resolveMyVendor(userId);
    const vendorAudiences = ["all_vendors"];
    if (vendor.planType === "REGULAR") vendorAudiences.push("regular_vendors");
    if (vendor.planType === "BUSINESS") vendorAudiences.push("business_vendors");
    if (vendor.verificationStatus !== "VERIFIED") vendorAudiences.push("unverified_vendors");
    audienceWhere = { OR: [{ audience: { in: vendorAudiences } }, { audience: "specific_vendor", targetVendorId: vendor.id }] };
  } else {
    return res.json({ offers: [] });
  }

  const now = new Date();
  const offers = await prisma.targetedOffer.findMany({
    where: {
      status: "ACTIVE",
      // Este endpoint alimenta el POPUP — una oferta con delivery:"EMAIL"
      // puro (el admin decidió explícitamente que NO se muestre acá) nunca
      // aparece en esta lista, aunque matchee la audiencia.
      delivery: { in: ["POPUP", "BOTH"] },
      OR: [{ expiresAt: null }, { expiresAt: { gt: now } }],
      AND: [audienceWhere],
      // Sin view todavía, o con dismissedAt null: sigue pendiente. Con
      // dismissedAt seteado: ya la cerró, nunca más se le vuelve a mostrar.
      views: { none: { userId, dismissedAt: { not: null } } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ offers });
}

// Bloque 194: crea o actualiza (upsert por el índice único
// [targetedOfferId, userId]) el registro de "ya lo vi/cerré". No hace
// falta re-validar que la audiencia le correspondiera a este usuario en
// particular — descartar algo que no le tocaba ver es inofensivo.
export async function dismissTargetedOffer(req, res) {
  const { id } = req.params;
  const userId = req.user.id;

  const offer = await prisma.targetedOffer.findUnique({ where: { id } });
  if (!offer) throw new AppError("Oferta dirigida no encontrada.", 404);

  const view = await prisma.targetedOfferView.upsert({
    where: { targetedOfferId_userId: { targetedOfferId: id, userId } },
    create: { targetedOfferId: id, userId, dismissedAt: new Date() },
    update: { dismissedAt: new Date() },
  });
  res.json({ view });
}
