-- Pedidos que la tienda no responde: recordatorio, aviso de cierre, cierre automático y reactivación.
ALTER TYPE "VendorNotificationType" ADD VALUE IF NOT EXISTS 'ORDER_REMINDER';
ALTER TYPE "VendorNotificationType" ADD VALUE IF NOT EXISTS 'ORDER_CANCEL_WARNING';
ALTER TYPE "VendorNotificationType" ADD VALUE IF NOT EXISTS 'ORDER_AUTO_CANCELLED';

ALTER TABLE "Order" ADD COLUMN "pendingReminderAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "cancelWarningAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "autoCancelledAt" TIMESTAMP(3);
ALTER TABLE "Order" ADD COLUMN "reactivatedAt" TIMESTAMP(3);
CREATE INDEX "Order_status_createdAt_idx" ON "Order"("status", "createdAt");

ALTER TABLE "SiteSettings" ADD COLUMN "orderFollowUpEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SiteSettings" ADD COLUMN "orderReminderHours" INTEGER NOT NULL DEFAULT 24;
ALTER TABLE "SiteSettings" ADD COLUMN "orderCancelWarningHours" INTEGER NOT NULL DEFAULT 48;
ALTER TABLE "SiteSettings" ADD COLUMN "orderAutoCancelHours" INTEGER NOT NULL DEFAULT 72;
