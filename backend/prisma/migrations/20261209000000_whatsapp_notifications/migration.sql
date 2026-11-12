-- Avisos por WhatsApp: número confirmado de cada cuenta y de cada tienda, cola de mensajes, sesión de la plataforma,
-- llaves cifradas de esa sesión, códigos de confirmación y números que pidieron la baja.
ALTER TABLE "User" ADD COLUMN "whatsappVerifiedPhone" TEXT, ADD COLUMN "whatsappVerifiedAt" TIMESTAMP(3);
ALTER TABLE "Vendor" ADD COLUMN "whatsappVerifiedPhone" TEXT, ADD COLUMN "whatsappVerifiedAt" TIMESTAMP(3);

CREATE TYPE "WhatsappMessageStatus" AS ENUM ('PENDING', 'SENDING', 'SENT', 'FAILED', 'EXPIRED', 'SKIPPED');

CREATE TABLE "WhatsappMessage" (
    "id" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "audience" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "userId" TEXT,
    "vendorId" TEXT,
    "refCode" TEXT,
    "body" TEXT NOT NULL,
    "secret" JSONB,
    "status" "WhatsappMessageStatus" NOT NULL DEFAULT 'PENDING',
    "priority" INTEGER NOT NULL DEFAULT 5,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "waMessageId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "nextAttemptAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "sentAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappMessage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsappMessage_dedupeKey_key" ON "WhatsappMessage"("dedupeKey");
CREATE INDEX "WhatsappMessage_status_priority_nextAttemptAt_idx" ON "WhatsappMessage"("status", "priority", "nextAttemptAt");
CREATE INDEX "WhatsappMessage_createdAt_idx" ON "WhatsappMessage"("createdAt");
CREATE INDEX "WhatsappMessage_phone_createdAt_idx" ON "WhatsappMessage"("phone", "createdAt");

CREATE TABLE "WhatsappSession" (
    "id" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'DISCONNECTED',
    "desired" TEXT NOT NULL DEFAULT 'OFF',
    "qr" TEXT,
    "qrAt" TIMESTAMP(3),
    "phone" TEXT,
    "pushName" TEXT,
    "connectedAt" TIMESTAMP(3),
    "lastSeenAt" TIMESTAMP(3),
    "lastError" TEXT,
    "paused" BOOLEAN NOT NULL DEFAULT false,
    "enabledKinds" JSONB,
    "hourlyLimit" INTEGER NOT NULL DEFAULT 60,
    "dailyLimit" INTEGER NOT NULL DEFAULT 400,
    "minDelaySec" INTEGER NOT NULL DEFAULT 4,
    "maxDelaySec" INTEGER NOT NULL DEFAULT 11,
    "downAlertAt" TIMESTAMP(3),
    "phoneReminderAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappSession_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappAuthKey" (
    "id" TEXT NOT NULL,
    "value" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappAuthKey_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "WhatsappVerification" (
    "id" TEXT NOT NULL,
    "target" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT,
    "phone" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "messageId" TEXT,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappVerification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "WhatsappVerification_userId_target_idx" ON "WhatsappVerification"("userId", "target");
CREATE INDEX "WhatsappVerification_phone_createdAt_idx" ON "WhatsappVerification"("phone", "createdAt");

CREATE TABLE "WhatsappOptOut" (
    "phone" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WhatsappOptOut_pkey" PRIMARY KEY ("phone")
);
