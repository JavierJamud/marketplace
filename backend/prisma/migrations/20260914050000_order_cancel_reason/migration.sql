-- Bloque 197: motivo de cancelación para Order, mismo criterio que
-- TableOrder.cancelReason (nunca se borra el pedido, solo se anula con un
-- motivo visible al vendedor y al cliente).
ALTER TABLE "Order" ADD COLUMN "cancelReason" TEXT;
