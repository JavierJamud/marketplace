-- Avisos al vendedor cuando un cliente cancela o modifica su pedido.
ALTER TYPE "VendorNotificationType" ADD VALUE IF NOT EXISTS 'ORDER_CANCELLED_BY_CUSTOMER';
ALTER TYPE "VendorNotificationType" ADD VALUE IF NOT EXISTS 'ORDER_EDITED_BY_CUSTOMER';
