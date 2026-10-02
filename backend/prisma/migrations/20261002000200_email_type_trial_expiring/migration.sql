-- Bloque 235: mismo criterio que VERIFICATION_PAYMENT_REMINDER — aviso
-- proactivo del trial gratuito de 30 días, nunca un cambio de estado real.
ALTER TYPE "EmailType" ADD VALUE 'TRIAL_EXPIRING_SOON';
