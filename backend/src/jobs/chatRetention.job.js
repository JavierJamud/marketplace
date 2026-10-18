import cron from "node-cron";
import { prisma } from "../lib/prisma.js";

// Conversaciones de los chatbots: a las 24 h sin un mensaje nuevo se borran por completo (el cliente ya no las ve y la IA no
// las vuelve a leer). Del registro del admin (ChatQuestionLog) se borra lo que tiene más de 90 días. Las conversaciones del
// asistente de negocio (tienda y admin) se borran a los 30 días sin un mensaje nuevo. Corre cada hora.
const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;
const LOG_TTL_MS = 90 * 24 * 60 * 60 * 1000;
const ASSISTANT_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export async function purgeChatHistory() {
  const cutoff = new Date(Date.now() - CONVERSATION_TTL_MS);
  // Una sesión se borra entera cuando su último mensaje es anterior al corte (nunca a medias si sigue activa).
  const assistantCutoff = new Date(Date.now() - ASSISTANT_TTL_MS);
  const [market, store, logs, assistant] = await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "MarketplaceChatMessage" WHERE "sessionId" IN (SELECT "sessionId" FROM "MarketplaceChatMessage" GROUP BY "sessionId" HAVING MAX("createdAt") < ${cutoff})`,
    prisma.$executeRaw`DELETE FROM "ChatMessage" WHERE ("vendorId", "sessionId") IN (SELECT "vendorId", "sessionId" FROM "ChatMessage" GROUP BY "vendorId", "sessionId" HAVING MAX("createdAt") < ${cutoff})`,
    prisma.chatQuestionLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - LOG_TTL_MS) } } }),
    // Los mensajes se borran con su conversación (onDelete: Cascade).
    prisma.assistantConversation.deleteMany({ where: { updatedAt: { lt: assistantCutoff } } }),
  ]);
  // Mensajes muy antiguos sin conversación (de antes de que existieran las conversaciones).
  const orphans = await prisma.assistantMessage.deleteMany({ where: { conversationId: null, createdAt: { lt: assistantCutoff } } });
  return { marketplaceMessages: market, storeMessages: store, logEntries: logs.count, assistantConversations: assistant.count + orphans.count };
}

export function startChatRetentionJob() {
  cron.schedule("17 * * * *", () => {
    purgeChatHistory()
      .then((r) => {
        if (r.marketplaceMessages || r.storeMessages || r.logEntries || r.assistantConversations) console.log("[chatRetention]", r);
      })
      .catch((err) => console.error("[chatRetention]", err.message));
  });
}
