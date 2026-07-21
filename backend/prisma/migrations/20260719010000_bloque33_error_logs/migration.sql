-- CreateEnum
CREATE TYPE "ErrorOrigin" AS ENUM ('BOT_TIENDA', 'BOT_GENERAL', 'EMAIL_RESEND', 'STRIPE', 'TRANSCRIPCION_AUDIO', 'OTRO');

-- CreateTable
CREATE TABLE "ErrorLog" (
    "id" TEXT NOT NULL,
    "origin" "ErrorOrigin" NOT NULL,
    "message" TEXT NOT NULL,
    "context" JSONB,
    "resolved" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ErrorLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ErrorLog_resolved_createdAt_idx" ON "ErrorLog"("resolved", "createdAt");

-- CreateIndex
CREATE INDEX "ErrorLog_origin_createdAt_idx" ON "ErrorLog"("origin", "createdAt");
