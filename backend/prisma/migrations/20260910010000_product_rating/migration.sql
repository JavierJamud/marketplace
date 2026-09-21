-- Bloque 116 (pedido explícito): calificación propia de cada producto
-- (estrellas + cantidad de reseñas en la tarjeta) — denormalizada, mismo
-- criterio que Vendor.rating, para que cualquier listado que ya devuelve el
-- Product la traiga gratis sin agregar una query de aggregate por endpoint.

ALTER TABLE "Product"
  ADD COLUMN "rating" DECIMAL(2,1) NOT NULL DEFAULT 0,
  ADD COLUMN "reviewCount" INTEGER NOT NULL DEFAULT 0;

-- Backfill: productos que YA tienen reseñas visibles con estrellas.
UPDATE "Product" p
SET "rating" = sub.avg_rating, "reviewCount" = sub.review_count
FROM (
  SELECT "productId", ROUND(AVG(rating)::numeric, 1) AS avg_rating, COUNT(rating) AS review_count
  FROM "Review"
  WHERE "productId" IS NOT NULL AND rating IS NOT NULL AND "isHidden" = false
  GROUP BY "productId"
) sub
WHERE p.id = sub."productId";
