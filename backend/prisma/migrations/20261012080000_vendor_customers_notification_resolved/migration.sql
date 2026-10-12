-- Notificaciones del vendedor: se marcan como atendidas (y dejan de mostrarse) al abrirlas o al resolverse lo que avisaban.
ALTER TABLE "VendorNotification" ADD COLUMN "resolvedAt" TIMESTAMP(3);
ALTER TABLE "VendorNotification" ADD COLUMN "refCode" TEXT;
CREATE INDEX "VendorNotification_vendorId_resolvedAt_idx" ON "VendorNotification"("vendorId", "resolvedAt");

-- Los avisos de pedido nuevo ya existentes: se enlazan a su pedido y se dan por atendidos si el pedido ya no está pendiente.
UPDATE "VendorNotification" SET "refCode" = substring("body" from 'Z-[A-Z0-9]+') WHERE "type" = 'NEW_ORDER';
UPDATE "VendorNotification" n SET "resolvedAt" = NOW() FROM "Order" o WHERE n."type" = 'NEW_ORDER' AND o."code" = n."refCode" AND o."status" <> 'NEW';

-- Registro de clientes de cada tienda: se crea solo con cada compra y el vendedor puede agregar notas.
CREATE TABLE "VendorCustomer" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "VendorCustomer_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "VendorCustomer_vendorId_key_key" ON "VendorCustomer"("vendorId", "key");
ALTER TABLE "VendorCustomer" ADD CONSTRAINT "VendorCustomer_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
