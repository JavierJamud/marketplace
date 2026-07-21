-- Bloque 43: nombre de modelo por proveedor de IA, editable desde Admin —
-- null = usa el default hardcodeado en el archivo del proveedor.
ALTER TABLE "SiteSettings" ADD COLUMN "aiModelCerebras" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "aiModelGroq" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "aiModelGemini" TEXT;
