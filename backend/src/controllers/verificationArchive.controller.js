import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { KYC_UPLOAD_DIR } from "./verification.controller.js";

// Bloque 72 (pedido explícito): archivo permanente de la documentación que
// llevó a cada verificación exitosa — las filas las crea sola
// transitionVendorVerification() (vendorVerification.service.js) al llegar a
// VERIFIED viniendo de PENDING_PAYMENT; acá solo viven las acciones de
// consulta/edición/borrado del admin sobre lo ya archivado.

export async function listVerificationArchive(req, res) {
  const { vendorId } = req.params;
  const archives = await prisma.verificationArchive.findMany({
    where: { vendorId },
    include: { reviewedBy: { select: { fullName: true, email: true } } },
    orderBy: { archivedAt: "desc" },
  });
  res.json({ archives });
}

const updateArchiveSchema = z.object({
  companyName: z.string().min(1).optional(),
  ownerName: z.string().optional().nullable(),
  ownerIdNumber: z.string().optional().nullable(),
  companyTaxId: z.string().optional().nullable(),
  companyAddress: z.string().optional().nullable(),
  description: z.string().optional().nullable(),
  fullName: z.string().optional().nullable(),
  idNumber: z.string().optional().nullable(),
  registrationCountryName: z.string().optional().nullable(),
  legalProvinceName: z.string().optional().nullable(),
  legalMunicipalityName: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
});

// Editable — corregir un dato mal cargado no debe exigir borrar toda la
// rama y esperar una nueva verificación. Las fotos NUNCA se editan acá (son
// la evidencia real) — solo se consultan/descargan.
export async function updateVerificationArchive(req, res) {
  const { id } = req.params;
  const data = updateArchiveSchema.parse(req.body);
  const existing = await prisma.verificationArchive.findUnique({ where: { id } });
  if (!existing) throw new AppError("Rama de archivo no encontrada.", 404);

  const updated = await prisma.verificationArchive.update({ where: { id }, data });
  res.json({ archive: updated });
}

// Bloque 72 (pedido explícito): "se podrá eliminar manualmente pero no
// automáticamente" + "no eliminar si aún la tienda está verificada" — el
// gate mira el estado ACTUAL de la tienda (no el de esta rama puntual): si
// la tienda sigue VERIFIED hoy, ninguna de sus ramas se puede borrar, ni
// siquiera una vieja. Recién si la tienda ya no está verificada, el admin
// puede borrar ramas individuales a mano.
export async function deleteVerificationArchive(req, res) {
  const { id } = req.params;
  const existing = await prisma.verificationArchive.findUnique({ where: { id }, include: { vendor: { select: { verificationStatus: true } } } });
  if (!existing) throw new AppError("Rama de archivo no encontrada.", 404);

  if (existing.vendor.verificationStatus === "VERIFIED") {
    throw new AppError("No se puede eliminar: la tienda sigue verificada. Solo se puede borrar si pierde la verificación.", 409);
  }

  await prisma.verificationArchive.delete({ where: { id } });
  res.json({ ok: true });
}

// Mismo mecanismo que getVerificationFile (verification.controller.js) pero
// leyendo del snapshot archivado, no de la VerificationRequest en curso —
// necesario porque, tras una re-verificación, esos campos ya apuntan a
// archivos NUEVOS y dejarían de coincidir con los de una rama vieja.
export async function getVerificationArchiveFile(req, res) {
  const { id, type } = req.params;
  const archive = await prisma.verificationArchive.findUnique({ where: { id } });
  if (!archive) throw new AppError("No encontrado.", 404);

  const filename =
    type === "selfie" ? archive.selfieUrl : type === "idBack" ? archive.idPhotoBackUrl : archive.idPhotoFrontUrl;
  if (!filename) throw new AppError("Documento no encontrado.", 404);

  let buffer;
  try {
    buffer = await readFile(join(KYC_UPLOAD_DIR, filename));
  } catch {
    throw new AppError("Documento no encontrado.", 404);
  }
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType = { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf" }[ext] ?? "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.send(buffer);
}
