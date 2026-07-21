import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";

// Bloque 37 (Parte E): panel de revisión de conversaciones reales — el
// admin ve pares (mensaje real del cliente -> respuesta real del bot) y
// puede marcar una como buena (se guarda tal cual) o mala (escribe la
// ideal), alimentando ChatTrainingExample (ver lib/chatTrainingExamples.js
// para cómo se inyecta esto de vuelta en el prompt).

// Empareja cada respuesta del bot ("model") con el último mensaje real del
// cliente ("user") visto antes, dentro de la MISMA sesión/tienda — nunca
// cruza sesiones distintas entre sí.
function pairUserWithModel(rowsAsc, keyFn) {
  const lastUserByKey = new Map();
  const pairs = [];
  for (const r of rowsAsc) {
    const key = keyFn(r);
    if (r.role === "user") lastUserByKey.set(key, r);
    else if (r.role === "model") pairs.push({ user: lastUserByKey.get(key) ?? null, model: r });
  }
  return pairs.reverse();
}

const CONVERSATIONS_LIMIT = 60;

export async function listRecentConversations(req, res) {
  const bot = req.query.bot === "tienda" ? "tienda" : "general";

  if (bot === "tienda") {
    const rows = await prisma.chatMessage.findMany({
      orderBy: { createdAt: "desc" },
      take: CONVERSATIONS_LIMIT,
      include: { vendor: { select: { companyName: true } } },
    });
    const pairs = pairUserWithModel([...rows].reverse(), (r) => `${r.vendorId}|${r.sessionId}`);
    return res.json({
      conversations: pairs.map((p) => ({
        id: p.model.id,
        sessionId: p.model.sessionId,
        vendorName: p.model.vendor?.companyName ?? null,
        clienteMensaje: p.user?.content ?? null,
        botRespuesta: p.model.content,
        createdAt: p.model.createdAt,
      })),
    });
  }

  const rows = await prisma.marketplaceChatMessage.findMany({ orderBy: { createdAt: "desc" }, take: CONVERSATIONS_LIMIT });
  const pairs = pairUserWithModel([...rows].reverse(), (r) => r.sessionId);
  res.json({
    conversations: pairs.map((p) => ({
      id: p.model.id,
      sessionId: p.model.sessionId,
      vendorName: null,
      clienteMensaje: p.user?.content ?? null,
      botRespuesta: p.model.content,
      createdAt: p.model.createdAt,
    })),
  });
}

const createExampleSchema = z.object({
  botTipo: z.enum(["TIENDA", "GENERAL"]),
  entradaCliente: z.string().trim().min(1, "Falta el mensaje del cliente.").max(500),
  respuestaIdeal: z.string().trim().min(1, "Falta la respuesta ideal.").max(800),
});

// Un solo endpoint para ambos casos ("marcar buena" y "marcar mala +
// corregir"): el frontend manda respuestaIdeal = la respuesta real del bot
// tal cual (reforzar) o el texto que el admin reescribió (corregir) — acá
// no hay diferencia de tratamiento, ambas quedan activas de inmediato.
export async function createTrainingExample(req, res) {
  const data = createExampleSchema.parse(req.body);
  const example = await prisma.chatTrainingExample.create({ data: { ...data, creadoPorId: req.user.id } });
  res.status(201).json({ example });
}

export async function listTrainingExamples(req, res) {
  const bot = req.query.bot;
  const where = bot === "TIENDA" || bot === "GENERAL" ? { botTipo: bot } : {};
  const examples = await prisma.chatTrainingExample.findMany({
    where,
    orderBy: { createdAt: "desc" },
    include: { creadoPor: { select: { fullName: true, email: true } } },
  });
  res.json({ examples });
}

export async function toggleTrainingExample(req, res) {
  const { id } = req.params;
  const { activo } = z.object({ activo: z.boolean() }).parse(req.body);
  const existing = await prisma.chatTrainingExample.findUnique({ where: { id } });
  if (!existing) throw new AppError("Ejemplo no encontrado.", 404);
  const example = await prisma.chatTrainingExample.update({ where: { id }, data: { activo } });
  res.json({ example });
}

export async function deleteTrainingExample(req, res) {
  const { id } = req.params;
  const existing = await prisma.chatTrainingExample.findUnique({ where: { id } });
  if (!existing) throw new AppError("Ejemplo no encontrado.", 404);
  await prisma.chatTrainingExample.delete({ where: { id } });
  res.status(204).send();
}
