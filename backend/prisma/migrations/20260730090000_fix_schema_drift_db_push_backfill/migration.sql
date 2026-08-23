-- Fix de drift acumulado entre schema.prisma y el historial de migraciones.
--
-- Diagnóstico: además de los 3 fixes puntuales ya agregados (20260723235900,
-- 20260730015900, y el ajuste dentro de 20260729020000), corrí
-- `npx prisma migrate diff --from-url <db> --to-schema-datamodel schema.prisma`
-- contra una base con todas las migraciones aplicadas y encontró que ninguna
-- migración committeada requiere nada de lo que sigue para aplicarse (todas
-- corren limpio) — este drift es puramente "cosas que la app/el seed
-- necesitan en runtime, agregadas contra la base real vía `prisma db push`,
-- nunca migradas". Por eso este fix va al FINAL del historial (no insertado
-- a mitad de camino como los otros 3): no hay un punto cronológico "correcto"
-- único, porque mezcla trabajo de varios períodos (categorías de negocio,
-- chat de tienda, solicitudes de reposición, pagos de verificación, etc.).
--
-- Idempotente en todo: en la base real, donde todo esto ya existe, es un
-- no-op completo. En una base nueva, la deja igual a schema.prisma.
--
-- Deliberadamente EXCLUIDO de este fix (visto en el diff pero incorrecto
-- aplicarlo): dos "DROP INDEX" sobre "Product_name_trgm_idx" y
-- "Vendor_companyName_trgm_idx". Son índices trigram creados a mano con SQL
-- crudo (extensión pg_trgm, bloque 40/52) que schema.prisma no puede expresar
-- de forma declarativa — el diff los marca como "de más" por esa limitación
-- de la herramienta, no porque sobren. Borrarlos degradaría la búsqueda.

-- Enum nuevo (pagos de verificación: tarjeta vs. transferencia CUP)
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VerificationPaymentMethod') THEN
    CREATE TYPE "VerificationPaymentMethod" AS ENUM ('CARD', 'CUP_TRANSFER');
  END IF;
END $$;

-- Valores nuevos de EmailType
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'VERIFICATION_UPDATE';
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'TABLE_ORDER_STATUS';

-- Tablas nuevas nunca migradas
CREATE TABLE IF NOT EXISTS "BusinessCategory" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BusinessCategory_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BusinessCategory_slug_key" ON "BusinessCategory"("slug");

CREATE TABLE IF NOT EXISTS "ChatMessage" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ChatMessage_vendorId_sessionId_idx" ON "ChatMessage"("vendorId", "sessionId");

CREATE TABLE IF NOT EXISTS "ProductRequest" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerId" TEXT,
    "guestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProductRequest_productId_idx" ON "ProductRequest"("productId");
CREATE INDEX IF NOT EXISTS "ProductRequest_vendorId_createdAt_idx" ON "ProductRequest"("vendorId", "createdAt");

-- Columnas faltantes en tablas existentes
ALTER TABLE "Favorite"
  ADD COLUMN IF NOT EXISTS "vendorId" TEXT,
  ALTER COLUMN "productId" DROP NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS "Favorite_userId_vendorId_key" ON "Favorite"("userId", "vendorId");

ALTER TABLE "Municipality"
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true;

ALTER TABLE "Offer"
  ALTER COLUMN "updatedAt" DROP DEFAULT;

ALTER TABLE "Product"
  ADD COLUMN IF NOT EXISTS "availableForTableMenu" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Province"
  ADD COLUMN IF NOT EXISTS "countryId" TEXT,
  ADD COLUMN IF NOT EXISTS "isActive" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "type" TEXT NOT NULL DEFAULT 'PROVINCE';

ALTER TABLE "Review"
  ADD COLUMN IF NOT EXISTS "isHidden" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "isVerifiedPurchase" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "userId" TEXT,
  ADD COLUMN IF NOT EXISTS "vendorRepliedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "vendorReply" TEXT;

ALTER TABLE "SiteSettings"
  ADD COLUMN IF NOT EXISTS "maxDeliveryCountriesBusiness" INTEGER NOT NULL DEFAULT 5,
  ADD COLUMN IF NOT EXISTS "maxDeliveryCountriesRegular" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "maxProvincesBusiness" INTEGER,
  ADD COLUMN IF NOT EXISTS "maxProvincesRegular" INTEGER NOT NULL DEFAULT 1;

ALTER TABLE "TableOrder"
  ADD COLUMN IF NOT EXISTS "customerEmail" TEXT;

ALTER TABLE "Vendor"
  ADD COLUMN IF NOT EXISTS "aiDocumentName" TEXT,
  ADD COLUMN IF NOT EXISTS "businessCategoryId" TEXT;

ALTER TABLE "VerificationRequest"
  ADD COLUMN IF NOT EXISTS "paymentConfirmedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "paymentConfirmedById" TEXT,
  ADD COLUMN IF NOT EXISTS "paymentMethod" "VerificationPaymentMethod",
  ADD COLUMN IF NOT EXISTS "paymentProofUrl" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeCheckoutExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "stripeCheckoutSessionId" TEXT,
  ADD COLUMN IF NOT EXISTS "stripeCheckoutUrl" TEXT;

-- Foreign keys faltantes
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Province_countryId_fkey') THEN
    ALTER TABLE "Province" ADD CONSTRAINT "Province_countryId_fkey"
      FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Vendor_businessCategoryId_fkey') THEN
    ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_businessCategoryId_fkey"
      FOREIGN KEY ("businessCategoryId") REFERENCES "BusinessCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VerificationRequest_paymentConfirmedById_fkey') THEN
    ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_paymentConfirmedById_fkey"
      FOREIGN KEY ("paymentConfirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Review_userId_fkey') THEN
    ALTER TABLE "Review" ADD CONSTRAINT "Review_userId_fkey"
      FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Favorite_vendorId_fkey') THEN
    ALTER TABLE "Favorite" ADD CONSTRAINT "Favorite_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ChatMessage_vendorId_fkey') THEN
    ALTER TABLE "ChatMessage" ADD CONSTRAINT "ChatMessage_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductRequest_productId_fkey') THEN
    ALTER TABLE "ProductRequest" ADD CONSTRAINT "ProductRequest_productId_fkey"
      FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductRequest_vendorId_fkey') THEN
    ALTER TABLE "ProductRequest" ADD CONSTRAINT "ProductRequest_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProductRequest_customerId_fkey') THEN
    ALTER TABLE "ProductRequest" ADD CONSTRAINT "ProductRequest_customerId_fkey"
      FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;
