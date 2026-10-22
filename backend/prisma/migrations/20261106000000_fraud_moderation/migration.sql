-- Moderación por reportes: reglas configurables, suspensión con apelación, avisos acumulados y lista negra.

ALTER TABLE "SiteSettings" ADD COLUMN "suspendedItemAppealDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "customerStrikeLimit" INTEGER NOT NULL DEFAULT 3,
ADD COLUMN "customerClaimDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "vendorStrikeLimit" INTEGER NOT NULL DEFAULT 5,
ADD COLUMN "vendorSupportContactDays" INTEGER NOT NULL DEFAULT 30,
ADD COLUMN "vendorFraudSuspensionDays" INTEGER NOT NULL DEFAULT 90;

ALTER TABLE "User" ADD COLUMN "fraudBlockedAt" TIMESTAMP(3),
ADD COLUMN "fraudClaimDueAt" TIMESTAMP(3),
ADD COLUMN "fraudStrikesResetAt" TIMESTAMP(3);

ALTER TABLE "Vendor" ADD COLUMN "fraudSuspendedAt" TIMESTAMP(3),
ADD COLUMN "fraudContactDueAt" TIMESTAMP(3),
ADD COLUMN "fraudDeleteAt" TIMESTAMP(3),
ADD COLUMN "fraudStrikesResetAt" TIMESTAMP(3);

ALTER TABLE "Product" ADD COLUMN "suspendedAt" TIMESTAMP(3),
ADD COLUMN "suspendedReason" TEXT;

ALTER TABLE "CustomerListing" ADD COLUMN "suspendedAt" TIMESTAMP(3),
ADD COLUMN "suspendedReason" TEXT,
ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN "contactClickCount" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Report" ALTER COLUMN "screenshotUrl" DROP NOT NULL,
ADD COLUMN "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "targetOwnerId" TEXT,
ADD COLUMN "targetVendorId" TEXT,
ADD COLUMN "targetLabel" TEXT,
ADD COLUMN "itemDeleteAt" TIMESTAMP(3),
ADD COLUMN "appealMessage" TEXT,
ADD COLUMN "appealImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN "appealSentAt" TIMESTAMP(3),
ADD COLUMN "appealStatus" TEXT,
ADD COLUMN "appealResolvedAt" TIMESTAMP(3),
ADD COLUMN "appealNote" TEXT;

-- Foto del objetivo en los reportes que ya existen (para contar avisos aunque el objetivo se borre).
UPDATE "Report" r SET "targetOwnerId" = l."ownerId", "targetLabel" = 'venta rápida "' || l."name" || '"' FROM "CustomerListing" l WHERE r."customerListingId" = l."id";
UPDATE "Report" r SET "targetVendorId" = p."vendorId", "targetOwnerId" = v."userId", "targetLabel" = 'producto "' || p."name" || '"' FROM "Product" p JOIN "Vendor" v ON v."id" = p."vendorId" WHERE r."productId" = p."id";
UPDATE "Report" r SET "targetVendorId" = v."id", "targetOwnerId" = v."userId", "targetLabel" = 'tienda "' || v."companyName" || '"' FROM "Vendor" v WHERE r."vendorId" = v."id";

-- El reporte sobrevive al borrado de su objetivo.
ALTER TABLE "Report" DROP CONSTRAINT "Report_productId_fkey";
ALTER TABLE "Report" ADD CONSTRAINT "Report_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" DROP CONSTRAINT "Report_vendorId_fkey";
ALTER TABLE "Report" ADD CONSTRAINT "Report_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Report" DROP CONSTRAINT "Report_customerListingId_fkey";
ALTER TABLE "Report" ADD CONSTRAINT "Report_customerListingId_fkey" FOREIGN KEY ("customerListingId") REFERENCES "CustomerListing"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE INDEX "Report_targetOwnerId_idx" ON "Report"("targetOwnerId");
CREATE INDEX "Report_targetVendorId_idx" ON "Report"("targetVendorId");
CREATE INDEX "Report_itemDeleteAt_idx" ON "Report"("itemDeleteAt");

CREATE TABLE "BlacklistEntry" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "idNumber" TEXT,
    "fullName" TEXT,
    "storeName" TEXT,
    "reason" TEXT NOT NULL,
    "userId" TEXT,
    "vendorId" TEXT,
    "addedById" TEXT,
    "removedAt" TIMESTAMP(3),
    "removedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlacklistEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "BlacklistEntry_email_idx" ON "BlacklistEntry"("email");
CREATE INDEX "BlacklistEntry_phone_idx" ON "BlacklistEntry"("phone");
CREATE INDEX "BlacklistEntry_idNumber_idx" ON "BlacklistEntry"("idNumber");
