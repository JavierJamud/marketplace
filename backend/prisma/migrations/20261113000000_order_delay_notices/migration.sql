-- Aviso de pedido detenido (tienda y cliente) y sus horas, configurables por el admin.
ALTER TABLE "SiteSettings" ADD COLUMN "orderDelayEnabled" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SiteSettings" ADD COLUMN "orderDelayHours" INTEGER NOT NULL DEFAULT 48;
ALTER TYPE "VendorNotificationType" ADD VALUE 'ORDER_DELAYED';
