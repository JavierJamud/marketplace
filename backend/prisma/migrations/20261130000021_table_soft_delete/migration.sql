-- Mesas eliminadas que tenían cuentas: se ocultan (deletedAt) en vez de borrarse, porque TableOrder cae en cascada con la
-- mesa y el historial cobrado o cancelado se perdía. Ver deleteTable en tables.controller.js.
ALTER TABLE "Table" ADD COLUMN "deletedAt" TIMESTAMP(3);
