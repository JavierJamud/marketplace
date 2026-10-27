-- Datos técnicos de cada pedido (IP, navegador, dispositivo), solo para el panel de administración.
CREATE TABLE "OrderRequestInfo" (
    "orderId" TEXT NOT NULL,
    "source" TEXT NOT NULL,
    "ip" TEXT,
    "userAgent" TEXT,
    "acceptLanguage" TEXT,
    "referer" TEXT,
    "origin" TEXT,
    "platformHint" TEXT,
    "mobileHint" BOOLEAN,
    "modelHint" TEXT,
    "timezone" TEXT,
    "screen" TEXT,
    "language" TEXT,
    "standalone" BOOLEAN,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrderRequestInfo_pkey" PRIMARY KEY ("orderId")
);

CREATE INDEX "OrderRequestInfo_ip_idx" ON "OrderRequestInfo"("ip");

ALTER TABLE "OrderRequestInfo" ADD CONSTRAINT "OrderRequestInfo_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
