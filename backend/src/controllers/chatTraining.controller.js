import { z } from "zod";
import { prisma } from "../lib/prisma.js";
import { AppError } from "../utils/AppError.js";
import { generateRawText } from "../lib/ai.js";

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
// De la corrección del admin se saca un criterio general (una frase): eso es lo que aprende el bot, no el texto de la respuesta.
// Así la próxima vez responde mejor con datos reales y no repite lo que el admin escribió.
async function distillLesson(entradaCliente, respuestaIdeal) {
  try {
    const raw = await generateRawText(
      `Un administrador corrigió la respuesta de un asistente de compras.
Pregunta del cliente: "${entradaCliente}"
Respuesta ideal del admin: "${respuestaIdeal}"

Escribe en UNA sola frase (máximo 200 caracteres, en infinitivo o imperativo) el criterio general que el asistente debe aplicar en preguntas parecidas: tono, longitud, formato y qué datos reales consultar. No copies la respuesta ni incluyas precios, nombres o cifras concretas. Responde solo con la frase.`
    );
    const lesson = String(raw ?? "").replace(/^["'\s]+|["'\s]+$/g, "").replace(/\s+/g, " ").slice(0, 220);
    return lesson.length >= 12 ? lesson : null;
  } catch {
    return null;
  }
}

export async function createTrainingExample(req, res) {
  const data = createExampleSchema.parse(req.body);
  const leccion = await distillLesson(data.entradaCliente, data.respuestaIdeal);
  const example = await prisma.chatTrainingExample.create({ data: { ...data, leccion, creadoPorId: req.user.id } });
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

// --- Registro de preguntas (ChatQuestionLog, 90 días) ------------------------------------------------------------------
// Lo que preguntan los clientes a los dos chatbots, con filtros: qué bot, clientes con o sin cuenta, tiendas verificadas o no,
// una tienda o un cliente puntual y texto. `clientKey` identifica al cliente: "u:<id de cuenta>" o "s:<sesión del navegador>".
const logQuerySchema = z.object({
  bot: z.enum(["all", "GENERAL", "TIENDA"]).catch("all"),
  client: z.enum(["all", "logged", "guest"]).catch("all"),
  vendorStatus: z.enum(["all", "verified", "unverified"]).catch("all"),
  vendorId: z.string().trim().max(60).optional().catch(undefined),
  clientKey: z.string().trim().max(120).optional().catch(undefined),
  q: z.string().trim().max(120).optional().catch(undefined),
  page: z.coerce.number().int().min(1).catch(1),
  pageSize: z.coerce.number().int().min(10).max(100).catch(25),
});

// Etiqueta corta y estable para un visitante sin cuenta (siempre la misma para la misma sesión).
function guestLabel(sessionId) {
  let h = 0;
  for (const ch of String(sessionId)) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `Visitante ${h.toString(36).toUpperCase().slice(-5).padStart(5, "0")}`;
}

function logWhere(f) {
  const where = {};
  if (f.bot !== "all") where.bot = f.bot;
  if (f.client === "logged") where.userId = { not: null };
  if (f.client === "guest") where.userId = null;
  if (f.vendorStatus !== "all") {
    where.bot = "TIENDA";
    where.vendor = f.vendorStatus === "verified" ? { verificationStatus: "VERIFIED" } : { verificationStatus: { not: "VERIFIED" } };
  }
  if (f.vendorId) where.vendorId = f.vendorId;
  if (f.clientKey?.startsWith("u:")) where.userId = f.clientKey.slice(2);
  else if (f.clientKey?.startsWith("s:")) where.sessionId = f.clientKey.slice(2);
  if (f.q) where.OR = [{ question: { contains: f.q, mode: "insensitive" } }, { answer: { contains: f.q, mode: "insensitive" } }];
  return where;
}

export async function listChatLog(req, res) {
  const f = logQuerySchema.parse(req.query);
  const where = logWhere(f);
  const [rows, total, logged, sessions, vendorsInLog] = await Promise.all([
    prisma.chatQuestionLog.findMany({
      where,
      orderBy: { createdAt: "desc" },
      skip: (f.page - 1) * f.pageSize,
      take: f.pageSize,
      include: {
        vendor: { select: { id: true, companyName: true, verificationStatus: true } },
        user: { select: { id: true, fullName: true, email: true } },
      },
    }),
    prisma.chatQuestionLog.count({ where }),
    where.userId === null ? 0 : prisma.chatQuestionLog.count({ where: { ...where, userId: where.userId ?? { not: null } } }),
    prisma.chatQuestionLog.groupBy({ by: ["sessionId"], where, _count: { _all: true } }).then((g) => g.length),
    prisma.chatQuestionLog.groupBy({ by: ["vendorId"], where: { vendorId: { not: null } }, _count: { _all: true } }),
  ]);

  // Preguntas que más se repiten (las "preguntas base") con los mismos filtros, comparando sin mayúsculas ni espacios de más.
  const top = await prisma.chatQuestionLog.findMany({ where, select: { question: true }, orderBy: { createdAt: "desc" }, take: 3000 });
  const counts = new Map();
  for (const { question } of top) {
    const key = question.toLowerCase().replace(/[¿?¡!.,;:]/g, "").replace(/\s+/g, " ").trim();
    if (key.length < 3) continue;
    const entry = counts.get(key) ?? { question: question.trim(), count: 0 };
    entry.count++;
    counts.set(key, entry);
  }
  const topQuestions = [...counts.values()].filter((e) => e.count > 1).sort((a, b) => b.count - a.count).slice(0, 10);

  const vendorNames = await prisma.vendor.findMany({
    where: { id: { in: vendorsInLog.map((v) => v.vendorId) } },
    select: { id: true, companyName: true, verificationStatus: true },
    orderBy: { companyName: "asc" },
  });

  res.json({
    items: rows.map((r) => ({
      id: r.id,
      bot: r.bot,
      question: r.question,
      answer: r.answer,
      createdAt: r.createdAt,
      vendor: r.vendor ? { id: r.vendor.id, name: r.vendor.companyName, verified: r.vendor.verificationStatus === "VERIFIED" } : null,
      client: r.user
        ? { key: `u:${r.user.id}`, kind: "user", label: r.user.fullName || r.user.email, email: r.user.email }
        : { key: `s:${r.sessionId}`, kind: "guest", label: guestLabel(r.sessionId) },
    })),
    total,
    page: f.page,
    pageSize: f.pageSize,
    stats: { total, logged, guests: total - logged, conversations: sessions },
    topQuestions,
    vendors: vendorNames.map((v) => ({ id: v.id, name: v.companyName, verified: v.verificationStatus === "VERIFIED" })),
    retentionDays: 90,
  });
}
