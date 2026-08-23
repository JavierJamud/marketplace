-- Feature B (pedido explícito): reportes de fraude sobre producto/tienda/
-- venta rápida.
--
-- NOTA: `prisma migrate diff` propuso además:
--   DROP INDEX "Product_name_trgm_idx";
--   DROP INDEX "Vendor_companyName_trgm_idx";
-- Son índices GIN trigram creados a mano por SQL crudo (no expresables en
-- schema.prisma), así que el diff automático siempre los marca como "no
-- están en el schema, hay que borrarlos" — falso positivo recurrente (ver
-- migraciones de Fase 0 y de customer_listings). Se omiten deliberadamente.

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('PENDING', 'EVIDENCE_REQUESTED', 'RESOLVED_NO_ACTION', 'RESOLVED_SUSPENDED', 'DISMISSED');

-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'FRAUD_REPORT_EVIDENCE_REQUESTED';
ALTER TYPE "EmailType" ADD VALUE 'FRAUD_REPORT_DISMISSED';
ALTER TYPE "EmailType" ADD VALUE 'FRAUD_REPORT_SUSPENDED';

-- AlterEnum
ALTER TYPE "VendorNotificationType" ADD VALUE 'FRAUD_REPORT_EVIDENCE_REQUESTED';
ALTER TYPE "VendorNotificationType" ADD VALUE 'FRAUD_REPORT_DISMISSED';
ALTER TYPE "VendorNotificationType" ADD VALUE 'FRAUD_REPORT_SUSPENDED';

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN     "fraudReportEvidenceDeadlineDays" INTEGER NOT NULL DEFAULT 5;

-- CreateTable
CREATE TABLE "Report" (
    "id" TEXT NOT NULL,
    "reporterId" TEXT NOT NULL,
    "productId" TEXT,
    "vendorId" TEXT,
    "customerListingId" TEXT,
    "screenshotUrl" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "status" "ReportStatus" NOT NULL DEFAULT 'PENDING',
    "evidenceRequestedAt" TIMESTAMP(3),
    "evidenceDueAt" TIMESTAMP(3),
    "evidenceMessage" TEXT,
    "evidenceImages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "evidenceSentAt" TIMESTAMP(3),
    "autoResolved" BOOLEAN NOT NULL DEFAULT false,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "resolutionNote" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Report_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "Report_reporterId_idx" ON "Report"("reporterId");

-- CreateIndex
CREATE INDEX "Report_status_idx" ON "Report"("status");

-- CreateIndex
CREATE INDEX "Report_productId_idx" ON "Report"("productId");

-- CreateIndex
CREATE INDEX "Report_vendorId_idx" ON "Report"("vendorId");

-- CreateIndex
CREATE INDEX "Report_customerListingId_idx" ON "Report"("customerListingId");

-- CreateIndex
CREATE INDEX "Report_evidenceDueAt_idx" ON "Report"("evidenceDueAt");

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Report" ADD CONSTRAINT "Report_customerListingId_fkey" FOREIGN KEY ("customerListingId") REFERENCES "CustomerListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
