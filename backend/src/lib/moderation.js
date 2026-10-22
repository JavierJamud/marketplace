import { prisma } from "./prisma.js";
import { env } from "../config/env.js";
import { esc } from "../templates/_shared.js";
import { sendModerationEmail } from "./email.js";
import { deleteUploadedImages } from "./uploadFiles.js";
import { finalizeUserDeletion } from "./accountDeletion.js";
import { addToBlacklist } from "./blacklist.js";

// Moderación por reportes (pedido del dueño). Reglas, todas con valores editables por el admin (SiteSettings):
// - Un reporte confirmado SUSPENDE el producto o la venta rápida: sale del sitio y el dueño tiene `suspendedItemAppealDays`
//   para apelar con evidencia; si no apela (o el admin rechaza la apelación) se borra. El reporte queda como historial.
// - Cliente: con `customerStrikeLimit` ventas rápidas suspendidas, su cuenta se bloquea. Si no reclama a soporte en
//   `customerClaimDays`, la cuenta se elimina y sus datos entran en la lista negra.
// - Tienda: con `vendorStrikeLimit` suspensiones confirmadas (productos o la tienda), se suspende aunque pague plan y tiene
//   `vendorSupportContactDays` para contactar a soporte por WhatsApp; si no, sigue suspendida `vendorFraudSuspensionDays`
//   más y al final se elimina y entra en la lista negra.
// - Cuando el admin reactiva una cuenta o tienda, las suspensiones anteriores dejan de contar (fraudStrikesResetAt).

const DAY = 86400000;
const SUSPENDED = { label: "Suspendido", color: "#ba1a1a" };
const KEPT = { label: "Revisado", color: "#0CAE53" };
const WARNING = { label: "Aviso importante", color: "#b45309" };

export async function getModerationSettings() {
  const s = await prisma.siteSettings.findFirst({
    select: {
      fraudReportEvidenceDeadlineDays: true,
      suspendedItemAppealDays: true,
      customerStrikeLimit: true,
      customerClaimDays: true,
      vendorStrikeLimit: true,
      vendorSupportContactDays: true,
      vendorFraudSuspensionDays: true,
      supportWhatsapp: true,
      siteName: true,
    },
  });
  return {
    evidenceDays: s?.fraudReportEvidenceDeadlineDays ?? 5,
    appealDays: s?.suspendedItemAppealDays ?? 30,
    customerStrikeLimit: s?.customerStrikeLimit ?? 3,
    customerClaimDays: s?.customerClaimDays ?? 30,
    vendorStrikeLimit: s?.vendorStrikeLimit ?? 5,
    vendorContactDays: s?.vendorSupportContactDays ?? 30,
    vendorSuspensionDays: s?.vendorFraudSuspensionDays ?? 90,
    supportWhatsapp: s?.supportWhatsapp ?? null,
    siteName: s?.siteName || "Baznova",
  };
}

const day = (d) => new Date(d).toLocaleDateString("es-CU", { day: "numeric", month: "long", year: "numeric", timeZone: "America/Havana" });
const supportLine = (m) => (m.supportWhatsapp ? `por WhatsApp al <strong>${esc(m.supportWhatsapp)}</strong>` : "desde la página de contacto");

// Foto del objetivo al crear el reporte: dueño, tienda y nombre (para contar avisos aunque se borre el objetivo).
export async function reportTargetSnapshot({ productId, vendorId, customerListingId }) {
  if (productId) {
    const p = await prisma.product.findUnique({ where: { id: productId }, select: { name: true, vendor: { select: { id: true, userId: true } } } });
    return p && { targetOwnerId: p.vendor.userId, targetVendorId: p.vendor.id, targetLabel: `producto "${p.name}"` };
  }
  if (vendorId) {
    const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { id: true, userId: true, companyName: true } });
    return v && { targetOwnerId: v.userId, targetVendorId: v.id, targetLabel: `tienda "${v.companyName}"` };
  }
  const l = await prisma.customerListing.findUnique({ where: { id: customerListingId }, select: { name: true, ownerId: true } });
  return l && { targetOwnerId: l.ownerId, targetVendorId: null, targetLabel: `venta rápida "${l.name}"` };
}

