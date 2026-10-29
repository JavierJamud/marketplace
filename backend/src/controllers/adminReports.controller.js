import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyEvidenceRequested } from "../services/fraudReportNotify.service.js";
import {
  getModerationSettings,
  suspendReportTarget,
  applyStrikes,
  notifyReportOutcome,
  restoreAfterAppeal,
  deleteSuspendedItem,
  countCustomerStrikes,
  countVendorStrikes,
  clearCustomerFraudBlock,
  clearVendorFraudBlock,
  deleteAndBlacklistCustomer,
  deleteAndBlacklistVendor,
} from "../lib/moderation.js";
import { sendModerationEmail } from "../lib/email.js";
import { esc } from "../templates/_shared.js";
import { env } from "../config/env.js";

// Reportes de producto, tienda o venta rápida, y la moderación que sigue (ver lib/moderation.js para las reglas):
// pedir evidencia, mantener o suspender (con correo al dueño y a quien reportó), apelaciones, cuentas y tiendas
// sancionadas por avisos acumulados y la lista negra.

const REPORT_INCLUDE = {
  reporter: { select: { id: true, fullName: true, email: true } },
  product: { select: { id: true, name: true, slug: true, vendor: { select: { id: true, companyName: true, slug: true } } } },
  vendor: { select: { id: true, companyName: true, slug: true } },
  customerListing: { select: { id: true, name: true, owner: { select: { id: true, fullName: true, email: true } } } },
  resolvedBy: { select: { id: true, fullName: true } },
};

// Abiertos = el admin todavía puede decidir. Toda decisión exige que el reporte siga en uno de estos estados AL GUARDARLA
// (ver claimReport), no solo al leerlo.
const OPEN_STATUSES = ["PENDING", "EVIDENCE_REQUESTED"];
// "Se mantuvo" son dos estados en la base: DISMISSED (sin pedir evidencia) y RESOLVED_NO_ACTION (después de pedirla, o
// apelación aceptada). El filtro los junta; DISMISSED también, porque es lo que manda el botón "Se mantuvieron" del panel.
const KEPT_STATUSES = ["DISMISSED", "RESOLVED_NO_ACTION"];
const listQuerySchema = z.object({
  status: z
    .enum(["APPEALS", "KEPT", "PENDING", "EVIDENCE_REQUESTED", "RESOLVED_SUSPENDED", "RESOLVED_NO_ACTION", "DISMISSED"], { errorMap: () => ({ message: "Filtro de estado no válido." }) })
    .optional()
    .or(z.literal("").transform(() => undefined)),
});

export async function listFraudReports(req, res) {
  const { status } = listQuerySchema.parse(req.query);
  const where =
    status === "APPEALS"
      ? { appealStatus: "PENDING" }
      : status === "KEPT" || status === "DISMISSED"
        ? { status: { in: KEPT_STATUSES } }
        : status
          ? { status }
          : undefined;
  const reports = await prisma.report.findMany({ where, include: REPORT_INCLUDE, orderBy: { createdAt: "desc" }, take: 300 });
  res.json({ reports });
}

// Insignia del menú: reportes abiertos y apelaciones sin revisar.
export async function getFraudReportsPendingCount(_req, res) {
  const count = await prisma.report.count({ where: { OR: [{ status: { in: ["PENDING", "EVIDENCE_REQUESTED"] } }, { appealStatus: "PENDING" }] } });
  res.json({ count });
}

