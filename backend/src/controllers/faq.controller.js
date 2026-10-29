import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { FAQ_ANSWER_MAX, FAQ_BATCH_MAX_ITEMS, FAQ_QUESTION_MAX, hasMarkup, parseFaqBatch, sanitizeFaqHtml } from "../lib/faqBatch.js";

// Bloque 53: preguntas frecuentes reales — antes eran copy hardcodeado en
// Faq.jsx, ahora viven en su propia tabla con CRUD desde el admin, separado
// de "Páginas" (que quedó solo para Términos/Privacidad, ver
// staticPages.controller.js). Cada pregunta pertenece a un único público.

const faqSelect = { id: true, audience: true, question: true, answer: true, createdAt: true, updatedAt: true };

// Sanitiza y deja cada enlace con target="_blank" rel="noopener noreferrer", la misma regla que cleanAnswer aplica en la
// carga por lote (lib/faqBatch.js, que no la exporta): DOMPurify permite target y rel, así que una respuesta escrita a mano
// podía quedar con un <a target="_blank"> sin rel. DOMPurify siempre deja el href entre comillas dobles.
function cleanFaqHtml(html) {
  return sanitizeFaqHtml(html).replace(/<a\s+([^>]*?)>/gi, (_m, attrs) => {
    const href = /href\s*=\s*"[^"]*"/i.exec(attrs)?.[0];
    return href ? `<a ${href} target="_blank" rel="noopener noreferrer">` : "<a>";
  });
}

// Las respuestas con formato (cargadas por lote o editadas con HTML) se vuelven a sanitizar al servirlas, en el sitio y en el
// admin (AdminFaq.jsx las pinta con dangerouslySetInnerHTML). Cubre también las guardadas antes de sanitizar al escribir.
const serveFaq = (i) => (hasMarkup(i.answer) ? { ...i, answer: cleanFaqHtml(i.answer) } : i);

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
  res.json({ items: items.map(serveFaq) });
}

// Admin — todas juntas (las dos audiencias), para la tabla de gestión.
export async function listAdminFaqs(_req, res) {
  const items = await prisma.faqItem.findMany({
    orderBy: [{ audience: "asc" }, { createdAt: "asc" }],
    select: faqSelect,
  });
  res.json({ items: items.map(serveFaq) });
}

// Una respuesta con HTML escrita a mano se sanitiza antes de guardarla, igual que la carga por lote (parseFaqBatch) y las
// páginas legales (staticPages.controller.js): antes se guardaba tal cual y solo se limpiaba al servirla en público, así que
// el admin la veía cruda. Los topes son los mismos de la carga por lote.
// Solo se le quitan las etiquetas a una respuesta con formato: en texto plano "3 < 5 y 6 > 4" no son etiquetas.
const faqText = (html) => html.replace(/<[^>]*>/g, " ").replace(/&nbsp;/g, " ").trim();
const createFaqSchema = z.object({
  audience: z.enum(["CUSTOMER", "VENDOR"]),
  question: z.string().trim().min(3, "Escribe la pregunta.").max(FAQ_QUESTION_MAX, `La pregunta admite hasta ${FAQ_QUESTION_MAX} caracteres.`),
  answer: z
    .string()
    .trim()
    .min(3, "Escribe la respuesta.")
    .max(FAQ_ANSWER_MAX, `La respuesta admite hasta ${FAQ_ANSWER_MAX} caracteres.`)
    .transform((a) => (hasMarkup(a) ? cleanFaqHtml(a).trim() : a))
    .refine((a) => (hasMarkup(a) ? faqText(a) : a).length >= 3, "La respuesta quedó vacía al quitar el formato no permitido. Escribe el texto de la respuesta."),
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
