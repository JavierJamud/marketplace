-- Bloque 232 (pedido explícito): límite de ofertas de tienda activas por
-- vendedor, configurable desde el admin (antes iba a quedar fijo en 1).
ALTER TABLE "SiteSettings" ADD COLUMN "maxActiveStoreOffersPerVendor" INTEGER NOT NULL DEFAULT 1;

-- Bloque 232 (pedido explícito): "se puede programar cuándo empieza una y
-- cuándo termina" — fecha de inicio programada, además de la de fin
-- (expiresAt) que ya existía.
ALTER TABLE "StoreOffer" ADD COLUMN "startsAt" TIMESTAMP(3);
