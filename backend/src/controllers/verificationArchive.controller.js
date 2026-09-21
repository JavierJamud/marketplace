import { z } from "zod";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { KYC_UPLOAD_DIR } from "./verification.controller.js";
import { ensureVerificationArchive } from "../services/vendorVerification.service.js";

// Bloque 72 (pedido explícito): archivo permanente de la documentación de
// verificación. Bloque 150 (pedido explícito — "debe quedar archivado todo
// el historial de todo lo que la tienda ha enviado... desde que el cliente
// envía la solicitud, y siempre se pueda consultar"): las ramas ya NO se
// crean solo al llegar a VERIFIED — se crean al ENVIAR los documentos
// (archiveVerificationSubmission, vendorVerification.service.js) y se
// completan paso a paso en todo el ciclo (revisión, método de pago,
// comprobante, confirmación, desenlace final), consultables en cualquier
// momento del proceso, no solo al terminar. Acá solo viven las acciones de
// consulta/edición/borrado del admin sobre lo ya archivado.

export async function listVerificationArchive(req, res) {
  const { vendorId } = req.params;
  // Bloque 151: backfill perezoso — una solicitud EN CURSO desde antes del
  // Bloque 150 nunca recibió ninguna rama (solo submitVerification la crea).
  // Se arma acá mismo, justo cuando un admin la va a consultar, en vez de
  // quedar vacía para siempre — ver ensureVerificationArchive.
  await ensureVerificationArchive(vendorId).catch(() => {});
  const [archives, verification] = await Promise.all([
    prisma.verificationArchive.findMany({
      where: { vendorId },
      include: { reviewedBy: { select: { fullName: true, email: true } } },
      orderBy: { archivedAt: "desc" },
    }),
    prisma.verificationRequest.findUnique({ where: { vendorId }, select: { archiveId: true } }),
  ]);
  // Bloque 150: le dice al frontend cuál rama es la del ciclo VIGENTE (en
  // curso o recién cerrado) — esa es la única que nunca se puede eliminar,
  // sin importar si ya terminó en VERIFIED o sigue abierta/rechazada.
  res.json({ archives, currentArchiveId: verification?.archiveId ?? null });
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
// automáticamente". Bloque 150 (revisa el gate original — "no eliminar si
// aún la tienda está verificada"): mirar solo `verificationStatus ===
// VERIFIED` dejó de alcanzar desde que las ramas se crean al ENVIAR
// documentos, no al verificarse — con el criterio viejo, la rama de un
// ciclo EN CURSO (todavía sin verificar, o recién rechazado y esperando que
// el vendedor reenvíe) hubiera quedado borrable, perdiendo evidencia de un
// trámite activo. El gate correcto es "¿es esta la rama que
// VerificationRequest.archiveId apunta ahora mismo?" — esa es siempre la
// del ciclo vigente (en curso, o el más reciente ya cerrado), nunca se
// puede borrar sin importar en qué haya terminado; cualquier rama VIEJA
// (de un ciclo anterior, ya reemplazada por un reenvío) sí es borrable.
export async function deleteVerificationArchive(req, res) {
  const { id } = req.params;
  const existing = await prisma.verificationArchive.findUnique({ where: { id } });
  if (!existing) throw new AppError("Rama de archivo no encontrada.", 404);

  const verification = await prisma.verificationRequest.findUnique({ where: { vendorId: existing.vendorId }, select: { archiveId: true } });
  if (verification?.archiveId === id) {
    throw new AppError("No se puede eliminar: es la rama del ciclo de verificación vigente de la tienda.", 409);
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

  // Bloque 146: "video" sumado. Bloque 150: "proof" sumado (comprobante de
  // pago archivado junto con los documentos de identidad) — mismo criterio
  // que getVerificationFile (verification.controller.js).
  const filename =
    type === "selfie"
      ? archive.selfieUrl
      : type === "idBack"
        ? archive.idPhotoBackUrl
        : type === "video"
          ? archive.selfieVideoUrl
          : type === "proof"
            ? archive.paymentProofUrl
            : archive.idPhotoFrontUrl;
  if (!filename) throw new AppError("Documento no encontrado.", 404);

  let buffer;
  try {
    buffer = await readFile(join(KYC_UPLOAD_DIR, filename));
  } catch {
    throw new AppError("Documento no encontrado.", 404);
  }
  const ext = filename.split(".").pop()?.toLowerCase();
  const contentType =
    { jpg: "image/jpeg", jpeg: "image/jpeg", png: "image/png", webp: "image/webp", pdf: "application/pdf", webm: "video/webm", mp4: "video/mp4" }[ext] ??
    "application/octet-stream";
  res.setHeader("Content-Type", contentType);
  res.send(buffer);
}
