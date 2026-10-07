import { prisma } from "../lib/prisma.js";
import { ensureVerificationArchive } from "./vendorVerification.service.js";

// Bloque 277 (pedido explícito — "los datos del representante de la tienda son solo para los
// administradores: en la sección Tiendas del admin un botón con la ficha del responsable, con sus
// fotos, su récord, las notas puestas a la tienda y los incumplimientos"): ficha completa del
// responsable de una tienda. Solo la leen el panel del admin y el asistente de negocio del admin.
// Nunca se expone fuera de rutas de administrador. Las fotos no viajan aquí: se piden aparte, como
// archivos privados, al endpoint del archivo de verificación.
export async function getRepresentativeFile(vendorId) {
  const vendor = await prisma.vendor.findUnique({
    where: { id: vendorId },
    select: {
      id: true, companyName: true, slug: true, planType: true, verificationStatus: true, status: true, createdAt: true, ownerName: true, whatsapp: true, email: true, companyAddress: true,
      isBlocked: true, blockReason: true, blockedAt: true, suspendedAt: true, suspensionReason: true, reactivatedAt: true, reactivationReason: true, adminDeletionRequestedAt: true, deletedAt: true,
      user: { select: { fullName: true, email: true, phone: true, lastLoginAt: true, createdAt: true } },
    },
  });
  if (!vendor) return null;
  // Una tienda anterior al archivo de verificación recibe su rama al consultarla.
  await ensureVerificationArchive(vendorId).catch(() => {});
  const [archives, request, reports, statusLog, verificationLog, changeRequests] = await Promise.all([
    prisma.verificationArchive.findMany({ where: { vendorId }, orderBy: { archivedAt: "desc" }, include: { reviewedBy: { select: { fullName: true } } } }),
    prisma.verificationRequest.findUnique({ where: { vendorId }, select: { notes: true, reviewedAt: true, archiveId: true } }),
    prisma.report.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: 30, select: { id: true, status: true, message: true, createdAt: true, resolvedAt: true, resolutionNote: true, autoResolved: true, reporter: { select: { fullName: true } }, product: { select: { name: true } } } }),
    prisma.vendorStatusLog.findMany({ where: { vendorId }, orderBy: { at: "desc" }, take: 30, select: { fromStatus: true, toStatus: true, reason: true, at: true, byAdmin: { select: { fullName: true } } } }),
    prisma.verificationStatusLog.findMany({ where: { vendorId }, orderBy: { at: "desc" }, take: 30, select: { fromStatus: true, toStatus: true, reason: true, source: true, at: true, actor: { select: { fullName: true } } } }),
    prisma.vendorChangeRequest.findMany({ where: { vendorId }, orderBy: { createdAt: "desc" }, take: 20, select: { status: true, reason: true, adminNotes: true, createdAt: true, reviewedAt: true } }),
  ]);
  return { vendor, archives, currentArchiveId: request?.archiveId ?? null, requestNotes: request?.notes ?? null, reports, statusLog, verificationLog, changeRequests };
}
