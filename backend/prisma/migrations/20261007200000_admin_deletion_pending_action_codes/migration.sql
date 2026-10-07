-- Bloque 272: eliminación pendiente de tiendas (30 días configurables) y códigos de
-- confirmación por correo para las acciones sensibles del admin.
ALTER TABLE "Vendor" ADD COLUMN "adminDeletionRequestedAt" TIMESTAMP(3);
ALTER TABLE "Vendor" ADD COLUMN "adminDeletionRequestedById" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "adminDeletionReminderSentAt" TIMESTAMP(3);
CREATE INDEX "Vendor_adminDeletionRequestedAt_idx" ON "Vendor"("adminDeletionRequestedAt");

ALTER TABLE "SiteSettings" ADD COLUMN "vendorDeletionDays" INTEGER NOT NULL DEFAULT 30;

CREATE TABLE "AdminActionCode" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminActionCode_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "AdminActionCode_userId_action_createdAt_idx" ON "AdminActionCode"("userId", "action", "createdAt");
