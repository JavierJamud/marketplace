-- Bloque 153 (pedido explícito):
--  - SubscriptionPayment: historial de pagos de RENOVACIÓN (meses extra
--    mientras la tienda YA está VERIFIED) — separado del ciclo inicial de
--    verificación (VerificationRequest), que sigue intacto.
--  - VendorChangeRequest: solicitudes de cambio a datos de identidad de una
--    tienda ya verificada (nombre/responsable/ID/dirección), con fotos
--    opcionales del nuevo responsable, revisadas por un admin.

-- CreateEnum
CREATE TYPE "VendorChangeRequestStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "SubscriptionPayment" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "paymentMethod" "VerificationPaymentMethod" NOT NULL,
    "months" INTEGER NOT NULL,
    "amount" DECIMAL(12,2),
    "currency" TEXT NOT NULL,
    "payerName" TEXT,
    "payerAccountNumber" TEXT,
    "payerPhone" TEXT,
    "payerAddress" TEXT,
    "payerCountry" TEXT,
    "payerCardLast4" TEXT,
    "proofUrl" TEXT,
    "proofUnavailable" BOOLEAN NOT NULL DEFAULT false,
    "stripeCheckoutSessionId" TEXT,
    "stripeCheckoutUrl" TEXT,
    "stripeCheckoutExpiresAt" TIMESTAMP(3),
    "stripePaidAt" TIMESTAMP(3),
    "stripePaymentIntentId" TEXT,
    "claimedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "confirmedById" TEXT,
    "periodStart" TIMESTAMP(3),
    "periodEnd" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SubscriptionPayment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorChangeRequest" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "companyName" TEXT,
    "ownerName" TEXT,
    "ownerIdNumber" TEXT,
    "companyTaxId" TEXT,
    "companyAddress" TEXT,
    "newOwnerSelfieUrl" TEXT,
    "newOwnerIdPhotoUrl" TEXT,
    "reason" TEXT,
    "status" "VendorChangeRequestStatus" NOT NULL DEFAULT 'PENDING',
    "adminNotes" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorChangeRequest_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "SubscriptionPayment_vendorId_createdAt_idx" ON "SubscriptionPayment"("vendorId", "createdAt");

-- CreateIndex
CREATE INDEX "VendorChangeRequest_vendorId_createdAt_idx" ON "VendorChangeRequest"("vendorId", "createdAt");

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_confirmedById_fkey" FOREIGN KEY ("confirmedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorChangeRequest" ADD CONSTRAINT "VendorChangeRequest_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorChangeRequest" ADD CONSTRAINT "VendorChangeRequest_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

