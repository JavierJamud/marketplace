-- Sesión en la que empezó cada conversación del asistente de negocio: cada inicio de sesión abre una nueva.
ALTER TABLE "AssistantConversation" ADD COLUMN "sessionId" TEXT;
CREATE INDEX "AssistantConversation_updatedAt_idx" ON "AssistantConversation"("updatedAt");
