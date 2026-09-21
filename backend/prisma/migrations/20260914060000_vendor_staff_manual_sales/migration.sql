-- Bloque 198: "Ventas manuales" — inventario por usuario de sistema, ventas
-- registradas a mano, y recordatorio de cuadre de caja.

-- CreateEnum
CREATE TYPE "CashCloseFrequency" AS ENUM ('DAILY', 'WEEKLY', 'MONTHLY');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "cashCloseFrequency" "CashCloseFrequency",
ADD COLUMN     "cashCloseDayOfWeek" INTEGER,
ADD COLUMN     "cashCloseDayOfMonth" INTEGER,
ADD COLUMN     "cashCloseReminderSentAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "VendorStaff" ADD COLUMN     "phone" TEXT;

-- CreateTable
CREATE TABLE "VendorStaffAllocation" (
    "id" TEXT NOT NULL,
    "vendorStaffId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "allocatedQty" INTEGER NOT NULL DEFAULT 0,
    "remainingQty" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorStaffAllocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorStaffSale" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "vendorStaffId" TEXT NOT NULL,
    "productId" TEXT,
    "productName" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "total" DECIMAL(12,2) NOT NULL,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorStaffSale_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorStaffCashClose" (
    "id" TEXT NOT NULL,
    "vendorStaffId" TEXT NOT NULL,
    "periodStart" TIMESTAMP(3) NOT NULL,
    "periodEnd" TIMESTAMP(3) NOT NULL,
    "totalSales" DECIMAL(12,2) NOT NULL,
    "reportedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "note" TEXT,

    CONSTRAINT "VendorStaffCashClose_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorStaffAllocation_vendorStaffId_productId_key" ON "VendorStaffAllocation"("vendorStaffId", "productId");

-- CreateIndex
CREATE INDEX "VendorStaffAllocation_productId_idx" ON "VendorStaffAllocation"("productId");

-- CreateIndex
CREATE INDEX "VendorStaffSale_vendorId_createdAt_idx" ON "VendorStaffSale"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorStaffSale_vendorStaffId_createdAt_idx" ON "VendorStaffSale"("vendorStaffId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorStaffCashClose_vendorStaffId_periodStart_idx" ON "VendorStaffCashClose"("vendorStaffId", "periodStart");

-- AddForeignKey
ALTER TABLE "VendorStaffAllocation" ADD CONSTRAINT "VendorStaffAllocation_vendorStaffId_fkey" FOREIGN KEY ("vendorStaffId") REFERENCES "VendorStaff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorStaffAllocation" ADD CONSTRAINT "VendorStaffAllocation_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorStaffSale" ADD CONSTRAINT "VendorStaffSale_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorStaffSale" ADD CONSTRAINT "VendorStaffSale_vendorStaffId_fkey" FOREIGN KEY ("vendorStaffId") REFERENCES "VendorStaff"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorStaffSale" ADD CONSTRAINT "VendorStaffSale_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorStaffCashClose" ADD CONSTRAINT "VendorStaffCashClose_vendorStaffId_fkey" FOREIGN KEY ("vendorStaffId") REFERENCES "VendorStaff"("id") ON DELETE CASCADE ON UPDATE CASCADE;
