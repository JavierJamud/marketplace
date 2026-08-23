import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyEvidenceRequested, notifyDismissed, notifySuspended } from "../services/fraudReportNotify.service.js";

// Feature B (pedido explícito): acciones de admin sobre un reporte de
// fraude. No reimplementa suspender/editar/eliminar producto/tienda — para
// eso ya existen los endpoints de adminProducts.controller.js/
// admin.controller.js; acá solo vive lo propio del reporte (pedir
// evidencia, cerrar sin acción, confirmar fraude) más la consecuencia
// automática mínima que pidió el usuario cuando se confirma fraude.

const REPORT_INCLUDE = {
  reporter: { select: { id: true, fullName: true, email: true } },
  product: { select: { id: true, name: true, slug: true, vendor: { select: { id: true, companyName: true, slug: true } } } },
  vendor: { select: { id: true, companyName: true, slug: true } },
  customerListing: { select: { id: true, name: true, owner: { select: { id: true, fullName: true, email: true } } } },
  resolvedBy: { select: { id: true, fullName: true } },
};

export async function listFraudReports(req, res) {
  const { status } = req.query;
  const reports = await prisma.report.findMany({
    where: status ? { status: String(status) } : undefined,
    include: REPORT_INCLUDE,
    orderBy: { createdAt: "desc" },
  });
  res.json({ reports });
}

// Mismo criterio que getUnresolvedErrorCount (errorLogs.controller.js) —
// badge de la campanita/nav del admin, consumido con refetchInterval corto.
export async function getFraudReportsPendingCount(_req, res) {
  const count = await prisma.report.count({ where: { status: { in: ["PENDING", "EVIDENCE_REQUESTED"] } } });
  res.json({ count });
}

async function getDeadlineDays() {
  const settings = await prisma.siteSettings.findFirst({ select: { fraudReportEvidenceDeadlineDays: true } });
  return settings?.fraudReportEvidenceDeadlineDays ?? 5;
}

export async function requestEvidence(req, res) {
  const { id } = req.params;
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) throw new AppError("Reporte no encontrado.", 404);
  if (report.status !== "PENDING") throw new AppError("Este reporte ya no está pendiente.", 400);

  const deadlineDays = await getDeadlineDays();
  const now = new Date();
  const updated = await prisma.report.update({
    where: { id },
    data: {
      status: "EVIDENCE_REQUESTED",
      evidenceRequestedAt: now,
      evidenceDueAt: new Date(now.getTime() + deadlineDays * 86400000),
    },
  });
  await notifyEvidenceRequested(updated, deadlineDays);
  res.json({ report: updated });
}

const dismissSchema = z.object({ resolutionNote: z.string().trim().max(500).optional() });

// Cierra sin tomar ninguna acción — desde PENDING (el admin lo descarta sin
// pedir evidencia, reporte inválido a primera vista) queda DISMISSED; desde
// EVIDENCE_REQUESTED (el reportado ya respondió y su explicación convence)
// queda RESOLVED_NO_ACTION. Mismo endpoint, el estado de origen decide cuál.
export async function dismissFraudReport(req, res) {
  const { id } = req.params;
  const { resolutionNote } = dismissSchema.parse(req.body ?? {});
  const report = await prisma.report.findUnique({ where: { id } });
  if (!report) throw new AppError("Reporte no encontrado.", 404);
  if (!["PENDING", "EVIDENCE_REQUESTED"].includes(report.status)) {
    throw new AppError("Este reporte ya fue resuelto.", 400);
  }

  const finalStatus = report.status === "EVIDENCE_REQUESTED" ? "RESOLVED_NO_ACTION" : "DISMISSED";
  const updated = await prisma.report.update({
    where: { id },
    data: { status: finalStatus, resolvedById: req.user.id, resolvedAt: new Date(), resolutionNote: resolutionNote || null },
  });
  await notifyDismissed(updated);
  res.json({ report: updated });
}

const resolveSchema = z.object({ resolutionNote: z.string().trim().min(5, "Escribe un motivo de al menos 5 caracteres.") });

// Confirma el fraude y aplica la consecuencia mínima que pidió el usuario,
// una por tipo de objetivo — reusa los campos que YA existen para
// suspender (nunca borra nada de verdad, ver Vendor.isBlocked/Product.isActive
// y el criterio de "no reimplementar" del comentario de arriba).
export async function resolveFraudReport(req, res) {
  const { id } = req.params;
  const { resolutionNote } = resolveSchema.parse(req.body);
  const report = await prisma.report.findUnique({
    where: { id },
    include: { customerListing: { select: { ownerId: true } } },
  });
  if (!report) throw new AppError("Reporte no encontrado.", 404);
  if (!["PENDING", "EVIDENCE_REQUESTED"].includes(report.status)) {
    throw new AppError("Este reporte ya fue resuelto.", 400);
  }

  const reason = `Fraude confirmado por reporte de un cliente: ${resolutionNote}`;
  if (report.productId) {
    await prisma.product.update({ where: { id: report.productId }, data: { isActive: false } });
  } else if (report.vendorId) {
    await prisma.vendor.update({ where: { id: report.vendorId }, data: { isBlocked: true, blockReason: reason, blockedAt: new Date() } });
  } else {
    await prisma.$transaction([
      prisma.customerListing.update({ where: { id: report.customerListingId }, data: { isActive: false } }),
      prisma.user.update({ where: { id: report.customerListing.ownerId }, data: { isSuspended: true } }),
    ]);
  }

  const updated = await prisma.report.update({
    where: { id },
    data: { status: "RESOLVED_SUSPENDED", resolvedById: req.user.id, resolvedAt: new Date(), resolutionNote },
  });
  await notifySuspended(updated, reason);
  res.json({ report: updated });
}
