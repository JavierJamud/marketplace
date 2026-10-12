CREATE TABLE "OrderEvent" (
    "id" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "detail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "OrderEvent_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "OrderEvent_orderId_createdAt_idx" ON "OrderEvent"("orderId", "createdAt");
ALTER TABLE "OrderEvent" ADD CONSTRAINT "OrderEvent_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;
