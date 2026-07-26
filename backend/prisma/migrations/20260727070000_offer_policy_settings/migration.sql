-- Bloque 51: política de ofertas (cooldown de publicación y duración
-- default) configurable desde el admin en vez de hardcodeada en el backend.
ALTER TABLE "SiteSettings" ADD COLUMN "offerCooldownDays" INTEGER NOT NULL DEFAULT 7;
ALTER TABLE "SiteSettings" ADD COLUMN "offerDefaultDurationDays" INTEGER NOT NULL DEFAULT 30;
