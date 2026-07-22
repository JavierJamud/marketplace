import { z } from "zod";
import { unlink } from "node:fs/promises";
import { join } from "node:path";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { SITE_UPLOAD_DIR } from "./settings.controller.js";

// Bloque 46: mismo directorio/mecanismo de subida que el hero (siteUpload,
// ver settings.controller.js) — nunca se reinventa el upload.

// FormData manda todo como string — z.boolean() no coacciona "true"/"false"
// (y z.coerce.boolean() los volvería siempre true, cualquier string no vacío
// es truthy). Este preprocess acepta tanto un boolean real (body JSON, ej.
// el toggle rápido de isActive) como el string de un multipart con imagen.
const boolish = z.preprocess((v) => (typeof v === "string" ? v === "true" : v), z.boolean());

const announcementBaseSchema = z.object({
  title: z.string().trim().min(2),
  body: z.string().trim().optional(),
  page: z.enum(["HOME", "STORES", "ALL"]),
  position: z.enum(["HERO", "TOP_BAR"]),
  startAt: z.coerce.date(),
  endAt: z.coerce.date(),
  isActive: boolish.optional(),
});

const createAnnouncementSchema = announcementBaseSchema.refine((d) => d.endAt > d.startAt, {
  message: "La fecha de fin debe ser posterior al inicio.",
  path: ["endAt"],
});
const updateAnnouncementSchema = announcementBaseSchema.partial();

function withImageUrl(a) {
  return { ...a, imageUrl: a.imageUrl ? `/uploads/site/${a.imageUrl}` : null };
}

export async function listAnnouncementsAdmin(_req, res) {
  const announcements = await prisma.announcement.findMany({ orderBy: { startAt: "desc" } });
  res.json({ announcements: announcements.map(withImageUrl) });
}

export async function createAnnouncement(req, res) {
  const data = createAnnouncementSchema.parse(req.body);
  const announcement = await prisma.announcement.create({
    data: { ...data, imageUrl: req.file?.filename ?? null },
  });
  res.status(201).json({ announcement: withImageUrl(announcement) });
}

export async function updateAnnouncement(req, res) {
  const { id } = req.params;
  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) throw new AppError("Anuncio no encontrado.", 404);

  const data = updateAnnouncementSchema.parse(req.body);
  const nextStartAt = data.startAt ?? existing.startAt;
  const nextEndAt = data.endAt ?? existing.endAt;
  if (nextEndAt <= nextStartAt) throw new AppError("La fecha de fin debe ser posterior al inicio.", 400);

  // Reemplazo, no acumulación — mismo criterio que vendor.aiDocument: si
  // sube una imagen nueva, se borra la anterior del disco (best-effort, un
  // huérfano no bloquea el guardado).
  if (req.file && existing.imageUrl) {
    await unlink(join(SITE_UPLOAD_DIR, existing.imageUrl)).catch(() => {});
  }

  const announcement = await prisma.announcement.update({
    where: { id },
    data: { ...data, imageUrl: req.file?.filename ?? undefined },
  });
  res.json({ announcement: withImageUrl(announcement) });
}

export async function deleteAnnouncement(req, res) {
  const { id } = req.params;
  const existing = await prisma.announcement.findUnique({ where: { id } });
  if (!existing) throw new AppError("Anuncio no encontrado.", 404);

  if (existing.imageUrl) {
    await unlink(join(SITE_UPLOAD_DIR, existing.imageUrl)).catch(() => {});
  }
  await prisma.announcement.delete({ where: { id } });
  res.status(204).end();
}

// --- Público -----------------------------------------------------------
// Sin auth — Home.jsx/Stores.jsx lo consultan directo. Nunca devuelve nada
// fuera de rango de fecha o inactivo, así que el frontend público jamás
// necesita filtrar nada por su cuenta (ver brief: "ningún banner aparece sin
// pasar por este endpoint").
export async function listActiveAnnouncements(req, res) {
  // Bloque 47: el popup se monta una sola vez desde PublicLayout.jsx (no
  // solo en Home.jsx/Stores.jsx) — sin un page=home/stores reconocible (ej.
  // en Cart.jsx, Product.jsx, etc.), el default tiene que ser el más
  // restrictivo (solo "page: ALL"), nunca "sin filtro" — si no, un anuncio
  // pensado solo para Home terminaría apareciendo en cualquier página.
  const page = req.query.page === "stores" ? "STORES" : req.query.page === "home" ? "HOME" : "ALL";
  const now = new Date();

  const announcements = await prisma.announcement.findMany({
    where: {
      isActive: true,
      startAt: { lte: now },
      endAt: { gte: now },
      OR: [{ page }, { page: "ALL" }],
    },
    orderBy: { startAt: "desc" },
  });
  res.json({ announcements: announcements.map(withImageUrl) });
}
