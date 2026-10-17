import cron from "node-cron";
import { prisma } from "../lib/prisma.js";

// Conversaciones de los chatbots: a las 24 h sin un mensaje nuevo se borran por completo (el cliente ya no las ve y la IA no
// las vuelve a leer). Del registro del admin (ChatQuestionLog) se borra lo que tiene más de 90 días. Corre cada hora.
const CONVERSATION_TTL_MS = 24 * 60 * 60 * 1000;
const LOG_TTL_MS = 90 * 24 * 60 * 60 * 1000;

export async function purgeChatHistory() {
  const cutoff = new Date(Date.now() - CONVERSATION_TTL_MS);
  // Una sesión se borra entera cuando su último mensaje es anterior al corte (nunca a medias si sigue activa).
  const [market, store, logs] = await prisma.$transaction([
    prisma.$executeRaw`DELETE FROM "MarketplaceChatMessage" WHERE "sessionId" IN (SELECT "sessionId" FROM "MarketplaceChatMessage" GROUP BY "sessionId" HAVING MAX("createdAt") < ${cutoff})`,
    prisma.$executeRaw`DELETE FROM "ChatMessage" WHERE ("vendorId", "sessionId") IN (SELECT "vendorId", "sessionId" FROM "ChatMessage" GROUP BY "vendorId", "sessionId" HAVING MAX("createdAt") < ${cutoff})`,
    prisma.chatQuestionLog.deleteMany({ where: { createdAt: { lt: new Date(Date.now() - LOG_TTL_MS) } } }),
  ]);
  return { marketplaceMessages: market, storeMessages: store, logEntries: logs.count };
}

export function startChatRetentionJob() {
  cron.schedule("17 * * * *", () => {
    purgeChatHistory()
      .then((r) => {
        if (r.marketplaceMessages || r.storeMessages || r.logEntries) console.log("[chatRetention]", r);
      })
      .catch((err) => console.error("[chatRetention]", err.message));
  });
}
