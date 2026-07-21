import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

const createSchema = z.object({ message: z.string().min(5, "Contanos un poco más.") });

// authorType nunca viene del body — se deriva del role real del JWT, así no
// se puede falsear "mandé esto como vendedor" siendo cliente (o viceversa).
export async function createSuggestion(req, res) {
  const { message } = createSchema.parse(req.body);
  const authorType = req.user.role === "VENDOR" ? "VENDOR" : "CUSTOMER";

  const suggestion = await prisma.suggestion.create({
    data: { authorId: req.user.id, authorType, message },
  });
  res.status(201).json({ suggestion });
}

// --- Admin ---------------------------------------------------------------

function authorLabel(user, vendor) {
  if (vendor) return vendor.companyName;
  return user.fullName ?? user.email;
}

export async function listSuggestions(req, res) {
  const { type, status } = req.query;
  const suggestions = await prisma.suggestion.findMany({
    where: {
      authorType: type ? String(type).toUpperCase() : undefined,
      status: status ? String(status).toUpperCase() : undefined,
    },
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
