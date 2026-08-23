-- Nota: Prisma generó acá dos DROP INDEX sobre "Product_name_trgm_idx" y
-- "Vendor_companyName_trgm_idx" porque schema.prisma no puede expresar
-- índices GIN de trigramas de forma declarativa (son SQL crudo del bloque
-- 40/52, ver 20260727020000_pg_trgm_extension). Se quitan a propósito —
-- borrarlos degradaría la búsqueda del sitio. Mismo criterio ya aplicado en
-- 20260730090000_fix_schema_drift_db_push_backfill.

-- CreateTable
CREATE TABLE "CustomerListing" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" "ProductCurrency" NOT NULL DEFAULT 'USD',
    "images" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "isActive" BOOLEAN NOT NULL DEFAULT false,
    "activatedAt" TIMESTAMP(3),
    "isSold" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "CustomerListing_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CustomerListing_ownerId_idx" ON "CustomerListing"("ownerId");

-- CreateIndex
CREATE INDEX "CustomerListing_expiresAt_idx" ON "CustomerListing"("expiresAt");

-- AddForeignKey
ALTER TABLE "CustomerListing" ADD CONSTRAINT "CustomerListing_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
