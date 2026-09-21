-- Bloque 194: consejos diarios de IA por tienda + ofertas autodirigidas
-- (email/popup) del admin a vendedores o clientes.

-- CreateEnum
CREATE TYPE "TargetedOfferDelivery" AS ENUM ('EMAIL', 'POPUP', 'BOTH');

-- CreateEnum
CREATE TYPE "TargetedOfferStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateTable
CREATE TABLE "VendorDailyTip" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "tips" JSONB NOT NULL,
    "generatedForDate" DATE NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorDailyTip_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorDailyTip_vendorId_generatedForDate_key" ON "VendorDailyTip"("vendorId", "generatedForDate");

-- AddForeignKey
ALTER TABLE "VendorDailyTip" ADD CONSTRAINT "VendorDailyTip_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- CreateTable
CREATE TABLE "TargetedOffer" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "imageUrl" TEXT,
    "ctaLabel" TEXT,
    "ctaUrl" TEXT,
    "audience" TEXT NOT NULL,
    "targetVendorId" TEXT,
    "targetUserId" TEXT,
    "delivery" "TargetedOfferDelivery" NOT NULL DEFAULT 'BOTH',
    "status" "TargetedOfferStatus" NOT NULL DEFAULT 'ACTIVE',
    "emailSentCount" INTEGER NOT NULL DEFAULT 0,
    "emailSentAt" TIMESTAMP(3),
    "expiresAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "TargetedOffer_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "TargetedOffer_status_audience_idx" ON "TargetedOffer"("status", "audience");

-- CreateTable
CREATE TABLE "TargetedOfferView" (
    "id" TEXT NOT NULL,
    "targetedOfferId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "dismissedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "TargetedOfferView_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "TargetedOfferView_targetedOfferId_userId_key" ON "TargetedOfferView"("targetedOfferId", "userId");

-- CreateIndex
CREATE INDEX "TargetedOfferView_userId_idx" ON "TargetedOfferView"("userId");

-- AddForeignKey
ALTER TABLE "TargetedOfferView" ADD CONSTRAINT "TargetedOfferView_targetedOfferId_fkey" FOREIGN KEY ("targetedOfferId") REFERENCES "TargetedOffer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