// Detalle para decidir: quién reportó (con sus datos y cuántos reportes hizo), el dueño (con sus avisos y el límite),
// todas las imágenes (reporte, evidencia y apelación) y la analítica del producto o la venta rápida.
export async function getFraudReportDetail(req, res) {
  const report = await prisma.report.findUnique({ where: { id: req.params.id }, include: REPORT_INCLUDE });
  if (!report) throw new AppError("Reporte no encontrado.", 404);
  const m = await getModerationSettings();

  const [reporter, owner, vendor, otherReports] = await Promise.all([
    prisma.user.findUnique({
      where: { id: report.reporterId },
      select: { id: true, fullName: true, email: true, phone: true, role: true, createdAt: true, lastLoginAt: true, _count: { select: { reportsMade: true } } },
    }),
    report.targetOwnerId ? prisma.user.findUnique({ where: { id: report.targetOwnerId }, select: { id: true, fullName: true, email: true, phone: true, createdAt: true, isSuspended: true, fraudBlockedAt: true, fraudClaimDueAt: true, deletedAt: true } }) : null,
    report.targetVendorId ? prisma.vendor.findUnique({ where: { id: report.targetVendorId }, select: { id: true, companyName: true, slug: true, whatsapp: true, isBlocked: true, fraudSuspendedAt: true, fraudContactDueAt: true, fraudDeleteAt: true, verificationStatus: true } }) : null,
    prisma.report.count({
      where: { id: { not: report.id }, OR: [report.targetVendorId ? { targetVendorId: report.targetVendorId } : { targetOwnerId: report.targetOwnerId ?? "-" }] },
    }),
  ]);

  let analytics = null;
  if (report.customerListingId) {
    const l = await prisma.customerListing.findUnique({
      where: { id: report.customerListingId },
      select: { name: true, price: true, currency: true, images: true, createdAt: true, activatedAt: true, isActive: true, isSold: true, viewCount: true, contactClickCount: true, suspendedAt: true, publicVisibleUntil: true },
    });
    if (l) analytics = { kind: "LISTING", ...l };
  } else if (report.productId) {
    const p = await prisma.product.findUnique({
      where: { id: report.productId },
      select: { name: true, price: true, currency: true, images: true, createdAt: true, isActive: true, viewCount: true, clickCount: true, searchClickCount: true, salesCount: true, rating: true, reviewCount: true, suspendedAt: true },
    });
    if (p) {
      const since = new Date(Date.now() - 30 * 86400000);
      const orders30 = await prisma.orderItem.count({ where: { productId: report.productId, order: { createdAt: { gte: since } } } });
      analytics = { kind: "PRODUCT", ...p, orders30 };
    }
  }

  const strikes = report.targetVendorId ? await countVendorStrikes(report.targetVendorId) : report.targetOwnerId ? await countCustomerStrikes(report.targetOwnerId) : 0;
  res.json({
    report,
    reporter,
    owner,
    vendor,
    otherReports,
    strikes: { count: strikes, limit: report.targetVendorId ? m.vendorStrikeLimit : m.customerStrikeLimit, kind: report.targetVendorId ? "VENDOR" : "CUSTOMER" },
    analytics,
  });
}

// Guarda la decisión solo si el reporte sigue como se leyó (`expected`): dos admins, dos pestañas o la tarea diaria
// pueden leer el mismo reporte abierto a la vez, y sin esta condición los dos aplicaban la suspensión, el aviso
// acumulado y los correos. updateMany con la condición es atómico en la base: solo uno obtiene count 1.
async function claimReport(id, expected, data) {
  const { count } = await prisma.report.updateMany({ where: { id, ...expected }, data });
  return count === 1;
}

export async function requestEvidence(req, res) {
  const { id } = req.params;
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) throw new AppError("Reporte no encontrado.", 404);
  if (report.status !== "PENDING") throw new AppError("Este reporte ya no está pendiente.", 400);

  const { evidenceDays } = await getModerationSettings();
  const now = new Date();
  const claimed = await claimReport(id, { status: "PENDING" }, { status: "EVIDENCE_REQUESTED", evidenceRequestedAt: now, evidenceDueAt: new Date(now.getTime() + evidenceDays * 86400000) });
  if (!claimed) throw new AppError("Otra persona ya actuó sobre este reporte. Recarga para ver cómo quedó.", 409);
  const updated = await prisma.report.findUnique({ where: { id } });
  await notifyEvidenceRequested(updated, evidenceDays);
  res.json({ report: updated });
}

