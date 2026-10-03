-- Bloque 237 (pedido explícito): política de "Venta rápida" configurable
-- desde el admin — antes MAX_LISTINGS_PER_USER/LISTING_EXPIRY_DAYS eran
-- constantes hardcodeadas, sin ningún tope diario.
ALTER TABLE "SiteSettings" ADD COLUMN "maxActiveListingsPerCustomer" INTEGER NOT NULL DEFAULT 6;
ALTER TABLE "SiteSettings" ADD COLUMN "maxNewListingsPerDay" INTEGER NOT NULL DEFAULT 2;
ALTER TABLE "SiteSettings" ADD COLUMN "listingPublicVisibilityDays" INTEGER NOT NULL DEFAULT 15;
ALTER TABLE "SiteSettings" ADD COLUMN "listingExpiryDays" INTEGER NOT NULL DEFAULT 30;

-- Ciclo de vida en 2 etapas: nace nullable para poder rellenar las filas
-- existentes antes de exigirla. Las tiendas ya publicadas nunca dejaban de
-- mostrarse antes de llegar a expiresAt (borrado real) — para no cambiarles
-- el comportamiento de golpe, se rellenan con el mismo valor que ya tenían
-- en expiresAt (siguen públicas hasta el mismo día de siempre).
ALTER TABLE "CustomerListing" ADD COLUMN "publicVisibleUntil" TIMESTAMP(3);
UPDATE "CustomerListing" SET "publicVisibleUntil" = "expiresAt" WHERE "publicVisibleUntil" IS NULL;
ALTER TABLE "CustomerListing" ALTER COLUMN "publicVisibleUntil" SET NOT NULL;

CREATE INDEX "CustomerListing_publicVisibleUntil_idx" ON "CustomerListing"("publicVisibleUntil");
