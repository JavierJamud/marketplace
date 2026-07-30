-- Bloque 61: redes sociales de la plataforma (footer de emails).
ALTER TABLE "SiteSettings" ADD COLUMN "whatsappUrl" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "instagramUrl" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "facebookUrl" TEXT;
