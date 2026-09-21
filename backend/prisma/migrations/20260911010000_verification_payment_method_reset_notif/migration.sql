-- Bloque 151: nuevo tipo de notificación — el admin restableció el método
-- de pago elegido por el vendedor. ALTER TYPE ... ADD VALUE tiene que ser
-- la única sentencia de su migración (no se puede usar el valor nuevo en
-- la misma transacción).
ALTER TYPE "VendorNotificationType" ADD VALUE 'VERIFICATION_PAYMENT_METHOD_RESET';
