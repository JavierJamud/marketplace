import { z } from "zod";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { unlink } from "node:fs/promises";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { notifyAdminActionNeeded } from "../lib/adminNotify.js";
import { reportTargetSnapshot } from "../lib/moderation.js";
import { requireVendorAccess, requireVendorWrite } from "../middleware/requireVendorAccess.js";

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
    message: z.string().trim().min(10, "Cuéntanos qué pasó (mínimo 10 caracteres)."),
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

// Usuario del equipo (VENDOR_STAFF) con la sección "Reportes": actúa por la tienda, no por sí mismo. Su req.user.id no es
// dueño de nada, así que buscando por usuario su lista salía vacía y no podía responder, aunque el dueño le hubiera dado la
// sección. Las rutas /reports/* son de cualquier cuenta con sesión (clientes incluidos) y no pueden llevar el guardia del
// panel delante, por eso se llama aquí: mismas reglas que el resto del panel (sección activa, nivel "Modificar" para
// responder o apelar, tienda no bloqueada y plan con usuarios del equipo). Devuelve el id de la tienda, null si quien llama
// no es del equipo, y lanza 403 si es del equipo sin permiso.
async function staffStoreId(req, { write = false } = {}) {
  if (req.user?.role !== "VENDOR_STAFF") return null;
  const guard = write ? requireVendorWrite("reportes") : requireVendorAccess("reportes");
  await guard(req, null, () => {});
  return req.vendorStaff.vendorId;
}

