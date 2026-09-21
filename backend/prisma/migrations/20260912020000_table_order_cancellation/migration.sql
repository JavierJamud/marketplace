-- AlterTable
ALTER TABLE "TableOrder" ADD COLUMN     "cancelReason" TEXT,
ADD COLUMN     "cancelledAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TableOrder_tableId_cancelledAt_idx" ON "TableOrder"("tableId", "cancelledAt");

