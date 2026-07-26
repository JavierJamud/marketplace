-- Bloque 49: nombre y logo de la plataforma, configurables desde el admin.
ALTER TABLE "SiteSettings" ADD COLUMN "siteName" TEXT NOT NULL DEFAULT 'ZeuDin';
ALTER TABLE "SiteSettings" ADD COLUMN "logoUrl" TEXT;
