import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Feature B (pedido explícito): reportes de fraude sobre producto/tienda/
// venta rápida — patrón "exactamente uno de estos 3 campos" (mismo criterio
// que favorites.controller.js, extendido a customerListingId). No
// reimplementa suspender/editar/eliminar: eso sigue viviendo en los
// endpoints admin que ya existen sobre Product/Vendor, y los de
// CustomerListing (Feature A) — acá solo vive el ciclo del reporte en sí
// (crear, pedir evidencia, responder, resolver), ver adminReports.controller.js
// y fraudReports.job.js para el resto del flujo.

const __dirname = dirname(fileURLToPath(import.meta.url));
// Pública por diseño (igual que las fotos de reseña) — el admin necesita
// poder abrir el link directo desde AdminFraudReports.jsx.
export const REPORT_UPLOAD_DIR = join(__dirname, "..", "..", "uploads", "reports");

const createReportSchema = z
  .object({
    productId: z.string().min(1).optional(),
    vendorId: z.string().min(1).optional(),
    customerListingId: z.string().min(1).optional(),
    message: z.string().trim().min(10, "Contanos qué pasó (mínimo 10 caracteres)."),
  })
  .refine((d) => [d.productId, d.vendorId, d.customerListingId].filter(Boolean).length === 1, {
    message: "Manda productId, vendorId o customerListingId, exactamente uno de los tres.",
  });

// Resuelve el objetivo de un reporte (a partir de los 3 ids, tanto los que
// vienen del body al crear como los ya guardados en una fila Report) al
// USER real detrás — quien recibe el aviso y puede mandar evidencia — más
// el "kind" (VENDOR si hay una tienda de por medio, sea directa o vía
// producto; CUSTOMER_LISTING si no). Un solo resolver para las 3 ramas,
// reusado por createReport (guard de auto-reporte/duplicado),
// submitEvidence (verificar quién puede responder) y
// fraudReportNotify.service.js (a quién avisar).
export async function resolveReportTarget({ productId, vendorId, customerListingId }) {
  if (productId) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      include: { vendor: { include: { user: true } } },
    });
    if (!product) throw new AppError("Producto no encontrado.", 404);
    return { field: "productId", kind: "VENDOR", vendorId: product.vendor.id, user: product.vendor.user, label: `producto "${product.name}"` };
  }
  if (vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: vendorId }, include: { user: true } });
    if (!vendor) throw new AppError("Tienda no encontrada.", 404);
    return { field: "vendorId", kind: "VENDOR", vendorId: vendor.id, user: vendor.user, label: `tienda "${vendor.companyName}"` };
  }
  const listing = await prisma.customerListing.findUnique({ where: { id: customerListingId }, include: { owner: true } });
  if (!listing) throw new AppError("Anuncio no encontrado.", 404);
  return { field: "customerListingId", kind: "CUSTOMER_LISTING", vendorId: null, user: listing.owner, label: `anuncio "${listing.name}"` };
}

// Reportes donde el usuario logueado es el REPORTADO (no el que reportó) —
// un solo endpoint para las 2 superficies de FB-8: VendorFraudReports.jsx
// (vendedor, directo o vía uno de sus productos) y el banner de la tab
// "Venta rápida" en CustomerPanel.jsx (dueño de un CustomerListing). El
// `OR` cubre las 3 formas reales de ser el reportado, mismo criterio que
// resolveReportTarget de arriba pero en sentido inverso (buscar POR
// userId en vez de resolver un userId A PARTIR de ids del reporte).
export async function listMyReportsAgainstMe(req, res) {
  const reports = await prisma.report.findMany({
    where: {
      OR: [
        { vendor: { userId: req.user.id } },
        { product: { vendor: { userId: req.user.id } } },
        { customerListing: { ownerId: req.user.id } },
      ],
    },
    include: {
      product: { select: { name: true, slug: true, vendor: { select: { slug: true } } } },
      vendor: { select: { companyName: true, slug: true } },
      customerListing: { select: { name: true } },
    },
    orderBy: { createdAt: "desc" },
  });
  res.json({ reports });
}

export async function createReport(req, res) {
  try {
    if (!req.file) throw new AppError("La captura de pantalla es obligatoria.", 400);
    const data = createReportSchema.parse(req.body);
    const target = await resolveReportTarget(data);

    if (target.user.id === req.user.id) {
      throw new AppError(`No puedes reportar tu propio ${target.label}.`, 400);
    }

    const existing = await prisma.report.findFirst({
      where: { [target.field]: data[target.field], status: { in: ["PENDING", "EVIDENCE_REQUESTED"] } },
    });
    if (existing) throw new AppError("Este objetivo ya tiene un reporte en revisión — el admin lo está evaluando.", 409);

    const report = await prisma.report.create({
      data: {
        reporterId: req.user.id,
        productId: data.productId ?? null,
        vendorId: data.vendorId ?? null,
        customerListingId: data.customerListingId ?? null,
        screenshotUrl: `/uploads/reports/${req.file.filename}`,
        message: data.message,
      },
    });
    res.status(201).json({ report });
  } catch (err) {
    // Igual criterio que reviews.controller.js/createReview: Multer ya
    // escribió el archivo a disco antes de que corriera este handler — si
    // algo falla después (validación, auto-reporte, duplicado, objetivo
    // inexistente) no debe quedar huérfano.
    if (req.file) unlink(join(REPORT_UPLOAD_DIR, req.file.filename)).catch(() => {});
    throw err;
  }
}

const submitEvidenceSchema = z.object({
  evidenceMessage: z.string().trim().min(10, "Contanos qué pasó (mínimo 10 caracteres)."),
});

// Respuesta del reportado (pedido explícito): "si el cliente envía evidencia
// de que su producto/tienda es real, no se toma ninguna acción" — esto solo
// GUARDA la respuesta, la decisión final (resolver/suspender) sigue siendo
// del admin (ver adminReports.controller.js), salvo que el plazo venza
// primero (ver fraudReports.job.js). Fotos opcionales — el mensaje es lo
// único realmente obligatorio para poder responder.
export async function submitEvidence(req, res) {
  try {
    const { id } = req.params;
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) throw new AppError("Reporte no encontrado.", 404);
    if (report.status !== "EVIDENCE_REQUESTED") {
      throw new AppError("Este reporte no está esperando evidencia en este momento.", 400);
    }

    const target = await resolveReportTarget(report);
    if (target.user.id !== req.user.id) {
      throw new AppError("No tienes permiso para responder a este reporte.", 403);
    }

    const data = submitEvidenceSchema.parse(req.body);
    const images = (req.files ?? []).map((f) => `/uploads/reports/${f.filename}`);

    const updated = await prisma.report.update({
      where: { id },
      data: { evidenceMessage: data.evidenceMessage, evidenceImages: images, evidenceSentAt: new Date() },
    });
    res.json({ report: updated });
  } catch (err) {
    if (req.files?.length) {
      for (const f of req.files) unlink(join(REPORT_UPLOAD_DIR, f.filename)).catch(() => {});
    }
    throw err;
  }
}
