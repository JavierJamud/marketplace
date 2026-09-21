-- Bloque 228 (Fase 1 del blindaje del ranking — pedido explícito):
-- deduplicar clics por IP antes de que entren al score de productRanking.js.
CREATE TABLE "ProductClickEvent" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "ipHash" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ProductClickEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "ProductClickEvent_productId_ipHash_createdAt_idx" ON "ProductClickEvent"("productId", "ipHash", "createdAt");

CREATE INDEX "ProductClickEvent_createdAt_idx" ON "ProductClickEvent"("createdAt");

ALTER TABLE "ProductClickEvent" ADD CONSTRAINT "ProductClickEvent_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