const decisionSchema = z.object({ resolutionNote: z.string().trim().min(5, "Escribe el motivo (mínimo 5 caracteres): se envía al dueño y a quien reportó.").max(1000) });

// Mantener: no se toca nada y se avisa al dueño y a quien reportó, con el motivo.
export async function dismissFraudReport(req, res) {
  const { resolutionNote } = decisionSchema.parse(req.body ?? {});
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report) throw new AppError("Reporte no encontrado.", 404);
  if (!OPEN_STATUSES.includes(report.status)) throw new AppError("Este reporte ya fue resuelto.", 400);

  // El estado final depende del leído (con evidencia pedida queda RESOLVED_NO_ACTION), así que se exige ese mismo estado.
  const claimed = await claimReport(report.id, { status: report.status }, {
    status: report.status === "EVIDENCE_REQUESTED" ? "RESOLVED_NO_ACTION" : "DISMISSED",
    resolvedById: req.user.id,
    resolvedAt: new Date(),
    resolutionNote,
  });
  if (!claimed) throw new AppError("Este reporte ya fue resuelto. Recarga para ver cómo quedó.", 409);
  const updated = await prisma.report.findUnique({ where: { id: report.id } });
  await notifyReportOutcome(updated, { suspended: false, reason: resolutionNote });
  res.json({ report: updated });
}

// Confirmar y suspender. Lo usa también la tarea diaria cuando vence el plazo de evidencia sin respuesta.
// Primero se reclama el reporte (sigue abierto y, si es la tarea diaria, el dueño no mandó evidencia mientras tanto);
// recién después se suspende y se cuentan los avisos, así una decisión doble no los aplica dos veces. Si otra decisión
// ganó: al admin se le responde 409 y la tarea diaria lo salta (devuelve null) sin cortar el resto de su lista.
export async function confirmAndSuspend(report, { reason, adminId = null, autoResolved = false }) {
  const claimed = await claimReport(
    report.id,
    { status: { in: OPEN_STATUSES }, ...(autoResolved ? { evidenceSentAt: null } : {}) },
    { status: "RESOLVED_SUSPENDED", resolvedById: adminId, resolvedAt: new Date(), resolutionNote: reason, autoResolved }
  );
  if (!claimed) {
    if (autoResolved) return null;
    throw new AppError("Este reporte ya fue resuelto. Recarga para ver cómo quedó.", 409);
  }
  let deleteAt;
  try {
    deleteAt = await suspendReportTarget(report, reason);
  } catch (err) {
    // No se pudo suspender (p. ej. el producto se borró justo antes): el reporte vuelve a quedar abierto como estaba,
    // para que la decisión se pueda repetir.
    await prisma.report
      .update({ where: { id: report.id }, data: { status: report.status, resolvedById: report.resolvedById, resolvedAt: report.resolvedAt, resolutionNote: report.resolutionNote, autoResolved: report.autoResolved } })
      .catch(() => {});
    throw err;
  }
  const updated = await prisma.report.update({ where: { id: report.id }, data: { itemDeleteAt: deleteAt } });
  await notifyReportOutcome(updated, { suspended: true, reason, deleteAt });
  const strikes = await applyStrikes(updated);
  return { report: updated, strikes };
}

export async function resolveFraudReport(req, res) {
  const { resolutionNote } = decisionSchema.parse(req.body);
  const report = await prisma.report.findUnique({ where: { id: req.params.id } });
  if (!report) throw new AppError("Reporte no encontrado.", 404);
  if (!OPEN_STATUSES.includes(report.status)) throw new AppError("Este reporte ya fue resuelto.", 400);
  res.json(await confirmAndSuspend(report, { reason: resolutionNote, adminId: req.user.id }));
}

const appealDecisionSchema = z.object({ note: z.string().trim().min(5, "Escribe el motivo (mínimo 5 caracteres): se envía al dueño.").max(1000) });