// Avisos que cuentan: reportes con suspensión confirmada después del último reinicio.
export async function countCustomerStrikes(userId) {
  const u = await prisma.user.findUnique({ where: { id: userId }, select: { fraudStrikesResetAt: true } });
  return prisma.report.count({
    where: { status: "RESOLVED_SUSPENDED", targetOwnerId: userId, targetVendorId: null, ...(u?.fraudStrikesResetAt ? { resolvedAt: { gt: u.fraudStrikesResetAt } } : {}) },
  });
}
export async function countVendorStrikes(vendorId) {
  const v = await prisma.vendor.findUnique({ where: { id: vendorId }, select: { fraudStrikesResetAt: true } });
  return prisma.report.count({
    where: { status: "RESOLVED_SUSPENDED", targetVendorId: vendorId, ...(v?.fraudStrikesResetAt ? { resolvedAt: { gt: v.fraudStrikesResetAt } } : {}) },
  });
}

// Aplica la suspensión de un reporte confirmado y devuelve la fecha en que se borra lo suspendido (si aplica). Un
// reporte sobre la tienda entera no la suspende por sí solo: cuenta como aviso (ver applyStrikes).
export async function suspendReportTarget(report, reason) {
  const m = await getModerationSettings();
  const now = new Date();
  const deleteAt = new Date(now.getTime() + m.appealDays * DAY);
  if (report.productId) {
    await prisma.product.update({ where: { id: report.productId }, data: { isActive: false, suspendedAt: now, suspendedReason: reason } });
    return deleteAt;
  }
  if (report.customerListingId) {
    await prisma.customerListing.update({ where: { id: report.customerListingId }, data: { isActive: false, suspendedAt: now, suspendedReason: reason } });
    return deleteAt;
  }
  return null;
}

// Después de confirmar una suspensión: si el dueño llegó al límite de avisos, bloquea su cuenta o su tienda.
export async function applyStrikes(report) {
  const m = await getModerationSettings();
  if (report.targetVendorId) {
    const strikes = await countVendorStrikes(report.targetVendorId);
    if (strikes >= m.vendorStrikeLimit) await suspendVendorForStrikes(report.targetVendorId, strikes, m);
    return { kind: "VENDOR", strikes, limit: m.vendorStrikeLimit };
  }
  if (report.targetOwnerId) {
    const strikes = await countCustomerStrikes(report.targetOwnerId);
    if (strikes >= m.customerStrikeLimit) await blockCustomerForStrikes(report.targetOwnerId, strikes, m);
    return { kind: "CUSTOMER", strikes, limit: m.customerStrikeLimit };
  }
  return null;
}

async function blockCustomerForStrikes(userId, strikes, m) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt || user.fraudBlockedAt) return;
  const now = new Date();
  const due = new Date(now.getTime() + m.customerClaimDays * DAY);
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { isSuspended: true, fraudBlockedAt: now, fraudClaimDueAt: due } }),
    prisma.session.updateMany({ where: { userId, revokedAt: null }, data: { revokedAt: now } }),
  ]);
  await sendModerationEmail({
    to: user.email,
    fullName: user.fullName,
    subject: `Tu cuenta de ${m.siteName} quedó bloqueada`,
    title: "Cuenta bloqueada temporalmente",
    badge: WARNING,
    paragraphs: [
      `Se suspendieron <strong>${strikes}</strong> de tus ventas rápidas por reportes confirmados, y ese es el máximo permitido. Por eso tu cuenta quedó bloqueada temporalmente.`,
      `Para revisar tu caso, contacta a soporte ${supportLine(m)} antes del <strong>${day(due)}</strong>.`,
      `Si para esa fecha no recibimos tu reclamo, la cuenta se elimina y tus datos quedan registrados para que no se pueda volver a crear.`,
    ],
    cta: { label: "Contactar a soporte", href: `${env.frontendUrl}/contacto` },
  }).catch(() => {});
}

