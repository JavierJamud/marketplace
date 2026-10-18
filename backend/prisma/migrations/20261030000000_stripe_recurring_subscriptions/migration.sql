-- Suscripción con tarjeta de cobro automático (Stripe): prueba gratis con tarjeta, plazo de renovación y facturas anotadas.
ALTER TABLE "Vendor" ADD COLUMN "trialBilling" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "stripeIntervalMonths" INTEGER;
ALTER TABLE "SubscriptionPayment" ADD COLUMN "stripeInvoiceId" TEXT;
CREATE UNIQUE INDEX "SubscriptionPayment_stripeInvoiceId_key" ON "SubscriptionPayment"("stripeInvoiceId");
