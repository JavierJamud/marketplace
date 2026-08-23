-- Fix de historial de migraciones: el enum "VendorNotificationType" y la
-- tabla "VendorNotification" (modelo VendorNotification en schema.prisma)
-- nunca se crearon en una migración — se agregaron al schema y se
-- aplicaron contra la base de desarrollo real con `prisma db push`, no con
-- `migrate dev`. La migración bloque46 (20260724000000) ya asume que el
-- enum existe (`ALTER TYPE ... ADD VALUE`), así que cualquier instalación
-- desde cero (`prisma migrate deploy` en una base nueva) fallaba ahí.
--
-- Este fix es idempotente a propósito: en la base real, donde el tipo y la
-- tabla YA existen, es un no-op. En una base nueva, los crea con los 4
-- valores originales del enum — los valores agregados después
-- (VERIFICATION_BUSINESS_REVOKED, VENDOR_SUSPENDED, VERIFICATION_PAYMENT_FAILED,
-- VERIFICATION_SUSPENDED) siguen viniendo de sus propias migraciones
-- posteriores, sin duplicarlos acá.

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VendorNotificationType') THEN
    CREATE TYPE "VendorNotificationType" AS ENUM (
      'VERIFICATION_DOCS_APPROVED',
      'VERIFICATION_DOCS_REJECTED',
      'VERIFICATION_PAYMENT_LINK_SENT',
      'VERIFICATION_VERIFIED'
    );
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "VendorNotification" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "VendorNotificationType" NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorNotification_pkey" PRIMARY KEY ("id")
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'VendorNotification_vendorId_fkey'
  ) THEN
    ALTER TABLE "VendorNotification" ADD CONSTRAINT "VendorNotification_vendorId_fkey"
      FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
