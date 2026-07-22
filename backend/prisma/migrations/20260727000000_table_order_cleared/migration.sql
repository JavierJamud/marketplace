-- VendorTables.jsx: "Ocupada"/"Libre" pasa de depender de kitchenStatus
-- (llegar a READY ya liberaba la mesa) a depender de clearedAt (el vendedor
-- marca a mano que el cliente pagó y se retiró).
ALTER TABLE "TableOrder" ADD COLUMN "clearedAt" TIMESTAMP(3);

-- Backfill: los pedidos que YA estaban en Listo antes de este cambio deben
-- seguir contando como "mesa liberada" bajo el modelo viejo — si no se
-- backfillea, listMyTables los mostraría como recién ocupados de nuevo.
UPDATE "TableOrder" SET "clearedAt" = "createdAt" WHERE "kitchenStatus" = 'READY';

CREATE INDEX "TableOrder_tableId_clearedAt_idx" ON "TableOrder"("tableId", "clearedAt");
