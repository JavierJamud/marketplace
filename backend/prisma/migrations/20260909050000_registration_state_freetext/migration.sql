-- Bloque 114 (pedido explícito): fuera de Cuba ya no se elige una
-- provincia/estado del catálogo (`Province` type=STATE) — se escribe a mano
-- ("estado" + "dirección" libres). `VendorLocation.provinceId` pasa a ser
-- opcional y suma `countryId` (para saber a qué país pertenece un local sin
-- provincia real) + `stateOther`.

-- AlterTable "User"
ALTER TABLE "User" ADD COLUMN "stateOther" TEXT;

-- AlterTable "PendingRegistration"
ALTER TABLE "PendingRegistration"
  ADD COLUMN "stateOther" TEXT,
  ADD COLUMN "address" TEXT;

-- AlterTable "VendorLocation": provinceId ya no es NOT NULL, se suma countryId/stateOther.
ALTER TABLE "VendorLocation"
  ALTER COLUMN "provinceId" DROP NOT NULL,
  ADD COLUMN "countryId" TEXT,
  ADD COLUMN "stateOther" TEXT;

-- La FK vieja de provinceId tenía ON DELETE CASCADE; con la columna ahora
-- opcional eso ya no tiene sentido (borrar una tienda entera porque se
-- desactivó/borró una provincia) — se recrea como SET NULL, mismo criterio
-- que el resto de las relaciones de ubicación (User.province, etc.).
ALTER TABLE "VendorLocation" DROP CONSTRAINT "VendorLocation_provinceId_fkey";
ALTER TABLE "VendorLocation" ADD CONSTRAINT "VendorLocation_provinceId_fkey"
  FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "VendorLocation" ADD CONSTRAINT "VendorLocation_countryId_fkey"
  FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Backfill: las VendorLocation existentes (todas de Cuba hasta ahora) quedan
-- con countryId apuntando a CUBA, para que ninguna quede huérfana de país.
UPDATE "VendorLocation" vl
SET "countryId" = c.id
FROM "Province" p
JOIN "Country" c ON c.id = p."countryId"
WHERE vl."provinceId" = p.id AND vl."countryId" IS NULL;