async function suspendVendorForStrikes(vendorId, strikes, m) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, include: { user: true } });
  if (!vendor || vendor.deletedAt || vendor.fraudSuspendedAt) return;
  const now = new Date();
  const due = new Date(now.getTime() + m.vendorContactDays * DAY);
  const reason = `Tienda suspendida por ${strikes} reportes de fraude confirmados. Contacta a soporte antes del ${day(due)}.`;
  await prisma.vendor.update({ where: { id: vendorId }, data: { isBlocked: true, blockReason: reason, blockedAt: now, fraudSuspendedAt: now, fraudContactDueAt: due, fraudDeleteAt: null } });
  await prisma.vendorNotification.create({ data: { vendorId, type: "FRAUD_REPORT_SUSPENDED", title: "Tu tienda fue suspendida", body: reason } }).catch(() => {});
  await sendModerationEmail({
    to: vendor.user?.email,
    fullName: vendor.ownerName ?? vendor.user?.fullName,
    vendorId,
    subject: `Tu tienda ${vendor.companyName} fue suspendida`,
    title: "Tienda suspendida",
    badge: SUSPENDED,
    paragraphs: [
      `Revisamos <strong>${strikes}</strong> reportes sobre <strong>${esc(vendor.companyName)}</strong> y confirmamos que no cumplían las reglas de la plataforma. Ese es el máximo permitido, así que la tienda quedó suspendida, tenga o no un plan.`,
      `Contacta a soporte ${supportLine(m)} lo antes posible, antes del <strong>${day(due)}</strong>, para revisar tu caso.`,
      `Si no nos contactas a tiempo, la tienda seguirá suspendida ${m.vendorSuspensionDays} días más y después se eliminará.`,
    ],
    cta: { label: "Contactar a soporte", href: `${env.frontendUrl}/contacto` },
  }).catch(() => {});
}

// Correos del resultado de un reporte: al dueño y a quien reportó, con la acción y el motivo.
export async function notifyReportOutcome(report, { suspended, reason, deleteAt }) {
  const m = await getModerationSettings();
  const [owner, reporter] = await Promise.all([
    report.targetOwnerId ? prisma.user.findUnique({ where: { id: report.targetOwnerId } }) : null,
    prisma.user.findUnique({ where: { id: report.reporterId } }),
  ]);
  const label = esc(report.targetLabel ?? "publicación");
  const isItem = !!(report.productId || report.customerListingId);
  const ownerCta = report.targetVendorId ? `${env.frontendUrl}/vendedor/reportes` : `${env.frontendUrl}/cuenta/panel?tab=reports`;
  const tasks = [];
  // La tienda también lo ve en su campanita del panel.
  if (report.targetVendorId) {
    tasks.push(
      prisma.vendorNotification
        .create({
          data: {
            vendorId: report.targetVendorId,
            type: suspended ? "FRAUD_REPORT_SUSPENDED" : "FRAUD_REPORT_DISMISSED",
            title: suspended ? "Suspendimos una publicación tuya" : "Reporte revisado sin acción",
            body: `${report.targetLabel ?? "Publicación"}: ${reason ?? ""}`.slice(0, 500),
          },
        })
        .catch(() => {})
    );
  }
  if (owner) {
    tasks.push(
      sendModerationEmail({
        to: owner.email,
        fullName: owner.fullName,
        vendorId: report.targetVendorId,
        subject: suspended ? `Suspendimos tu ${report.targetLabel ?? "publicación"}` : `Revisamos el reporte sobre tu ${report.targetLabel ?? "publicación"}`,
        title: suspended ? "Publicación suspendida" : "Reporte revisado: no se toma ninguna acción",
        badge: suspended ? SUSPENDED : KEPT,
        paragraphs: suspended
          ? [
              `Revisamos un reporte sobre tu <strong>${label}</strong> y decidimos suspenderlo porque no cumple las reglas de la plataforma y sus términos y condiciones.`,
              `Motivo: <strong>${esc(reason)}</strong>`,
              isItem && deleteAt
                ? `Ya no se ve en el sitio. Si crees que es un error, envía tu evidencia desde tu panel antes del <strong>${day(deleteAt)}</strong>. Si no la recibimos para esa fecha, se elimina.`
                : null,
            ].filter(Boolean)
          : [`Revisamos un reporte sobre tu <strong>${label}</strong> y se mantiene publicada.`, reason ? `Motivo: ${esc(reason)}` : null].filter(Boolean),
        cta: suspended && isItem ? { label: "Enviar evidencia", href: ownerCta } : undefined,
      }).catch(() => {})
    );
  }
  if (reporter) {
    tasks.push(
      sendModerationEmail({
        to: reporter.email,
        fullName: reporter.fullName,
        subject: `Resultado de tu reporte sobre ${report.targetLabel ?? "una publicación"}`,
        title: "Revisamos tu reporte",
        badge: suspended ? SUSPENDED : KEPT,
        paragraphs: [
          `Gracias por avisarnos. Revisamos tu reporte sobre <strong>${label}</strong>.`,
          suspended ? "Decidimos suspenderlo porque no cumple las reglas de la plataforma." : "Decidimos mantenerlo publicado: con lo revisado no encontramos que incumpla las reglas.",
          reason ? `Motivo: ${esc(reason)}` : null,
        ].filter(Boolean),
        cta: { label: "Ver mis reportes", href: `${env.frontendUrl}/cuenta/panel?tab=reports` },
      }).catch(() => {})
    );
  }
  await Promise.all(tasks);
}

