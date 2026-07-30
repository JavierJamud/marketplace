-- Bloque 62: recordatorios de inactividad, suspensión automática de tiendas
-- y re-enganche de clientes.

CREATE TYPE "VendorStatus" AS ENUM ('ACTIVE', 'SUSPENDED');

-- User.lastLoginAt: null para todos los usuarios existentes — se empieza a
-- contar desde el próximo login de cada uno, nunca se asume inactividad
-- retroactiva.
ALTER TABLE "User" ADD COLUMN "lastLoginAt" TIMESTAMP(3);

-- Vendor: backfill status=ACTIVE para todas las tiendas existentes (default
-- de la columna ya lo hace).
ALTER TABLE "Vendor" ADD COLUMN "status" "VendorStatus" NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "Vendor" ADD COLUMN "suspendedAt" TIMESTAMP(3);
ALTER TABLE "Vendor" ADD COLUMN "suspensionReason" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "reactivatedAt" TIMESTAMP(3);
ALTER TABLE "Vendor" ADD COLUMN "reactivationReason" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "lastInactivityEmailAt" TIMESTAMP(3);

ALTER TYPE "EmailType" ADD VALUE 'VENDOR_INACTIVITY_REMINDER';
ALTER TYPE "EmailType" ADD VALUE 'VENDOR_SUSPENDED';
ALTER TYPE "EmailType" ADD VALUE 'VENDOR_WINBACK';
ALTER TYPE "EmailType" ADD VALUE 'VENDOR_REACTIVATED';

ALTER TYPE "VendorNotificationType" ADD VALUE 'VENDOR_SUSPENDED';

CREATE TABLE "VendorStatusLog" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "fromStatus" "VendorStatus" NOT NULL,
    "toStatus" "VendorStatus" NOT NULL,
    "reason" TEXT,
    "byAdminId" TEXT,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VendorStatusLog_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "VendorStatusLog" ADD CONSTRAINT "VendorStatusLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VendorStatusLog" ADD CONSTRAINT "VendorStatusLog_byAdminId_fkey" FOREIGN KEY ("byAdminId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "WinbackEmailLog" (
    "id" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WinbackEmailLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WinbackEmailLog_customerId_vendorId_offerId_key" ON "WinbackEmailLog"("customerId", "vendorId", "offerId");
ALTER TABLE "WinbackEmailLog" ADD CONSTRAINT "WinbackEmailLog_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WinbackEmailLog" ADD CONSTRAINT "WinbackEmailLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WinbackEmailLog" ADD CONSTRAINT "WinbackEmailLog_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
