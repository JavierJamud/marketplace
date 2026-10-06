-- Bloque 260: varias conversaciones con el asistente de negocio (antes era un
-- solo hilo por persona). Cada mensaje pertenece a una conversación con título.

CREATE TABLE "AssistantConversation" (
    "id" TEXT NOT NULL,
    "scope" "AssistantScope" NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT,
    "title" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantConversation_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantConversation_scope_userId_vendorId_updatedAt_idx" ON "AssistantConversation"("scope", "userId", "vendorId", "updatedAt");

ALTER TABLE "AssistantMessage" ADD COLUMN "conversationId" TEXT;

-- Lo que ya existía queda como una conversación por persona, para no perder el
-- historial de nadie.
INSERT INTO "AssistantConversation" ("id", "scope", "userId", "vendorId", "title", "createdAt", "updatedAt")
SELECT 'c' || substr(md5(random()::text || clock_timestamp()::text || g."userId"), 1, 24),
       g."scope", g."userId", g."vendorId", 'Conversación anterior', g."firstAt", g."lastAt"
FROM (
    SELECT "scope", "userId", "vendorId", min("createdAt") AS "firstAt", max("createdAt") AS "lastAt"
    FROM "AssistantMessage"
    GROUP BY "scope", "userId", "vendorId"
) g;

UPDATE "AssistantMessage" m
SET "conversationId" = c."id"
FROM "AssistantConversation" c
WHERE c."scope" = m."scope" AND c."userId" = m."userId" AND c."vendorId" IS NOT DISTINCT FROM m."vendorId";

CREATE INDEX "AssistantMessage_conversationId_createdAt_idx" ON "AssistantMessage"("conversationId", "createdAt");

ALTER TABLE "AssistantMessage" ADD CONSTRAINT "AssistantMessage_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "AssistantConversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
