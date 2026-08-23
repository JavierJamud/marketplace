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

// Resuelve el objetivo del reporte y devuelve el userId del dueño real
// (quien recibe el aviso y puede mandar evidencia) — 3 ramas, una por tipo
// de objetivo posible.
async function resolveReportTarget(data) {
  if (data.productId) {
    const product = await prisma.product.findUnique({
      where: { id: data.productId },
      include: { vendor: { select: { id: true, userId: true, companyName: true } } },
    });
    if (!product) throw new AppError("Producto no encontrado.", 404);
    return { field: "productId", ownerUserId: product.vendor.userId, label: `producto "${product.name}"` };
  }
  if (data.vendorId) {
    const vendor = await prisma.vendor.findUnique({ where: { id: data.vendorId }, select: { id: true, userId: true, companyName: true } });
    if (!vendor) throw new AppError("Tienda no encontrada.", 404);
    return { field: "vendorId", ownerUserId: vendor.userId, label: `tienda "${vendor.companyName}"` };
  }
  const listing = await prisma.customerListing.findUnique({ where: { id: data.customerListingId }, select: { id: true, ownerId: true, name: true } });
  if (!listing) throw new AppError("Anuncio no encontrado.", 404);
  return { field: "customerListingId", ownerUserId: listing.ownerId, label: `anuncio "${listing.name}"` };
}

export async function createReport(req, res) {
  try {
    if (!req.file) throw new AppError("La captura de pantalla es obligatoria.", 400);
    const data = createReportSchema.parse(req.body);
    const target = await resolveReportTarget(data);

    if (target.ownerUserId === req.user.id) {
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
