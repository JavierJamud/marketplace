-- Operaciones hechas sin conexión (caja, mesas, ventas manuales): cada una lleva una clave única. Si el reintento llega dos veces,
-- la segunda devuelve la misma respuesta guardada y no vuelve a registrar la venta.
CREATE TABLE "IdempotentRequest" (
    "key" TEXT NOT NULL,
    "method" TEXT NOT NULL,
    "path" TEXT NOT NULL,
    "status" INTEGER,
    "body" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "IdempotentRequest_pkey" PRIMARY KEY ("key")
);
CREATE INDEX "IdempotentRequest_createdAt_idx" ON "IdempotentRequest"("createdAt");
