-- Bloque 302: la tienda recibe un correo por cada pedido nuevo (y puede apagarlo).
ALTER TABLE "Vendor" ADD COLUMN "notifyNewOrderEmail" BOOLEAN NOT NULL DEFAULT true;
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'NEW_ORDER_VENDOR';
