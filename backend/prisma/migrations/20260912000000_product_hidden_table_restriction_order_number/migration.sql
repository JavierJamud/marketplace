-- AlterTable
ALTER TABLE "Product" ADD COLUMN     "hiddenFromStore" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN     "tableRestricted" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable
-- updatedAt lleva DEFAULT CURRENT_TIMESTAMP acá (Prisma no lo generó solo)
-- únicamente para poder agregar la columna NOT NULL a filas de TableOrder ya
-- existentes sin romper — @updatedAt en el schema sigue manejando el valor
-- real en cada escritura desde la app de acá en adelante, este default es
-- solo el backfill de las filas viejas al correr esta migración.
ALTER TABLE "TableOrder" ADD COLUMN     "orderNumber" SERIAL NOT NULL,
ADD COLUMN     "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- CreateTable
CREATE TABLE "_ProductTableRestriction" (
    "A" TEXT NOT NULL,
    "B" TEXT NOT NULL
);

-- CreateIndex
CREATE UNIQUE INDEX "_ProductTableRestriction_AB_unique" ON "_ProductTableRestriction"("A", "B");

-- CreateIndex
CREATE INDEX "_ProductTableRestriction_B_index" ON "_ProductTableRestriction"("B");

-- CreateIndex
CREATE UNIQUE INDEX "TableOrder_orderNumber_key" ON "TableOrder"("orderNumber");

-- AddForeignKey
ALTER TABLE "_ProductTableRestriction" ADD CONSTRAINT "_ProductTableRestriction_A_fkey" FOREIGN KEY ("A") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "_ProductTableRestriction" ADD CONSTRAINT "_ProductTableRestriction_B_fkey" FOREIGN KEY ("B") REFERENCES "Table"("id") ON DELETE CASCADE ON UPDATE CASCADE;

