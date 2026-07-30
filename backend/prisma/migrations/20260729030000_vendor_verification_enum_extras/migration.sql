-- Bloque 64: valores de enum adicionales para las notificaciones/emails del
-- ciclo de cobro recurrente — en su propia migración porque Postgres no deja
-- usar un valor de enum nuevo en la misma transacción donde se lo agrega.

ALTER TYPE "EmailType" ADD VALUE 'VERIFICATION_PAYMENT_REMINDER';
ALTER TYPE "VendorNotificationType" ADD VALUE 'VERIFICATION_PAYMENT_FAILED';
ALTER TYPE "VendorNotificationType" ADD VALUE 'VERIFICATION_SUSPENDED';
