-- Bloque 304: hasta dos sitios por solicitud de socio.
ALTER TABLE "PartnerApplication" ADD COLUMN "websites" TEXT[] DEFAULT ARRAY[]::TEXT[];
UPDATE "PartnerApplication" SET "websites" = ARRAY["website"] WHERE "website" IS NOT NULL;
