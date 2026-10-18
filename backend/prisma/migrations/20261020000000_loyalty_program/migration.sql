-- Programa de puntos por tienda, visitas de clientes a tiendas y recordatorios automáticos por correo.
ALTER TYPE "EmailType" ADD VALUE 'CART_REMINDER';
ALTER TYPE "EmailType" ADD VALUE 'STORE_REMINDER';

CREATE TYPE "LoyaltyTxType" AS ENUM ('EARN', 'REDEEM', 'EARN_REVERSED', 'REDEEM_REFUNDED', 'ADJUST');

ALTER TABLE "PlanConfig" ADD COLUMN "allowLoyalty" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN "marketingEmails" BOOLEAN NOT NULL DEFAULT true,
                   ADD COLUMN "lastMarketingEmailAt" TIMESTAMP(3);
ALTER TABLE "CartSnapshot" ADD COLUMN "remindedAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "loyaltyPointsRedeemed" INTEGER,
                    ADD COLUMN "loyaltyDiscount" DECIMAL(12,2),
                    ADD COLUMN "loyaltyPointsEarned" INTEGER;

CREATE TABLE "LoyaltyProgram" (
    "vendorId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "earnPerAmount" DECIMAL(12,2) NOT NULL DEFAULT 100,
    "earnPoints" INTEGER NOT NULL DEFAULT 1,
    "bonusTiers" JSONB NOT NULL DEFAULT '[]',
    "pointValue" DECIMAL(12,4) NOT NULL DEFAULT 1,
    "minRedeemPoints" INTEGER NOT NULL DEFAULT 10,
    "maxRedeemPercent" INTEGER NOT NULL DEFAULT 50,
    "maxRedeemPoints" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoyaltyProgram_pkey" PRIMARY KEY ("vendorId")
);

CREATE TABLE "LoyaltyAccount" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "balance" INTEGER NOT NULL DEFAULT 0,
    "lifetimeEarned" INTEGER NOT NULL DEFAULT 0,
    "lifetimeRedeemed" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "LoyaltyAccount_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "LoyaltyAccount_vendorId_userId_key" ON "LoyaltyAccount"("vendorId", "userId");
CREATE INDEX "LoyaltyAccount_userId_idx" ON "LoyaltyAccount"("userId");

CREATE TABLE "LoyaltyTransaction" (
    "id" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "type" "LoyaltyTxType" NOT NULL,
    "points" INTEGER NOT NULL,
    "balanceAfter" INTEGER NOT NULL,
    "orderId" TEXT,
    "orderCode" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "LoyaltyTransaction_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "LoyaltyTransaction_accountId_createdAt_idx" ON "LoyaltyTransaction"("accountId", "createdAt");
CREATE UNIQUE INDEX "LoyaltyTransaction_orderId_type_key" ON "LoyaltyTransaction"("orderId", "type");

CREATE TABLE "StoreVisit" (
    "userId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "firstAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "visits" INTEGER NOT NULL DEFAULT 1,
    "lastNudgeAt" TIMESTAMP(3),
    CONSTRAINT "StoreVisit_pkey" PRIMARY KEY ("userId", "vendorId")
);
CREATE INDEX "StoreVisit_lastAt_idx" ON "StoreVisit"("lastAt");

ALTER TABLE "LoyaltyProgram" ADD CONSTRAINT "LoyaltyProgram_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyAccount" ADD CONSTRAINT "LoyaltyAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "LoyaltyTransaction" ADD CONSTRAINT "LoyaltyTransaction_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "LoyaltyAccount"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreVisit" ADD CONSTRAINT "StoreVisit_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StoreVisit" ADD CONSTRAINT "StoreVisit_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
