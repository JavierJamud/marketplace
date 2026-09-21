-- DropIndex
DROP INDEX "VendorSchedule_vendorId_dayOfWeek_key";

-- CreateIndex
CREATE INDEX "VendorSchedule_vendorId_dayOfWeek_idx" ON "VendorSchedule"("vendorId", "dayOfWeek");

