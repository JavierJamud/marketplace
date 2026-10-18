-- Bajada de plan programada por el admin.
ALTER TABLE "Vendor" ADD COLUMN "planDowngradeAt" TIMESTAMP(3);
ALTER TABLE "Vendor" ADD COLUMN "planDowngradeReason" TEXT;

-- Uso del panel por tienda, sección y día.
CREATE TABLE "VendorSectionUsage" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "day" DATE NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "activeMs" INTEGER NOT NULL DEFAULT 0,
    "actions" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "VendorSectionUsage_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VendorSectionUsage_vendorId_section_day_key" ON "VendorSectionUsage"("vendorId", "section", "day");
CREATE INDEX "VendorSectionUsage_day_idx" ON "VendorSectionUsage"("day");
ALTER TABLE "VendorSectionUsage" ADD CONSTRAINT "VendorSectionUsage_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Análisis de uso hecho con IA (por tienda o de todas).
CREATE TABLE "UsageInsight" (
    "scope" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "UsageInsight_pkey" PRIMARY KEY ("scope")
);
