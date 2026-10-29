import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { logActivity } from "../lib/activityLog.js";

// Mismo tope que el buzón (SuggestionBox.jsx); el texto se guarda recortado.
const createSchema = z.object({ message: z.string().trim().min(5, "Cuéntanos un poco más.").max(2000, "La sugerencia admite hasta 2000 caracteres.") });

// authorType nunca viene del body — se deriva del role real del JWT, así no
// se puede falsear "mandé esto como vendedor" siendo cliente (o viceversa).
export async function createSuggestion(req, res) {
  const { message } = createSchema.parse(req.body);
  const authorType = req.user.role === "VENDOR" ? "VENDOR" : "CUSTOMER";

  const suggestion = await prisma.suggestion.create({
    data: { authorId: req.user.id, authorType, message },
  });

  const vendor = authorType === "VENDOR" ? await prisma.vendor.findUnique({ where: { userId: req.user.id }, select: { id: true } }) : null;
  logActivity({
    actorId: req.user.id,
    actorRole: authorType,
    vendorId: vendor?.id,
    action: "suggestion_submitted",
    description: "Envió una sugerencia",
    meta: { suggestionId: suggestion.id },
  });

  res.status(201).json({ suggestion });
}

// --- Admin ---------------------------------------------------------------

function authorLabel(user, vendor) {
  if (vendor) return vendor.companyName;
  return user.fullName ?? user.email;
}

export async function listSuggestions(req, res) {
  // Filtros validados: antes un ?type desconocido llegaba a Prisma como valor de enum y respondía 500.
  const upper = (v) => (typeof v === "string" && v ? v.toUpperCase() : undefined);
  const { type, status } = z
    .object({ type: z.enum(["VENDOR", "CUSTOMER"]).optional(), status: z.enum(["NEW", "REVIEWED"]).optional() })
    .parse({ type: upper(req.query.type), status: upper(req.query.status) });
  const suggestions = await prisma.suggestion.findMany({
    where: { authorType: type, status },
    // Tope para que la lista no crezca sin fin en una sola respuesta (las más nuevas primero).
    take: 500,
    include: { author: { select: { id: true, fullName: true, email: true, vendor: { select: { companyName: true } } } } },
    orderBy: { createdAt: "desc" },
  });

  res.json({
    suggestions: suggestions.map((s) => ({
      id: s.id,
      authorType: s.authorType,
      authorName: authorLabel(s.author, s.author.vendor),
      message: s.message,
      status: s.status,
      createdAt: s.createdAt,
    })),
  });
}

const updateSchema = z.object({ status: z.enum(["NEW", "REVIEWED"]) });

export async function updateSuggestion(req, res) {
  const { id } = req.params;
  const { status } = updateSchema.parse(req.body);

  const existing = await prisma.suggestion.findUnique({ where: { id } });
  if (!existing) throw new AppError("Sugerencia no encontrada.", 404);

  const suggestion = await prisma.suggestion.update({ where: { id }, data: { status } });
  res.json({ suggestion });
}
