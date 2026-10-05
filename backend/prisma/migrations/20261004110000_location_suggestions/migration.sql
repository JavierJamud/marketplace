-- Bloque 244 (pedido explícito): países y provincias escritos a mano en el
-- registro quedan como solicitudes que el admin revisa (aprobar, fusionar o
-- rechazar), en vez de perderse en campos de texto que ningún panel leía.
CREATE TYPE "LocationSuggestionKind" AS ENUM ('COUNTRY', 'PROVINCE');
CREATE TYPE "LocationSuggestionStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED', 'MERGED');

-- La tienda también puede registrarse en un país que todavía no está cargado.
ALTER TABLE "VendorLocation" ADD COLUMN "countryOther" TEXT;

CREATE TABLE "LocationSuggestion" (
    "id" TEXT NOT NULL,
    "kind" "LocationSuggestionKind" NOT NULL,
    "name" TEXT NOT NULL,
    "normalizedName" TEXT NOT NULL,
    "countryId" TEXT,
    "status" "LocationSuggestionStatus" NOT NULL DEFAULT 'PENDING',
    "mentionCount" INTEGER NOT NULL DEFAULT 1,
    "resolvedCountryId" TEXT,
    "resolvedProvinceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedAt" TIMESTAMP(3),

    CONSTRAINT "LocationSuggestion_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "LocationSuggestion_status_kind_idx" ON "LocationSuggestion"("status", "kind");
CREATE INDEX "LocationSuggestion_normalizedName_idx" ON "LocationSuggestion"("normalizedName");

ALTER TABLE "LocationSuggestion" ADD CONSTRAINT "LocationSuggestion_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
