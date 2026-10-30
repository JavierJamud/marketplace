-- El correo de "vuelve a comprar" se disparaba con una oferta del modelo Offer de la tienda, que las tiendas ya no pueden
-- crear (desde el Bloque 297 la portada solo tiene ofertas del admin): no salía nunca. Ahora lo dispara una oferta de tienda
-- (StoreOffer). Los registros viejos conservan su offerId.
ALTER TABLE "WinbackEmailLog" ALTER COLUMN "offerId" DROP NOT NULL;
ALTER TABLE "WinbackEmailLog" ADD COLUMN "storeOfferId" TEXT;
ALTER TABLE "WinbackEmailLog" ADD CONSTRAINT "WinbackEmailLog_storeOfferId_fkey" FOREIGN KEY ("storeOfferId") REFERENCES "StoreOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
CREATE UNIQUE INDEX "WinbackEmailLog_customerId_vendorId_storeOfferId_key" ON "WinbackEmailLog"("customerId", "vendorId", "storeOfferId");
