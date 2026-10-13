-- Venta rápida: tope de fotos por anuncio configurable desde el admin.
ALTER TABLE "SiteSettings" ADD COLUMN "maxListingImages" INTEGER NOT NULL DEFAULT 5;
