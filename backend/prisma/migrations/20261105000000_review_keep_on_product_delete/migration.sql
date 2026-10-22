-- Las reseñas ya no se borran al borrar su producto: siguen contando para la tienda (antes se perdían en cascada y el
-- promedio de la tienda quedaba desactualizado). Se guarda el nombre del producto para seguir mostrándolo.
ALTER TABLE "Review" ADD COLUMN "productName" TEXT;
UPDATE "Review" r SET "productName" = p."name" FROM "Product" p WHERE r."productId" = p."id";

ALTER TABLE "Review" DROP CONSTRAINT "Review_productId_fkey";
ALTER TABLE "Review" ADD CONSTRAINT "Review_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Cantidad de reseñas con estrellas de la tienda (se recalcula al arrancar junto con el promedio, ver lib/ratings.js).
ALTER TABLE "Vendor" ADD COLUMN "reviewCount" INTEGER NOT NULL DEFAULT 0;
