-- Bloque 52: códigos de descuento del vendedor, ofertas de tienda con código
-- propio, y reseñas con imágenes.

-- Reseñas con imágenes (solo tiendas verificadas, ver reviews.controller.js).
ALTER TABLE "Review" ADD COLUMN "images" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Código de descuento aplicado a un pedido, si hubo uno.
ALTER TABLE "Order" ADD COLUMN "discountCodeId" TEXT;
ALTER TABLE "Order" ADD COLUMN "discountAmount" DECIMAL(12,2);

CREATE TYPE "DiscountType" AS ENUM ('PERCENTAGE', 'FIXED_AMOUNT');

CREATE TABLE "DiscountCode" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "type" "DiscountType" NOT NULL,
    "value" DECIMAL(12,2) NOT NULL,
    "minPurchase" DECIMAL(12,2),
    "maxPurchase" DECIMAL(12,2),
    "maxUses" INTEGER,
    "usesCount" INTEGER NOT NULL DEFAULT 0,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expiresAt" TIMESTAMP(3),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DiscountCode_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "DiscountCode_vendorId_code_key" ON "DiscountCode"("vendorId", "code");

ALTER TABLE "DiscountCode" ADD CONSTRAINT "DiscountCode_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "StoreOffer" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "imageUrl" TEXT NOT NULL,
    "discountCodeId" TEXT NOT NULL,
    "isLimitedTime" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMP(3),
    "discountCodeExclusive" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StoreOffer_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "StoreOffer_vendorId_active_idx" ON "StoreOffer"("vendorId", "active");

ALTER TABLE "StoreOffer" ADD CONSTRAINT "StoreOffer_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreOffer" ADD CONSTRAINT "StoreOffer_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "Order" ADD CONSTRAINT "Order_discountCodeId_fkey" FOREIGN KEY ("discountCodeId") REFERENCES "DiscountCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;
