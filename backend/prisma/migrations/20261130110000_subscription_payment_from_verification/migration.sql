-- El primer pago (el de la verificación) también se guarda en SubscriptionPayment: una sola tabla para el historial de
-- pagos y los ingresos. fromVerification marca las filas que vienen de ahí.
ALTER TABLE "SubscriptionPayment" ADD COLUMN "fromVerification" BOOLEAN NOT NULL DEFAULT false;

-- Copia de los primeros pagos ya confirmados. Se salta los que ya tienen un "gemelo" (un pago de la misma tienda confirmado
-- a menos de 2 minutos), el mismo criterio con que las estadísticas evitaban contarlos dos veces.
INSERT INTO "SubscriptionPayment" (
  "id", "vendorId", "fromVerification", "paymentMethod", "months", "planType", "discountPercent", "amount", "currency",
  "proofUrl", "stripePaidAt", "claimedAt", "confirmedAt", "confirmedById", "note", "createdAt"
)
SELECT
  'mig' || md5(v."id" || 'initial-payment'), v."vendorId", true, v."paymentMethod", COALESCE(v."paymentMonths", 1),
  v."paymentPlanType", v."paymentDiscountPercent", v."paymentAmount", COALESCE(v."paymentCurrency", 'USD'),
  v."paymentProofUrl", v."stripePaidAt", COALESCE(v."paymentClaimedAt", v."paymentConfirmedAt"), v."paymentConfirmedAt",
  v."paymentConfirmedById", v."paymentNote", v."paymentConfirmedAt"
FROM "VerificationRequest" v
WHERE v."paymentConfirmedAt" IS NOT NULL
  AND v."paymentMethod" IS NOT NULL
  AND (v."paymentPlanType" IS NULL OR EXISTS (SELECT 1 FROM "PlanConfig" p WHERE p."planType" = v."paymentPlanType"))
  AND NOT EXISTS (
    SELECT 1 FROM "SubscriptionPayment" s
    WHERE s."vendorId" = v."vendorId"
      AND s."confirmedAt" BETWEEN v."paymentConfirmedAt" - INTERVAL '2 minutes' AND v."paymentConfirmedAt" + INTERVAL '2 minutes'
  );
