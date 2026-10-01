-- Bloque 52: activación manual del Plan Premium desde Suscripciones — mismo
-- canal (email + campanita) que el resto del ciclo de verificación/cobro.
ALTER TYPE "VendorNotificationType" ADD VALUE 'VERIFICATION_BUSINESS_GRANTED';