async function appealReport(id) {
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) throw new AppError("Reporte no encontrado.", 404);
  if (report.appealStatus !== "PENDING") throw new AppError("No hay una apelación pendiente en este reporte.", 400);
  return report;
}

async function emailAppealResult(report, accepted, note) {
  const owner = report.targetOwnerId ? await prisma.user.findUnique({ where: { id: report.targetOwnerId } }) : null;
  if (!owner) return;
  await sendModerationEmail({
    to: owner.email,
    fullName: owner.fullName,
    vendorId: report.targetVendorId,
    subject: accepted ? `Volvimos a publicar tu ${report.targetLabel ?? "publicación"}` : `Revisamos tu apelación sobre ${report.targetLabel ?? "tu publicación"}`,
    title: accepted ? "Apelación aceptada" : "Apelación rechazada",
    badge: accepted ? { label: "Publicado de nuevo", color: "#0CAE53" } : { label: "Eliminado", color: "#ba1a1a" },
    paragraphs: [
      accepted
        ? `Revisamos tu evidencia y tu <strong>${esc(report.targetLabel ?? "publicación")}</strong> vuelve a estar publicada.`
        : `Revisamos tu evidencia, pero no fue suficiente: tu <strong>${esc(report.targetLabel ?? "publicación")}</strong> se eliminó.`,
      `Motivo: ${esc(note)}`,
    ],
    cta: { label: "Ir a mi panel", href: `${env.frontendUrl}${report.targetVendorId ? "/vendedor/reportes" : "/cuenta/panel?tab=reports"}` },
  }).catch(() => {});
}

// Misma idea que claimReport: la apelación se marca decidida solo si sigue PENDING al guardar, así aceptar y rechazar
// (o dos admins) no pueden correr los dos. Si lo que sigue falla, vuelve a PENDING para poder decidir de nuevo.
async function claimAppeal(report, decision, note) {
  const claimed = await claimReport(report.id, { appealStatus: "PENDING" }, { appealStatus: decision, appealResolvedAt: new Date(), appealNote: note });
  if (!claimed) throw new AppError("Esta apelación ya fue decidida. Recarga para ver cómo quedó.", 409);
}
const reopenAppeal = (report) =>
  prisma.report.update({ where: { id: report.id }, data: { appealStatus: "PENDING", appealResolvedAt: report.appealResolvedAt, appealNote: report.appealNote } }).catch(() => {});

export async function acceptAppeal(req, res) {
  const { note } = appealDecisionSchema.parse(req.body);
  const report = await appealReport(req.params.id);
  await claimAppeal(report, "ACCEPTED", note);
  let updated;
  try {
    updated = await restoreAfterAppeal(report, note);
  } catch (err) {
    await reopenAppeal(report);
    throw err;
  }
  await emailAppealResult(report, true, note);
  res.json({ report: updated });
}

export async function rejectAppeal(req, res) {
  const { note } = appealDecisionSchema.parse(req.body);
  const report = await appealReport(req.params.id);
  await claimAppeal(report, "REJECTED", note);
  try {
    await deleteSuspendedItem(report);
  } catch (err) {
    await reopenAppeal(report);
    throw err;
  }
  await emailAppealResult(report, false, note);
  res.json({ ok: true });
}

// --- Cuentas y tiendas sancionadas por avisos -------------------------------------------------------------------------

export async function listSanctioned(_req, res) {
  const [customers, vendors] = await Promise.all([
    prisma.user.findMany({
      where: { fraudBlockedAt: { not: null }, deletedAt: null },
      select: { id: true, fullName: true, email: true, phone: true, fraudBlockedAt: true, fraudClaimDueAt: true },
      orderBy: { fraudBlockedAt: "desc" },
    }),
    prisma.vendor.findMany({
      where: { fraudSuspendedAt: { not: null }, deletedAt: null },
      select: { id: true, companyName: true, slug: true, whatsapp: true, fraudSuspendedAt: true, fraudContactDueAt: true, fraudDeleteAt: true, user: { select: { email: true, fullName: true } } },
      orderBy: { fraudSuspendedAt: "desc" },
    }),
  ]);
  res.json({ customers, vendors });
}

