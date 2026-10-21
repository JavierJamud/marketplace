-- Duración de la prueba gratis del plan Pro, configurable por el admin (antes fija en 30 días en el código).
ALTER TABLE "SiteSettings" ADD COLUMN "trialDays" INTEGER NOT NULL DEFAULT 30;
