-- Bloque 246: asistente de negocio con IA (solo lectura).

-- Interruptor por plan: apagado por defecto, se enciende para el plan de pago
-- (BUSINESS) que es el que lo ofrece; el admin lo ajusta en Suscripciones.
ALTER TABLE "PlanConfig" ADD COLUMN "allowAiAssistant" BOOLEAN NOT NULL DEFAULT false;
UPDATE "PlanConfig" SET "allowAiAssistant" = true WHERE "planType" = 'BUSINESS';

CREATE TYPE "AssistantScope" AS ENUM ('ADMIN', 'VENDOR');

CREATE TABLE "AssistantMessage" (
    "id" TEXT NOT NULL,
    "scope" "AssistantScope" NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "toolsUsed" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "links" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantMessage_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AssistantMessage_scope_userId_vendorId_createdAt_idx" ON "AssistantMessage"("scope", "userId", "vendorId", "createdAt");
