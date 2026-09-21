-- Bloque 153: confirmar una RENOVACIÓN (SubscriptionPayment) es un evento
-- distinto de VERIFICATION_VERIFIED (esa es la primera activación).
ALTER TYPE "VendorNotificationType" ADD VALUE 'SUBSCRIPTION_RENEWAL_CONFIRMED';
