-- Bloque 235: TRIAL_ACTIVATED/TRIAL_EXPIRED viajan por el mismo canal
-- (email + campanita) que el resto del ciclo de verificación/cobro, pero
-- disparados por el propio vendedor o por el cron de vencimiento, nunca por
-- un admin. TRIAL_EXPIRING_SOON es un aviso proactivo del cron, sin
-- transición de estado detrás.
ALTER TYPE "VendorNotificationType" ADD VALUE 'TRIAL_ACTIVATED';
ALTER TYPE "VendorNotificationType" ADD VALUE 'TRIAL_EXPIRING_SOON';
ALTER TYPE "VendorNotificationType" ADD VALUE 'TRIAL_EXPIRED';
