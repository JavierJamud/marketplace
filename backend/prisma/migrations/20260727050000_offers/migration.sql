-- Bloque 50: ofertas de vendedor sobre un producto ya existente.
CREATE TYPE "OfferStatus" AS ENUM ('ACTIVE', 'EXPIRED', 'REMOVED');

CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "tagline" TEXT,
    "discountLabel" TEXT,
    "imageUrl" TEXT NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "Offer_vendorId_createdAt_idx" ON "Offer"("vendorId", "createdAt");
CREATE INDEX "Offer_status_expiresAt_idx" ON "Offer"("status", "expiresAt");

ALTER TABLE "Offer" ADD CONSTRAINT "Offer_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
