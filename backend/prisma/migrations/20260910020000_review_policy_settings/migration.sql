-- Bloque 118 (pedido explícito): política de comentarios/reseñas
-- configurable desde el admin — antes constantes hardcodeadas en
-- reviews.controller.js. Defaults iguales a lo que ya estaba hardcodeado
-- (24h = "por día", 1 por producto, 1 por tienda, vendedores SÍ pueden
-- comentar) para no cambiar el comportamiento visible al desplegar.

ALTER TABLE "SiteSettings"
  ADD COLUMN "reviewDedupHours" INTEGER NOT NULL DEFAULT 24,
  ADD COLUMN "maxReviewsPerProductPerPeriod" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "maxReviewsPerStorePerPeriod" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "vendorsCanReview" BOOLEAN NOT NULL DEFAULT true;
