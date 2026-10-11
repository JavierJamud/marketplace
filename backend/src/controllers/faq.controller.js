import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { FAQ_BATCH_MAX_ITEMS, hasMarkup, parseFaqBatch, sanitizeFaqHtml } from "../lib/faqBatch.js";

// Bloque 53: preguntas frecuentes reales — antes eran copy hardcodeado en
// Faq.jsx, ahora viven en su propia tabla con CRUD desde el admin, separado
// de "Páginas" (que quedó solo para Términos/Privacidad, ver
// staticPages.controller.js). Cada pregunta pertenece a un único público.

const faqSelect = { id: true, audience: true, question: true, answer: true, createdAt: true, updatedAt: true };

// Público — Faq.jsx pide la lista según la pestaña activa (cliente/vendedor).
// Cualquier valor que no sea exactamente "VENDOR" cae en "CUSTOMER", nunca
// un 400 por un query param raro — es una página pública sin consecuencias.
export async function listPublicFaqs(req, res) {
  const audience = req.query.audience === "VENDOR" ? "VENDOR" : "CUSTOMER";
  const items = await prisma.faqItem.findMany({
    where: { audience },
    orderBy: { createdAt: "asc" },
    select: faqSelect,
  });
  // Las respuestas con formato (cargadas por lote o editadas con HTML) se vuelven a sanitizar al servirlas.
  res.json({ items: items.map((i) => (hasMarkup(i.answer) ? { ...i, answer: sanitizeFaqHtml(i.answer) } : i)) });
}

// Admin — todas juntas (las dos audiencias), para la tabla de gestión.
export async function listAdminFaqs(_req, res) {
  const items = await prisma.faqItem.findMany({
    orderBy: [{ audience: "asc" }, { createdAt: "asc" }],
    select: faqSelect,
  });
  res.json({ items });
}

const createFaqSchema = z.object({
  audience: z.enum(["CUSTOMER", "VENDOR"]),
  question: z.string().trim().min(3, "Escribe la pregunta."),
  answer: z.string().trim().min(3, "Escribe la respuesta."),
});

export async function createFaq(req, res) {
  const data = createFaqSchema.parse(req.body);
  const item = await prisma.faqItem.create({ data, select: faqSelect });
  res.status(201).json({ item });
}

const batchSchema = z.object({
  audience: z.enum(["CUSTOMER", "VENDOR"]),
  html: z.string().trim().min(10, "Pega el HTML con las preguntas.").max(400_000, "El HTML es demasiado largo."),
  // Con commit=false solo se muestra qué se detectó; con true se guardan.
  commit: z.boolean().optional(),
});

export async function batchCreateFaqs(req, res) {
  const { audience, html, commit } = batchSchema.parse(req.body);
  const { items, skipped } = parseFaqBatch(html);
  if (items.length > FAQ_BATCH_MAX_ITEMS) throw new AppError(`Máximo ${FAQ_BATCH_MAX_ITEMS} preguntas por lote (se detectaron ${items.length}).`, 400);
  if (!commit) return res.json({ items, skipped, created: 0 });
  if (items.length === 0) throw new AppError("No se detectó ninguna pregunta con respuesta en ese HTML.", 400);

  const result = await prisma.faqItem.createMany({ data: items.map((i) => ({ audience, ...i })) });
  res.status(201).json({ items, skipped, created: result.count });
}

const updateFaqSchema = createFaqSchema.partial();

export async function updateFaq(req, res) {
  const { id } = req.params;
  const data = updateFaqSchema.parse(req.body);

  const existing = await prisma.faqItem.findUnique({ where: { id } });
  if (!existing) throw new AppError("Pregunta no encontrada.", 404);

  const item = await prisma.faqItem.update({ where: { id }, data, select: faqSelect });
  res.json({ item });
}

export async function deleteFaq(req, res) {
  const { id } = req.params;
  const existing = await prisma.faqItem.findUnique({ where: { id } });
  if (!existing) throw new AppError("Pregunta no encontrada.", 404);

  await prisma.faqItem.delete({ where: { id } });
  res.status(204).send();
}
