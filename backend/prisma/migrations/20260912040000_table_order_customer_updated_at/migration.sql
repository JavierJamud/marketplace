-- AlterTable
ALTER TABLE "TableOrder" ADD COLUMN     "customerUpdatedAt" TIMESTAMP(3);

-- CreateIndex
CREATE INDEX "TableOrder_tableId_customerUpdatedAt_idx" ON "TableOrder"("tableId", "customerUpdatedAt");
