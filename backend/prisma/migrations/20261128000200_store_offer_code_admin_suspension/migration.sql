-- Suspensión del admin sobre ofertas de tienda y códigos de descuento: la tienda no puede reactivar lo que el admin suspendió.
ALTER TABLE "DiscountCode" ADD COLUMN "suspendedAt" TIMESTAMP(3),
                           ADD COLUMN "suspendedReason" TEXT;

ALTER TABLE "StoreOffer" ADD COLUMN "suspendedAt" TIMESTAMP(3),
                         ADD COLUMN "suspendedReason" TEXT;