// Apelación aceptada: lo suspendido vuelve a publicarse y ese reporte deja de contar como aviso.
export async function restoreAfterAppeal(report, note) {
  if (report.productId) await prisma.product.update({ where: { id: report.productId }, data: { isActive: true, suspendedAt: null, suspendedReason: null } });
  if (report.customerListingId) {
    const l = await prisma.customerListing.findUnique({ where: { id: report.customerListingId }, select: { images: true } });
    await prisma.customerListing.update({ where: { id: report.customerListingId }, data: { isActive: (l?.images?.length ?? 0) > 0, suspendedAt: null, suspendedReason: null } });
  }
  return prisma.report.update({
    where: { id: report.id },
    data: { status: "RESOLVED_NO_ACTION", appealStatus: "ACCEPTED", appealResolvedAt: new Date(), appealNote: note ?? null, itemDeleteAt: null },
  });
}

// Borra lo suspendido (venció el plazo sin apelar o se rechazó la apelación). El reporte queda como historial.
export async function deleteSuspendedItem(report) {
  if (report.customerListingId) {
    const l = await prisma.customerListing.findUnique({ where: { id: report.customerListingId } });
    if (l?.suspendedAt) {
      await deleteUploadedImages(l.images ?? []);
      await prisma.customerListing.delete({ where: { id: l.id } });
    }
  }
  if (report.productId) {
    const p = await prisma.product.findUnique({ where: { id: report.productId } });
    if (p?.suspendedAt) {
      await deleteUploadedImages(p.images ?? []);
      await prisma.product.delete({ where: { id: p.id } }).catch(async () => {
        // Con pedidos asociados no se puede borrar la fila: queda oculta para siempre.
        await prisma.product.update({ where: { id: p.id }, data: { isActive: false } });
      });
    }
  }
  await prisma.report.update({ where: { id: report.id }, data: { itemDeleteAt: null } });
}

// El admin reactiva la cuenta o la tienda: se limpian los plazos y los avisos anteriores dejan de contar.
export async function clearCustomerFraudBlock(userId) {
  await prisma.user.update({ where: { id: userId }, data: { isSuspended: false, fraudBlockedAt: null, fraudClaimDueAt: null, fraudStrikesResetAt: new Date() } });
}
export async function clearVendorFraudBlock(vendorId) {
  await prisma.vendor.update({
    where: { id: vendorId },
    data: { isBlocked: false, blockReason: null, blockedAt: null, fraudSuspendedAt: null, fraudContactDueAt: null, fraudDeleteAt: null, fraudStrikesResetAt: new Date() },
  });
}

// Elimina una cuenta o tienda sancionada y la pone en la lista negra (antes de anonimizar el correo).
export async function deleteAndBlacklistCustomer(userId, reason, adminId = null) {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  if (!user || user.deletedAt) return;
  await addToBlacklist({ kind: "CUSTOMER", user, reason, addedById: adminId });
  await sendModerationEmail({
    to: user.email,
    fullName: user.fullName,
    subject: "Tu cuenta fue eliminada",
    title: "Cuenta eliminada",
    badge: SUSPENDED,
    paragraphs: [`Tu cuenta se eliminó: ${esc(reason)}`, "No se puede volver a crear una cuenta con estos datos."],
  }).catch(() => {});
  const listings = await prisma.customerListing.findMany({ where: { ownerId: userId }, select: { id: true, images: true } });
  for (const l of listings) {
    await deleteUploadedImages(l.images ?? []);
    await prisma.customerListing.delete({ where: { id: l.id } }).catch(() => {});
  }
  await finalizeUserDeletion(userId, { source: "MODERATION", byId: adminId, reason });
}

