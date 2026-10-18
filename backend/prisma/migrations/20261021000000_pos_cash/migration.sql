-- Caja con código de barras: ventas de mostrador, movimientos de caja y enlaces de las pantallas públicas.
CREATE TYPE "PosSaleStatus" AS ENUM ('OPEN', 'PAID', 'PENDING_TABLE', 'SENT_TO_TABLE', 'CANCELLED');
CREATE TYPE "PosFulfillment" AS ENUM ('PREPARING', 'READY', 'PICKED_UP');
CREATE TYPE "CashEntryType" AS ENUM ('SALE', 'CHANGE', 'DEPOSIT', 'WITHDRAWAL');

CREATE TABLE "PosSale" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "customerName" TEXT,
    "items" JSONB NOT NULL DEFAULT '[]',
    "total" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'CUP',
    "status" "PosSaleStatus" NOT NULL DEFAULT 'OPEN',
    "fulfillment" "PosFulfillment",
    "paymentMethod" TEXT,
    "cashReceived" DECIMAL(12,2),
    "changeGiven" DECIMAL(12,2),
    "orderId" TEXT,
    "tableOrderId" TEXT,
    "tableNumber" INTEGER,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "paidAt" TIMESTAMP(3),
    "readyAt" TIMESTAMP(3),
    "pickedUpAt" TIMESTAMP(3),
    CONSTRAINT "PosSale_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "PosSale_vendorId_status_updatedAt_idx" ON "PosSale"("vendorId", "status", "updatedAt");
CREATE INDEX "PosSale_vendorId_code_idx" ON "PosSale"("vendorId", "code");

CREATE TABLE "CashEntry" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "type" "CashEntryType" NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'CUP',
    "posSaleId" TEXT,
    "note" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "CashEntry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "CashEntry_vendorId_createdAt_idx" ON "CashEntry"("vendorId", "createdAt");

CREATE TABLE "PosSettings" (
    "vendorId" TEXT NOT NULL,
    "displayToken" TEXT NOT NULL,
    "boardToken" TEXT NOT NULL,
    "idleImageUrl" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PosSettings_pkey" PRIMARY KEY ("vendorId")
);
CREATE UNIQUE INDEX "PosSettings_displayToken_key" ON "PosSettings"("displayToken");
CREATE UNIQUE INDEX "PosSettings_boardToken_key" ON "PosSettings"("boardToken");

-- El mismo código de barras no puede repetirse dentro de una tienda (sí entre tiendas distintas).
CREATE UNIQUE INDEX "Product_vendorId_barcode_key" ON "Product"("vendorId", "barcode") WHERE "barcode" IS NOT NULL;

ALTER TABLE "PosSale" ADD CONSTRAINT "PosSale_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "CashEntry" ADD CONSTRAINT "CashEntry_posSaleId_fkey" FOREIGN KEY ("posSaleId") REFERENCES "PosSale"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "PosSettings" ADD CONSTRAINT "PosSettings_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
