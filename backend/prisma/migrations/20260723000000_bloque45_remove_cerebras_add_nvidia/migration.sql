-- Bloque 45: Cerebras sale del sistema de IA (su cuenta gratuita devolvía
-- 402 Payment Required, no sirve para uso gratuito) — NVIDIA NIM lo
-- reemplaza como tercer proveedor.
ALTER TABLE "SiteSettings" DROP COLUMN "aiModelCerebras";
ALTER TABLE "SiteSettings" ADD COLUMN "aiModelNvidia" TEXT;

-- Limpieza de la fila de Integration de Cerebras si existía (clave
-- cargada, ya sin uso — nunca se referencia desde el código de acá en más).
DELETE FROM "Integration" WHERE "name" = 'cerebras';
