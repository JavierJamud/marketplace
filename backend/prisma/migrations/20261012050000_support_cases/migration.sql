ALTER TYPE "VendorNotificationType" ADD VALUE IF NOT EXISTS 'SUPPORT_CASE';

CREATE TYPE "SupportCaseKind" AS ENUM ('ORDER', 'WEB');
CREATE TYPE "SupportCaseStatus" AS ENUM ('OPEN', 'RESOLVED');

CREATE TABLE "SupportCase" (
    "id" TEXT NOT NULL,
    "kind" "SupportCaseKind" NOT NULL,
    "status" "SupportCaseStatus" NOT NULL DEFAULT 'OPEN',
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "message" TEXT,
    "orderCode" TEXT,
    "vendorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),
    CONSTRAINT "SupportCase_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SupportCase_status_createdAt_idx" ON "SupportCase"("status", "createdAt");
CREATE INDEX "SupportCase_vendorId_idx" ON "SupportCase"("vendorId");
ALTER TABLE "SupportCase" ADD CONSTRAINT "SupportCase_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