export async function deleteAndBlacklistVendor(vendorId, reason, adminId = null) {
  const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, include: { user: true } });
  if (!vendor || vendor.deletedAt) return;
  await addToBlacklist({ kind: "VENDOR", user: vendor.user, vendor, reason, addedById: adminId });
  await sendModerationEmail({
    to: vendor.user?.email,
    fullName: vendor.ownerName ?? vendor.user?.fullName,
    vendorId,
    subject: `Tu tienda ${vendor.companyName} fue eliminada`,
    title: "Tienda eliminada",
    badge: SUSPENDED,
    paragraphs: [`Tu tienda <strong>${esc(vendor.companyName)}</strong> se eliminó: ${esc(reason)}`, "No se puede volver a crear una cuenta o tienda con estos datos."],
  }).catch(() => {});
  await finalizeUserDeletion(vendor.userId, { source: "MODERATION", byId: adminId, reason });
}

// Tarea diaria (fraudReports.job.js): borra lo suspendido sin apelar, elimina cuentas que no reclamaron y avanza las
// tiendas suspendidas (sin contacto a tiempo: suspensión extra; terminada: eliminación y lista negra).
export async function runModerationDeadlines() {
  const now = new Date();
  const m = await getModerationSettings();
  let deleted = 0;
  const expired = await prisma.report.findMany({
    where: { status: "RESOLVED_SUSPENDED", itemDeleteAt: { lt: now }, OR: [{ appealStatus: null }, { appealStatus: "REJECTED" }] },
  });
  for (const r of expired) {
    await deleteSuspendedItem(r);
    deleted++;
  }

  const customers = await prisma.user.findMany({ where: { fraudClaimDueAt: { lt: now }, isSuspended: true, deletedAt: null }, select: { id: true } });
  for (const u of customers) await deleteAndBlacklistCustomer(u.id, "No se recibió reclamo a tiempo tras el bloqueo por reportes de fraude confirmados.");

  const toExtend = await prisma.vendor.findMany({ where: { fraudContactDueAt: { lt: now }, fraudDeleteAt: null, isBlocked: true, deletedAt: null }, include: { user: true } });
  for (const v of toExtend) {
    const end = new Date(now.getTime() + m.vendorSuspensionDays * DAY);
    await prisma.vendor.update({ where: { id: v.id }, data: { fraudDeleteAt: end, blockReason: `Tienda suspendida por fraude: no contactó a soporte a tiempo. Se elimina el ${day(end)}.` } });
    await sendModerationEmail({
      to: v.user?.email,
      fullName: v.ownerName ?? v.user?.fullName,
      vendorId: v.id,
      subject: `Tu tienda ${v.companyName} sigue suspendida`,
      title: "Suspensión extendida",
      badge: SUSPENDED,
      paragraphs: [
        `No recibimos tu contacto a tiempo, así que <strong>${esc(v.companyName)}</strong> seguirá suspendida ${m.vendorSuspensionDays} días.`,
        `Si no se resuelve antes del <strong>${day(end)}</strong>, la tienda se elimina. Contacta a soporte ${supportLine(m)}.`,
      ],
      cta: { label: "Contactar a soporte", href: `${env.frontendUrl}/contacto` },
    }).catch(() => {});
  }

  const vendors = await prisma.vendor.findMany({ where: { fraudDeleteAt: { lt: now }, isBlocked: true, deletedAt: null }, select: { id: true } });
  for (const v of vendors) await deleteAndBlacklistVendor(v.id, "Terminó la suspensión por reportes de fraude confirmados sin que se resolviera el caso.");

  return { deleted, customers: customers.length, extended: toExtend.length, vendors: vendors.length };
}
