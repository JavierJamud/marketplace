-- Bloque 75: motivo de bloqueo del vendedor + número de soporte configurable.

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "blockReason" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "supportWhatsapp" TEXT;
