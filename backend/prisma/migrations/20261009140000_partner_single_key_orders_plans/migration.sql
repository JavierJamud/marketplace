-- Bloque 300: una sola credencial por socio, pedidos por la API y precios de plan del socio.

-- La llave deja de tener tipo (navegador/servidor): una sola llave sirve para ambos usos.
ALTER TABLE "PartnerApiKey" DROP COLUMN "kind";
DROP TYPE "PartnerKeyKind";

-- Pedidos hechos por la API del socio.
ALTER TABLE "Order" ADD COLUMN "partnerId" TEXT;
ALTER TABLE "Order" ADD COLUMN "idempotencyKey" TEXT;
CREATE UNIQUE INDEX "Order_partnerId_idempotencyKey_key" ON "Order"("partnerId", "idempotencyKey");
ALTER TABLE "Order" ADD CONSTRAINT "Order_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Extra que el socio suma al precio base de cada plan.
CREATE TABLE "PartnerPlanPrice" (
    "partnerId" TEXT NOT NULL,
    "planType" "PlanType" NOT NULL,
    "extraCup" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "extraUsd" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PartnerPlanPrice_pkey" PRIMARY KEY ("partnerId","planType")
);
ALTER TABLE "PartnerPlanPrice" ADD CONSTRAINT "PartnerPlanPrice_partnerId_fkey" FOREIGN KEY ("partnerId") REFERENCES "Partner"("id") ON DELETE CASCADE ON UPDATE CASCADE;
