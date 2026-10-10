-- Bloque 303: credencial visible (cifrada), solicitudes de socios y correo de avisos de socios.
ALTER TABLE "PartnerApiKey" ADD COLUMN "keyEnc" TEXT;
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'PARTNER_NOTICE';

CREATE TYPE "PartnerApplicationStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

CREATE TABLE "PartnerApplication" (
    "id" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "website" TEXT,
    "description" TEXT NOT NULL,
    "passwordHash" TEXT NOT NULL,
    "status" "PartnerApplicationStatus" NOT NULL DEFAULT 'PENDING',
    "rejectReason" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "partnerId" TEXT,
    "ip" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "PartnerApplication_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PartnerApplication_partnerId_key" ON "PartnerApplication"("partnerId");
CREATE INDEX "PartnerApplication_status_createdAt_idx" ON "PartnerApplication"("status", "createdAt");
CREATE INDEX "PartnerApplication_email_idx" ON "PartnerApplication"("email");
ALTER TABLE "PartnerApplication" ADD CONSTRAINT "PartnerApplication_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;
