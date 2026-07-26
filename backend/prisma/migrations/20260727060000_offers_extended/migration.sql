-- Bloque 51: ofertas personalizadas/HTML (admin), orientación, vencimiento
-- opcional (solo admin), y moderación (SUSPENDED).
ALTER TYPE "OfferStatus" ADD VALUE 'SUSPENDED';

CREATE TYPE "OfferContentType" AS ENUM ('PRODUCT', 'CUSTOM', 'HTML');
CREATE TYPE "OfferOrientation" AS ENUM ('VERTICAL', 'HORIZONTAL');

ALTER TABLE "Offer" ALTER COLUMN "vendorId" DROP NOT NULL;
ALTER TABLE "Offer" ALTER COLUMN "productId" DROP NOT NULL;
ALTER TABLE "Offer" ALTER COLUMN "imageUrl" DROP NOT NULL;
ALTER TABLE "Offer" ALTER COLUMN "expiresAt" DROP NOT NULL;

ALTER TABLE "Offer" ADD COLUMN "contentType" "OfferContentType" NOT NULL DEFAULT 'PRODUCT';
ALTER TABLE "Offer" ADD COLUMN "orientation" "OfferOrientation" NOT NULL DEFAULT 'HORIZONTAL';
ALTER TABLE "Offer" ADD COLUMN "description" TEXT;
ALTER TABLE "Offer" ADD COLUMN "htmlContent" TEXT;
ALTER TABLE "Offer" ADD COLUMN "createdByAdmin" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Offer" ADD COLUMN "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
