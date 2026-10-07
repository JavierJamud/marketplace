-- Bloque 280: consumo de las API de IA para rotar antes del límite gratis.
CREATE TABLE "AiUsage" (
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "data" JSONB NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("provider","model")
);