const reasonSchema = z.object({ reason: z.string().trim().min(5, "Escribe el motivo (mínimo 5 caracteres).").max(1000) });

// Reactivar: se levanta el bloqueo, se limpian los plazos y los avisos anteriores dejan de contar.
export async function reactivateSanctionedCustomer(req, res) {
  const { reason } = reasonSchema.parse(req.body);
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user?.fraudBlockedAt) throw new AppError("Esta cuenta no está bloqueada por avisos.", 400);
  await clearCustomerFraudBlock(user.id);
  await sendModerationEmail({ to: user.email, fullName: user.fullName, subject: "Tu cuenta está activa de nuevo", title: "Cuenta reactivada", badge: { label: "Activa", color: "#0CAE53" }, paragraphs: [`Revisamos tu caso y tu cuenta vuelve a estar activa. ${esc(reason)}`] }).catch(() => {});
  res.json({ ok: true });
}

export async function reactivateSanctionedVendor(req, res) {
  const { reason } = reasonSchema.parse(req.body);
  const vendor = await prisma.vendor.findUnique({ where: { id: req.params.id }, include: { user: true } });
  if (!vendor?.fraudSuspendedAt) throw new AppError("Esta tienda no está suspendida por avisos.", 400);
  await clearVendorFraudBlock(vendor.id);
  await sendModerationEmail({ to: vendor.user?.email, fullName: vendor.ownerName ?? vendor.user?.fullName, vendorId: vendor.id, subject: `Tu tienda ${vendor.companyName} está activa de nuevo`, title: "Tienda reactivada", badge: { label: "Activa", color: "#0CAE53" }, paragraphs: [`Revisamos tu caso y <strong>${esc(vendor.companyName)}</strong> vuelve a estar activa. ${esc(reason)}`] }).catch(() => {});
  res.json({ ok: true });
}

// Ya contactó a soporte: se detiene el plazo (no se elimina sola) mientras el admin revisa.
export async function pauseSanctionDeadline(req, res) {
  const { kind, id } = req.params;
  if (kind === "customers") await prisma.user.update({ where: { id }, data: { fraudClaimDueAt: null } });
  else if (kind === "vendors") await prisma.vendor.update({ where: { id }, data: { fraudContactDueAt: null, fraudDeleteAt: null } });
  else throw new AppError("Tipo no válido.", 400);
  res.json({ ok: true });
}

export async function deleteSanctionedNow(req, res) {
  const { reason } = reasonSchema.parse(req.body);
  const { kind, id } = req.params;
  if (kind === "customers") await deleteAndBlacklistCustomer(id, reason, req.user.id);
  else if (kind === "vendors") await deleteAndBlacklistVendor(id, reason, req.user.id);
  else throw new AppError("Tipo no válido.", 400);
  res.json({ ok: true });
}

// --- Lista negra ------------------------------------------------------------------------------------------------------

export async function listBlacklist(req, res) {
  const q = String(req.query.q ?? "").trim();
  const entries = await prisma.blacklistEntry.findMany({
    where: {
      removedAt: req.query.removed === "1" ? { not: null } : null,
      ...(q
        ? { OR: ["email", "phone", "idNumber", "fullName", "storeName"].map((f) => ({ [f]: { contains: q, mode: "insensitive" } })) }
        : {}),
    },
    orderBy: { createdAt: "desc" },
    take: 300,
  });
  res.json({ entries });
}

export async function removeFromBlacklist(req, res) {
  const entry = await prisma.blacklistEntry.findUnique({ where: { id: req.params.id } });
  if (!entry || entry.removedAt) throw new AppError("No está en la lista negra.", 404);
  await prisma.blacklistEntry.update({ where: { id: entry.id }, data: { removedAt: new Date(), removedById: req.user.id } });
  res.json({ ok: true });
}
