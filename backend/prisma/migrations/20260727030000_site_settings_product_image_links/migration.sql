-- Bloque 49: toggle admin para permitir/deshabilitar el link externo como
-- alternativa a subir archivo en las imágenes de producto.
ALTER TABLE "SiteSettings" ADD COLUMN "allowProductImageLinks" BOOLEAN NOT NULL DEFAULT true;
