-- Bloque 229 (Fase 2 del blindaje del ranking — pedido explícito):
-- cola de anomalías detectadas por los crons de reseñas/clics para que el
-- admin las revise. Nunca actúa sola.
CREATE TYPE "RankingAnomalyKind" AS ENUM ('REVIEW_BURST', 'CLICK_SPIKE');

CREATE TYPE "RankingAnomalyStatus" AS ENUM ('PENDING', 'DISMISSED', 'ACTIONED');

CREATE TABLE "RankingAnomaly" (
    "id" TEXT NOT NULL,
    "kind" "RankingAnomalyKind" NOT NULL,
    "status" "RankingAnomalyStatus" NOT NULL DEFAULT 'PENDING',
    "productId" TEXT,
    "vendorId" TEXT,
    "details" TEXT NOT NULL,
    "detectedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,

    CONSTRAINT "RankingAnomaly_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "RankingAnomaly_status_idx" ON "RankingAnomaly"("status");

CREATE INDEX "RankingAnomaly_kind_idx" ON "RankingAnomaly"("kind");

CREATE INDEX "RankingAnomaly_productId_idx" ON "RankingAnomaly"("productId");

CREATE INDEX "RankingAnomaly_vendorId_idx" ON "RankingAnomaly"("vendorId");

ALTER TABLE "RankingAnomaly" ADD CONSTRAINT "RankingAnomaly_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RankingAnomaly" ADD CONSTRAINT "RankingAnomaly_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "RankingAnomaly" ADD CONSTRAINT "RankingAnomaly_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