// Reportes donde el usuario logueado es el REPORTADO (no el que reportó) —
// un solo endpoint para las 2 superficies de FB-8: VendorFraudReports.jsx
// (vendedor, directo o vía uno de sus productos) y el banner de la tab
// "Venta rápida" en CustomerPanel.jsx (dueño de un CustomerListing). El
// `OR` cubre las 3 formas reales de ser el reportado, mismo criterio que
// resolveReportTarget de arriba pero en sentido inverso (buscar POR
// userId en vez de resolver un userId A PARTIR de ids del reporte).
// Un usuario del equipo con la sección "Reportes" ve los de la tienda para la que trabaja (ver staffStoreId).
export async function listMyReportsAgainstMe(req, res) {
  let storeId = null;
  if (req.user.role === "VENDOR_STAFF") {
    // VendorLayout pide esta lista a todo el panel para el contador del menú: a quien no tiene la sección se le responde
    // vacío en vez de un 403 cada 20 segundos. Solo se traga el "no tienes permiso"; un fallo de la base sigue saliendo.
    storeId = await staffStoreId(req).catch((err) => {
      if (err instanceof AppError) return null;
      throw err;
    });
    if (!storeId) return res.json({ reports: [] });
  }
  const reports = await prisma.report.findMany({
    where: {
      // targetVendorId cubre también los reportes de un producto que la tienda ya borró (la relación queda en null).
      OR: storeId
        ? [{ targetVendorId: storeId }, { vendorId: storeId }, { product: { vendorId: storeId } }]
        : [
            { targetOwnerId: req.user.id },
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
  // Al reportado no se le muestra quién lo reportó ni sus capturas (solo el motivo y en qué quedó).
  res.json({ reports: reports.map(({ reporterId, images, screenshotUrl, ...r }) => r) });
}

// Reportes que hizo el usuario logueado (de fraude y de comentarios), con su estado. Solo lo que le toca saber a quien
// reportó: qué reportó, cuándo, su mensaje y en qué quedó; nunca la evidencia ni los datos del reportado.
export async function listMyReportsMade(req, res) {
  const [reports, reviews] = await Promise.all([
    prisma.report.findMany({
      where: { reporterId: req.user.id },
      select: {
        id: true, status: true, message: true, createdAt: true, resolvedAt: true, resolutionNote: true, targetLabel: true,
        product: { select: { name: true, slug: true, vendor: { select: { slug: true } } } },
        vendor: { select: { companyName: true, slug: true } },
        customerListing: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: "desc" },
      take: 100,
    }),
    prisma.review.findMany({
      where: { reportedById: req.user.id, reportStatus: { not: null } },
      select: {
        id: true, comment: true, reportStatus: true, reportReason: true, reportedAt: true, reportResolvedAt: true,
        product: { select: { name: true } },
        vendor: { select: { companyName: true } },
      },
      orderBy: { reportedAt: "desc" },
      take: 100,
    }),
  ]);
  res.json({ reports, reviewReports: reviews });
}

// Archivos subidos en este pedido (capturas del reporte o de la apelación).
const uploadedFiles = (req) => [...(req.files?.images ?? []), ...(req.files?.screenshot ?? []), ...(Array.isArray(req.files) ? req.files : [])];

// Reportar: cualquier cuenta con sesión, menos el dueño. El motivo es obligatorio; las capturas son opcionales (pedido
// del dueño), solo imágenes y hasta 4. Se guarda quién es el dueño en ese momento (targetOwnerId/targetVendorId) para
// contar avisos aunque el objetivo se borre después. Mientras el admin revisa, el objetivo sigue publicado.
export async function createReport(req, res) {
  const files = uploadedFiles(req);
  try {
    const data = createReportSchema.parse(req.body);
    const target = await resolveReportTarget(data);

    if (target.user.id === req.user.id) {
      throw new AppError(`No puedes reportar tu propio ${target.label}.`, 400);
    }

    const existing = await prisma.report.findFirst({
      where: { [target.field]: data[target.field], reporterId: req.user.id, status: { in: ["PENDING", "EVIDENCE_REQUESTED"] } },
    });
    if (existing) throw new AppError("Ya reportaste esto y lo estamos revisando. Te avisaremos por correo.", 409);

    const images = files.map((f) => `/uploads/reports/${f.filename}`);
    const snapshot = await reportTargetSnapshot(data);
    const report = await prisma.report.create({
      data: {
        reporterId: req.user.id,
        productId: data.productId ?? null,
        vendorId: data.vendorId ?? null,
        customerListingId: data.customerListingId ?? null,
        screenshotUrl: images[0] ?? null,
        images,
        message: data.message,
        ...snapshot,
      },
    });
    const reporter = await prisma.user.findUnique({ where: { id: req.user.id }, select: { fullName: true, role: true } });
    void notifyAdminActionNeeded(
      "Reporte nuevo",
      `${reporter?.fullName ?? "Un usuario"} (${reporter?.role === "VENDOR" ? "tienda" : reporter?.role === "ADMIN" ? "admin" : "cliente"}) reportó el ${target.label}${images.length ? ` con ${images.length} ${images.length === 1 ? "captura" : "capturas"}` : ""}: "${data.message.slice(0, 300)}"`,
      target.vendorId ?? undefined,
      { url: `/admin/reportes-fraude?report=${report.id}` }
    ).catch(() => {});
    res.status(201).json({ report });
  } catch (err) {
    // Multer ya escribió los archivos: si algo falla después no deben quedar huérfanos.
    for (const f of files) unlink(join(REPORT_UPLOAD_DIR, f.filename)).catch(() => {});
    throw err;
  }
}

const appealSchema = z.object({ appealMessage: z.string().trim().min(10, "Cuéntanos por qué debería volver a publicarse (mínimo 10 caracteres).").max(2000) });

// Apelación del dueño tras una suspensión: mensaje y, si tiene, capturas. Solo dentro del plazo (itemDeleteAt) y una
// vez. El admin la acepta (se vuelve a publicar) o la rechaza (se elimina), ver adminReports.controller.js.
export async function submitAppeal(req, res) {
  const files = uploadedFiles(req);
  try {
    const storeId = await staffStoreId(req, { write: true });
    const report = await prisma.report.findUnique({ where: { id: req.params.id } });
    const isMine = storeId ? report?.targetVendorId === storeId : report?.targetOwnerId === req.user.id;
    if (!report || !isMine) throw new AppError("Reporte no encontrado.", 404);
    if (report.status !== "RESOLVED_SUSPENDED" || !report.itemDeleteAt) throw new AppError("Esta suspensión no admite apelación.", 400);
    if (report.appealSentAt) throw new AppError("Ya enviaste tu apelación. Te avisaremos por correo cuando la revisemos.", 409);
    if (report.itemDeleteAt < new Date()) throw new AppError("Venció el plazo para apelar.", 400);
    const { appealMessage } = appealSchema.parse(req.body);
    const updated = await prisma.report.update({
      where: { id: report.id },
      data: { appealMessage, appealImages: files.map((f) => `/uploads/reports/${f.filename}`), appealSentAt: new Date(), appealStatus: "PENDING" },
    });
    void notifyAdminActionNeeded(
      "Apelación de una suspensión",
      // targetLabel ya lleva su tipo ('producto "X"', 'tienda "Y"', 'venta rápida "Z"'), con géneros distintos: "sobre" sirve
      // para los tres sin artículo.
      `${storeId ? "Un usuario del equipo de la tienda" : "El dueño"} envió una apelación sobre ${report.targetLabel ?? "una publicación suspendida"}: "${appealMessage.slice(0, 300)}"`,
      report.targetVendorId ?? undefined,
      { url: `/admin/reportes-fraude?report=${report.id}` }
    ).catch(() => {});
    res.json({ report: updated });
  } catch (err) {
    for (const f of files) unlink(join(REPORT_UPLOAD_DIR, f.filename)).catch(() => {});
    throw err;
  }
}

const submitEvidenceSchema = z.object({
  evidenceMessage: z.string().trim().min(10, "Cuéntanos qué pasó (mínimo 10 caracteres)."),
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
    // Antes de leer el reporte: a quien no tiene la sección no se le dice si el id existe.
    const storeId = await staffStoreId(req, { write: true });
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) throw new AppError("Reporte no encontrado.", 404);

    // La propiedad se comprueba antes que el estado y responde igual que un id inexistente (como submitAppeal): antes, con
    // el estado primero y un 403 aparte, cualquier cuenta con sesión podía saber si un id de reporte ajeno existía y si
    // estaba esperando evidencia. Si el objetivo ya se borró, resolveReportTarget da su propio 404 ("Producto no
    // encontrado."), que también delataría el reporte: se responde con el mismo texto. Si el producto se borró, la relación
    // queda en null y el reporte no tiene ninguno de los tres ids: sin este cuidado, resolveReportTarget buscaba un anuncio
    // con id undefined y salía un 500.
    const hasTarget = !!(report.productId || report.vendorId || report.customerListingId);
    const target = hasTarget
      ? await resolveReportTarget(report).catch((err) => {
          if (err instanceof AppError && err.statusCode === 404) return null;
          throw err;
        })
      : null;
    const canAnswer = !!target && (storeId ? target.kind === "VENDOR" && target.vendorId === storeId : target.user.id === req.user.id);
    if (!canAnswer) throw new AppError("Reporte no encontrado.", 404);

    if (report.status !== "EVIDENCE_REQUESTED") {
      throw new AppError("Este reporte no está esperando evidencia en este momento.", 400);
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
