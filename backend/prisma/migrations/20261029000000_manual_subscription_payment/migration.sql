-- Pago de la suscripción registrado a mano por el admin (pagó por fuera de la plataforma o activación decidida por el equipo).
ALTER TYPE "VerificationPaymentMethod" ADD VALUE 'MANUAL';
ALTER TABLE "VerificationRequest" ADD COLUMN "paymentNote" TEXT;
ALTER TABLE "VerificationArchive" ADD COLUMN "paymentNote" TEXT;
ALTER TABLE "SubscriptionPayment" ADD COLUMN "note" TEXT;
