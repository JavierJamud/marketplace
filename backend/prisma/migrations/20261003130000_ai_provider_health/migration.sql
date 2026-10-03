-- Bloque 238 (pedido explícito): estado cacheado de salud de cada proveedor
-- de IA (gemini/groq/nvidia), refrescado cada 2 minutos en segundo plano —
-- decide si el chatbot se muestra o no, sin que un cliente real dispare
-- nunca una prueba de IA con solo visitar el sitio.
CREATE TABLE "AiProviderHealth" (
    "provider" TEXT NOT NULL,
    "status" TEXT NOT NULL,
    "model" TEXT,
    "lastError" TEXT,
    "downSince" TIMESTAMP(3),
    "lastCheckedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "AiProviderHealth_pkey" PRIMARY KEY ("provider")
);
