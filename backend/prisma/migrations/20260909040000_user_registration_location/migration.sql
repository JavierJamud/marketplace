-- Bloque 113 (pedido explícito): registro reforzado — el cliente/vendedor
-- elige país (del catálogo real del admin, con "otro país" como texto
-- libre si el suyo no está) y, si es Cuba, provincia+municipio real donde
-- vive/opera; si es otro país ya cargado, provincia/estado.

-- AlterTable "User"
ALTER TABLE "User"
  ADD COLUMN "registrationCountryId" TEXT,
  ADD COLUMN "registrationCountryOther" TEXT,
  ADD COLUMN "municipalityId" TEXT;

ALTER TABLE "User" ADD CONSTRAINT "User_registrationCountryId_fkey"
  FOREIGN KEY ("registrationCountryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "User" ADD CONSTRAINT "User_municipalityId_fkey"
  FOREIGN KEY ("municipalityId") REFERENCES "Municipality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AlterTable "PendingRegistration" (staging efímero — sin FK, mismo criterio
-- que la columna "country" que ya tenía).
ALTER TABLE "PendingRegistration"
  ADD COLUMN "registrationCountryId" TEXT,
  ADD COLUMN "registrationCountryOther" TEXT,
  ADD COLUMN "provinceId" TEXT,
  ADD COLUMN "municipalityId" TEXT;
