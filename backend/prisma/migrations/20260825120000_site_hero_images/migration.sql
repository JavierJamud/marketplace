-- Bloque 96: el hero de la Home pasa de una sola imagen (heroImageUrl,
-- guardaba solo el nombre de archivo) a un slider de varias (heroImages,
-- guarda la ruta relativa completa "/uploads/site/<archivo>", mismo
-- criterio que Product.images). Se agrega la columna nueva, se copia la
-- imagen existente (si había una) como primer y único elemento del array
-- para no perderla, y recién ahí se borra la columna vieja.

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "heroImages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

UPDATE "SiteSettings"
SET "heroImages" = ARRAY['/uploads/site/' || "heroImageUrl"]
WHERE "heroImageUrl" IS NOT NULL;

ALTER TABLE "SiteSettings" DROP COLUMN "heroImageUrl";
