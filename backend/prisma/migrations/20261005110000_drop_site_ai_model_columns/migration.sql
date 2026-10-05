-- Bloque 245: los modelos de IA por proveedor pasaron a AiModelConfig (la
-- migración 20261005100000 ya copió los valores). Nadie lee estas columnas.
ALTER TABLE "SiteSettings" DROP COLUMN "aiModelGroq",
DROP COLUMN "aiModelGemini",
DROP COLUMN "aiModelNvidia";
