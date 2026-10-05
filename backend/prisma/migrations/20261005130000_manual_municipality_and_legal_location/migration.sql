-- Bloque 247: municipio escrito a mano y ubicación legal de verificación en texto.

ALTER TYPE "LocationSuggestionKind" ADD VALUE 'MUNICIPALITY';

ALTER TABLE "LocationSuggestion" ADD COLUMN "provinceId" TEXT;
ALTER TABLE "LocationSuggestion" ADD COLUMN "resolvedMunicipalityId" TEXT;
ALTER TABLE "LocationSuggestion" ADD CONSTRAINT "LocationSuggestion_provinceId_fkey" FOREIGN KEY ("provinceId") REFERENCES "Province"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "User" ADD COLUMN "municipalityOther" TEXT;
ALTER TABLE "PendingRegistration" ADD COLUMN "municipalityOther" TEXT;
ALTER TABLE "VendorLocation" ADD COLUMN "municipalityOther" TEXT;

ALTER TABLE "Vendor" ADD COLUMN "registrationCountryOther" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "legalProvinceOther" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "legalMunicipalityOther" TEXT;
