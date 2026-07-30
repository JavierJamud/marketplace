-- Bloque 67: personalización de campañas — imagen banner + botón CTA opcional.

ALTER TABLE "Campaign" ADD COLUMN "imageUrl" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "ctaLabel" TEXT;
ALTER TABLE "Campaign" ADD COLUMN "ctaUrl" TEXT;
