import { prisma } from "./prisma.js";

// Guarda en el registro del admin la pregunta del cliente y la respuesta del bot (ver ChatQuestionLog en el esquema). Nunca
// frena ni rompe el chat: si falla, la respuesta al cliente sigue igual.
export function logChatExchange({ bot, vendorId = null, userId = null, sessionId, question, answer }) {
  if (!question || !answer || !sessionId) return;
  void prisma.chatQuestionLog
    .create({ data: { bot, vendorId, userId, sessionId, question: String(question).slice(0, 2000), answer: String(answer).slice(0, 4000) } })
    .catch(() => {});
}
