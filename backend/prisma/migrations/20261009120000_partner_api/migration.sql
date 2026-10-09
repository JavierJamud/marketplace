-- Partner API fase 1: socios, llaves, movimientos y totales de uso; tienda atribuida a un socio.
CREATE TYPE "PartnerStatus" AS ENUM ('ACTIVE', 'SUSPENDED');
CREATE TYPE "PartnerKeyKind" AS ENUM ('BROWSER', 'SERVER');
CREATE TYPE "PartnerKeyStatus" AS ENUM ('ACTIVE', 'REVOKED');

CREATE TABLE "Partner" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "code" TEXT NOT NULL,
  "contactEmail" TEXT NOT NULL,
  "contactName" TEXT,
  "website" TEXT,
  "status" "PartnerStatus" NOT NULL DEFAULT 'ACTIVE',
  "listInMarketplace" BOOLEAN NOT NULL DEFAULT true,
  "notes" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Partner_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "Partner_code_key" ON "Partner"("code");

CREATE TABLE "PartnerApiKey" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "kind" "PartnerKeyKind" NOT NULL,
  "prefix" TEXT NOT NULL,
  "keyHash" TEXT NOT NULL,
  "scopes" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "rateLimitPerMinute" INTEGER NOT NULL DEFAULT 1200,
  "dailyLimit" INTEGER NOT NULL DEFAULT 500000,
  "allowedDomains" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "allowedIps" TEXT[] DEFAULT ARRAY[]::TEXT[],
  "status" "PartnerKeyStatus" NOT NULL DEFAULT 'ACTIVE',
  "expiresAt" TIMESTAMP(3),
  "lastUsedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "revokedAt" TIMESTAMP(3),
  CONSTRAINT "PartnerApiKey_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PartnerApiKey_keyHash_key" ON "PartnerApiKey"("keyHash");
CREATE INDEX "PartnerApiKey_partnerId_idx" ON "PartnerApiKey"("partnerId");
ALTER TABLE "PartnerApiKey" ADD CONSTRAINT "PartnerApiKey_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PartnerApiLog" (
  "id" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "keyId" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL,
  "method" TEXT NOT NULL,
  "status" INTEGER NOT NULL,
  "ms" INTEGER NOT NULL,
  "ip" TEXT,
  "origin" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PartnerApiLog_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PartnerApiLog_partnerId_createdAt_idx" ON "PartnerApiLog"("partnerId", "createdAt");
CREATE INDEX "PartnerApiLog_keyId_createdAt_idx" ON "PartnerApiLog"("keyId", "createdAt");
CREATE INDEX "PartnerApiLog_createdAt_idx" ON "PartnerApiLog"("createdAt");
ALTER TABLE "PartnerApiLog" ADD CONSTRAINT "PartnerApiLog_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerApiLog" ADD CONSTRAINT "PartnerApiLog_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "PartnerApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "PartnerApiUsageHour" (
  "keyId" TEXT NOT NULL,
  "hour" TIMESTAMP(3) NOT NULL,
  "endpoint" TEXT NOT NULL,
  "partnerId" TEXT NOT NULL,
  "requests" INTEGER NOT NULL DEFAULT 0,
  "errors" INTEGER NOT NULL DEFAULT 0,
  "totalMs" BIGINT NOT NULL DEFAULT 0,
  CONSTRAINT "PartnerApiUsageHour_pkey" PRIMARY KEY ("keyId", "hour", "endpoint")
);
CREATE INDEX "PartnerApiUsageHour_partnerId_hour_idx" ON "PartnerApiUsageHour"("partnerId", "hour");
ALTER TABLE "PartnerApiUsageHour" ADD CONSTRAINT "PartnerApiUsageHour_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "PartnerApiUsageHour" ADD CONSTRAINT "PartnerApiUsageHour_keyId_fkey" FOREIGN KEY ("keyId") REFERENCES "PartnerApiKey"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Vendor" ADD COLUMN "partnerId" TEXT;
CREATE INDEX "Vendor_partnerId_idx" ON "Vendor"("partnerId");
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
