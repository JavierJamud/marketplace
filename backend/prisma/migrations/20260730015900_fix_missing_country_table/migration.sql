-- Fix de historial de migraciones (mismo patrón que
-- 20260723235900_fix_missing_vendor_notification_type): los modelos
-- "Country" y "VendorDeliveryCountry" de schema.prisma nunca se crearon en
-- una migración — a diferencia de Province/Municipality/ProvinceAdjacency,
-- que sí quedaron en 20260709151616_init. Se agregaron después (comentario
-- del schema los referencia como "Bloque 66") vía `prisma db push` contra la
-- base real, sin generar migración. La migración bloque66
-- (20260730020000_bloque66_badges_verification_legal) ya asume que "Country"
-- existe (agrega un FK contra ella), así que cualquier instalación desde
-- cero fallaba ahí.
--
-- Idempotente: en la base real, donde ambas tablas ya existen, es un no-op.

CREATE TABLE IF NOT EXISTS "Country" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Country_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "Country_code_key" ON "Country"("code");

CREATE TABLE IF NOT EXISTS "VendorDeliveryCountry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "countryId" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorDeliveryCountry_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "VendorDeliveryCountry_vendorId_countryId_key" ON "VendorDeliveryCountry"("vendorId", "countryId");

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VendorDeliveryCountry_vendorId_fkey'
  ) THEN
    ALTER TABLE "VendorDeliveryCountry" ADD CONSTRAINT "VendorDeliveryCountry_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VendorDeliveryCountry_countryId_fkey'
  ) THEN
    ALTER TABLE "VendorDeliveryCountry" ADD CONSTRAINT "VendorDeliveryCountry_countryId_fkey"
      FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
