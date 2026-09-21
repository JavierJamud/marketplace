-- Bloque 192: botón + enlace opcionales, exclusivos de ofertas creadas por
-- el admin (nunca aceptados desde el endpoint de vendedor).
ALTER TABLE "Offer" ADD COLUMN "buttonLabel" TEXT;
ALTER TABLE "Offer" ADD COLUMN "buttonUrl" TEXT;
