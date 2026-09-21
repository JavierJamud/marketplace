-- Bloque 150 (pedido explícito): (1) la rama de archivo de verificación se
-- crea al ENVIAR los documentos (no al verificarse) y se completa paso a
-- paso — VerificationRequest.archiveId apunta a la rama del ciclo en curso;
-- (2) el vendedor elige cuántos meses paga (1..24) y declara quién pagó /
-- cuánto al subir el comprobante, obligatorio tanto para CUP como para
-- tarjeta; (3) Stripe deja stripePaidAt por webhook pero ya no activa solo —
-- un admin finaliza; (4) precio mensual USD editable desde el admin.

ALTER TABLE "VerificationRequest"
  ADD COLUMN "paymentMonths" INTEGER,
  ADD COLUMN "paymentAmount" DECIMAL(12,2),
  ADD COLUMN "paymentCurrency" TEXT,
  ADD COLUMN "payerName" TEXT,
  ADD COLUMN "payerAccountNumber" TEXT,
  ADD COLUMN "payerPhone" TEXT,
  ADD COLUMN "payerAddress" TEXT,
  ADD COLUMN "payerCountry" TEXT,
  ADD COLUMN "payerCardLast4" TEXT,
  ADD COLUMN "paymentProofUnavailable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "stripePaidAt" TIMESTAMP(3),
  ADD COLUMN "stripePaymentIntentId" TEXT,
  ADD COLUMN "archiveId" TEXT;

CREATE UNIQUE INDEX "VerificationRequest_archiveId_key" ON "VerificationRequest"("archiveId");

ALTER TABLE "VerificationArchive"
  ADD COLUMN "paymentMethod" "VerificationPaymentMethod",
  ADD COLUMN "paymentMonths" INTEGER,
  ADD COLUMN "paymentAmount" DECIMAL(12,2),
  ADD COLUMN "paymentCurrency" TEXT,
  ADD COLUMN "payerName" TEXT,
  ADD COLUMN "payerAccountNumber" TEXT,
  ADD COLUMN "payerPhone" TEXT,
  ADD COLUMN "payerAddress" TEXT,
  ADD COLUMN "payerCountry" TEXT,
  ADD COLUMN "payerCardLast4" TEXT,
  ADD COLUMN "paymentProofUrl" TEXT,
  ADD COLUMN "paymentProofUnavailable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "paymentClaimedAt" TIMESTAMP(3),
  ADD COLUMN "stripePaidAt" TIMESTAMP(3),
  ADD COLUMN "paymentConfirmedAt" TIMESTAMP(3),
  ADD COLUMN "paymentConfirmedById" TEXT,
  ADD COLUMN "verifiedAt" TIMESTAMP(3),
  ADD COLUMN "rejectedAt" TIMESTAMP(3);

ALTER TABLE "VerificationRequest"
  ADD CONSTRAINT "VerificationRequest_archiveId_fkey"
  FOREIGN KEY ("archiveId") REFERENCES "VerificationArchive"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SiteSettings" ADD COLUMN "cardSubscriptionPriceUsd" INTEGER NOT NULL DEFAULT 25;

-- Las ramas que YA existían (creadas al verificarse, criterio anterior)
-- terminaron todas en VERIFIED — se marcan como tal para que el archivo
-- las muestre con su cierre real y no como "en curso".
UPDATE "VerificationArchive" SET "verifiedAt" = "archivedAt" WHERE "verifiedAt" IS NULL;
