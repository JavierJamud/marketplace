-- Bloque 76: fecha de bloqueo manual, para ordenar/mostrar en "Tiendas suspendidas".

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "blockedAt" TIMESTAMP(3);
