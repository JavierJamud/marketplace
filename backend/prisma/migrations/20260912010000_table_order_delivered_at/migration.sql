-- AlterTable
ALTER TABLE "TableOrder" ADD COLUMN     "deliveredAt" TIMESTAMP(3),
ALTER COLUMN "updatedAt" DROP DEFAULT;

-- Backfill real (bug encontrado al probar en vivo): cualquier TableOrder que
-- ya se haya liberado (clearedAt seteado) ANTES de que existiera esta
-- columna obviamente ya fue entregado en su momento — sin esto, esas filas
-- viejas quedarían con deliveredAt NULL para siempre y createTableOrder/
-- getTableByToken las seguirían contando como "pedido activo sin entregar",
-- bloqueando esa mesa para pedidos nuevos por error.
UPDATE "TableOrder" SET "deliveredAt" = "clearedAt" WHERE "clearedAt" IS NOT NULL AND "deliveredAt" IS NULL;

-- CreateIndex
CREATE INDEX "TableOrder_tableId_deliveredAt_idx" ON "TableOrder"("tableId", "deliveredAt");

