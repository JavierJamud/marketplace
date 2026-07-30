-- Bloque 66: carrito con tallas (sin campos nuevos), catálogo de etiquetas de
-- producto, datos legales de verificación, tipo de documento, pago CUP
-- reclamado sin comprobante obligatorio, y cancelación diferida de suscripción.

-- CreateEnum
CREATE TYPE "IdDocumentType" AS ENUM ('NATIONAL_ID', 'PASSPORT', 'INTERNATIONAL_ID');

-- Product: ancla real de activación para la expiración de la etiqueta "Nuevo".
ALTER TABLE "Product" ADD COLUMN "activatedAt" TIMESTAMP(3);

-- Vendor: datos legales privados de verificación + cancelación diferida.
ALTER TABLE "Vendor" ADD COLUMN "companyTaxId" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "registrationCountryId" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "legalProvinceId" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "legalMunicipalityId" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "cancelAtPeriodEnd" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_registrationCountryId_fkey" FOREIGN KEY ("registrationCountryId") REFERENCES "Country"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_legalProvinceId_fkey" FOREIGN KEY ("legalProvinceId") REFERENCES "Province"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_legalMunicipalityId_fkey" FOREIGN KEY ("legalMunicipalityId") REFERENCES "Municipality"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- VerificationRequest: tipo de documento + pago reclamado sin comprobante.
ALTER TABLE "VerificationRequest" ADD COLUMN "idDocumentType" "IdDocumentType";
ALTER TABLE "VerificationRequest" ADD COLUMN "paymentClaimedAt" TIMESTAMP(3);

-- SiteSettings: catálogo de etiquetas de producto administrable.
ALTER TABLE "SiteSettings" ADD COLUMN "availableProductBadges" TEXT[] NOT NULL DEFAULT ARRAY['Popular', 'Solicitado']::TEXT[];
ALTER TABLE "SiteSettings" ADD COLUMN "newBadgeDurationDays" INTEGER NOT NULL DEFAULT 14;
