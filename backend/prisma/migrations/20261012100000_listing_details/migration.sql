-- Venta rápida: más datos del anuncio y privacidad del nombre del vendedor.
ALTER TABLE "CustomerListing" ADD COLUMN "tags" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "CustomerListing" ADD COLUMN "condition" TEXT;
ALTER TABLE "CustomerListing" ADD COLUMN "quantity" INTEGER;
ALTER TABLE "CustomerListing" ADD COLUMN "priceTiers" JSONB;
ALTER TABLE "CustomerListing" ADD COLUMN "showOwnerName" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "CustomerListing" ADD COLUMN "locationNote" TEXT;
