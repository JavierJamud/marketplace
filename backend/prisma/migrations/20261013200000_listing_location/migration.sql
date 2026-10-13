-- Venta rápida: país, provincia o estado y municipio propios de cada anuncio (por defecto los del perfil, editables al publicar).
ALTER TABLE "CustomerListing" ADD COLUMN "countryId" TEXT;
ALTER TABLE "CustomerListing" ADD COLUMN "provinceId" TEXT;
ALTER TABLE "CustomerListing" ADD COLUMN "municipalityId" TEXT;
ALTER TABLE "CustomerListing" ADD COLUMN "stateOther" TEXT;

CREATE INDEX "CustomerListing_countryId_idx" ON "CustomerListing"("countryId");
CREATE INDEX "CustomerListing_provinceId_idx" ON "CustomerListing"("provinceId");
CREATE INDEX "CustomerListing_municipalityId_idx" ON "CustomerListing"("municipalityId");

ALTER TABLE "CustomerListing" ADD CONSTRAINT "CustomerListing_countryId_fkey" FOREIGN KEY ("countryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerListing" ADD CONSTRAINT "CustomerListing_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "CustomerListing" ADD CONSTRAINT "CustomerListing_municipalityId_fkey" FOREIGN KEY ("municipalityId") REFERENCES "Municipality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Los anuncios que ya existen toman el lugar del perfil de su dueño.
UPDATE "CustomerListing" l
SET "provinceId" = u."provinceId",
    "municipalityId" = u."municipalityId",
    "stateOther" = u."stateOther",
    "countryId" = COALESCE(u."registrationCountryId", (SELECT p."countryId" FROM "Province" p WHERE p."id" = u."provinceId"))
FROM "User" u
WHERE u."id" = l."ownerId";
