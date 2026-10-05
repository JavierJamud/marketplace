-- Bloque 245 (pedido explícito): varios modelos por proveedor de IA, con
-- respaldo entre modelos y autorreparación verificada.

-- Cada fila es un modelo configurado de un proveedor.
CREATE TYPE "AiModelSource" AS ENUM ('MANUAL', 'AUTO');

CREATE TABLE "AiModelConfig" (
    "id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "priority" INTEGER NOT NULL DEFAULT 0,
    "source" "AiModelSource" NOT NULL DEFAULT 'MANUAL',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiModelConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AiModelConfig_provider_model_key" ON "AiModelConfig"("provider", "model");
CREATE INDEX "AiModelConfig_provider_priority_idx" ON "AiModelConfig"("provider", "priority");

-- Los modelos que hoy tiene el admin en SiteSettings pasan a ser la primera
-- fila de cada proveedor, para que nada cambie de comportamiento al migrar.
-- Las columnas viejas (SiteSettings.aiModel*) se dejan sin tocar; ya nadie
-- las lee y se eliminan en una migración posterior, cuando esto esté
-- verificado en producción.
INSERT INTO "AiModelConfig" ("id", "provider", "model", "isActive", "priority", "source")
SELECT 'aimc_' || md5(random()::text || clock_timestamp()::text), 'groq', "aiModelGroq", true, 0, 'MANUAL'
FROM "SiteSettings" WHERE "aiModelGroq" IS NOT NULL AND btrim("aiModelGroq") <> '' LIMIT 1;

INSERT INTO "AiModelConfig" ("id", "provider", "model", "isActive", "priority", "source")
SELECT 'aimc_' || md5(random()::text || clock_timestamp()::text), 'gemini', "aiModelGemini", true, 0, 'MANUAL'
FROM "SiteSettings" WHERE "aiModelGemini" IS NOT NULL AND btrim("aiModelGemini") <> '' LIMIT 1;

INSERT INTO "AiModelConfig" ("id", "provider", "model", "isActive", "priority", "source")
SELECT 'aimc_' || md5(random()::text || clock_timestamp()::text), 'nvidia', "aiModelNvidia", true, 0, 'MANUAL'
FROM "SiteSettings" WHERE "aiModelNvidia" IS NOT NULL AND btrim("aiModelNvidia") <> '' LIMIT 1;

-- La salud pasa a ser por modelo (provider + model). La tabla vieja era solo
-- caché: se regenera sola en la primera corrida del chequeo de 2 minutos.
DROP TABLE "AiProviderHealth";

CREATE TABLE "AiModelHealth" (
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "lastError" TEXT,
    "lastLatencyMs" INTEGER,
    "downSince" TIMESTAMP(3),
    "downNotifiedAt" TIMESTAMP(3),
    "lastRepairAttemptAt" TIMESTAMP(3),
    "repairFailedCount" INTEGER NOT NULL DEFAULT 0,
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiModelHealth_pkey" PRIMARY KEY ("provider", "model")
);
