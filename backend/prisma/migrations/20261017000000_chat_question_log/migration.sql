-- Registro de preguntas a los chatbots (90 días) para revisar y entrenar desde el admin.
CREATE TABLE "ChatQuestionLog" (
    "id" TEXT NOT NULL,
    "bot" "ChatBotType" NOT NULL,
    "vendorId" TEXT,
    "userId" TEXT,
    "sessionId" TEXT NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatQuestionLog_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ChatQuestionLog_createdAt_idx" ON "ChatQuestionLog"("createdAt");
CREATE INDEX "ChatQuestionLog_bot_createdAt_idx" ON "ChatQuestionLog"("bot", "createdAt");
CREATE INDEX "ChatQuestionLog_vendorId_createdAt_idx" ON "ChatQuestionLog"("vendorId", "createdAt");
CREATE INDEX "ChatQuestionLog_userId_createdAt_idx" ON "ChatQuestionLog"("userId", "createdAt");
CREATE INDEX "ChatQuestionLog_sessionId_idx" ON "ChatQuestionLog"("sessionId");

ALTER TABLE "ChatQuestionLog" ADD CONSTRAINT "ChatQuestionLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "ChatQuestionLog" ADD CONSTRAINT "ChatQuestionLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Lo que ya había en las conversaciones pasa al registro (pares pregunta-respuesta de cada sesión).
INSERT INTO "ChatQuestionLog" ("id", "bot", "vendorId", "userId", "sessionId", "question", "answer", "createdAt")
SELECT 'mig_' || m."id", 'GENERAL', NULL, u."userId", m."sessionId", u."content", m."content", m."createdAt"
FROM "MarketplaceChatMessage" m
JOIN LATERAL (
  SELECT x."content", x."userId" FROM "MarketplaceChatMessage" x
  WHERE x."sessionId" = m."sessionId" AND x."role" = 'user' AND x."createdAt" <= m."createdAt"
  ORDER BY x."createdAt" DESC LIMIT 1
) u ON true
WHERE m."role" = 'model' AND m."sessionId" NOT LIKE 'audit-%';

INSERT INTO "ChatQuestionLog" ("id", "bot", "vendorId", "userId", "sessionId", "question", "answer", "createdAt")
SELECT 'mig_' || m."id", 'TIENDA', m."vendorId", NULL, m."sessionId", u."content", m."content", m."createdAt"
FROM "ChatMessage" m
JOIN LATERAL (
  SELECT x."content" FROM "ChatMessage" x
  WHERE x."sessionId" = m."sessionId" AND x."vendorId" = m."vendorId" AND x."role" = 'user' AND x."createdAt" <= m."createdAt"
  ORDER BY x."createdAt" DESC LIMIT 1
) u ON true
WHERE m."role" = 'model' AND m."sessionId" NOT LIKE 'audit-%';
