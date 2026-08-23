-- Bloque 64: fuente única de verdad de verificación (Vendor.verificationStatus),
-- Stripe recurrente, y datos bancarios CUP editables.

CREATE TYPE "VendorVerificationStatus" AS ENUM ('NOT_STARTED', 'PENDING_DOCS', 'IN_REVIEW', 'PENDING_PAYMENT', 'VERIFIED', 'PAYMENT_FAILED', 'SUSPENDED', 'REJECTED');
CREATE TYPE "VerificationStatusSource" AS ENUM ('ADMIN_ACTION', 'STRIPE_WEBHOOK', 'CRON_EXPIRATION', 'VENDOR_ACTION');

ALTER TABLE "Vendor" ADD COLUMN "verificationStatus" "VendorVerificationStatus" NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE "Vendor" ADD COLUMN "stripeCustomerId" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "stripeSubscriptionId" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "nextPaymentDueDate" TIMESTAMP(3);

-- Migración de datos: reconstruye el estado real de cada tienda a partir del
-- viejo VerificationRequest.status + el viejo Vendor.isVerified (ambos
-- siguen existiendo en este punto de la migración). Vendedores sin ninguna
-- fila de VerificationRequest no matchean el FROM y quedan en el DEFAULT
-- 'NOT_STARTED' de la columna recién creada — correcto, nunca iniciaron nada.
-- Fix: la rama "WHEN vr.status = 'PENDING_PAYMENT'" se eliminó — comparaba
-- el enum viejo VerificationStatus (solo PENDING_REVIEW/APPROVED/REJECTED,
-- ver 20260709151616_init y 20260711050448_rename_pending_to_pending_review)
-- contra un valor que nunca existió ahí ('PENDING_PAYMENT' es del enum
-- NUEVO VendorVerificationStatus, creado arriba en esta misma migración).
-- Esa rama no podía ser cierta para ningún vendedor: el concepto de "pendiente
-- de pago" no existía antes de este bloque. Quitarla no cambia ningún dato,
-- solo evita el error de tipo al comparar contra un literal inválido para
-- ese enum.
UPDATE "Vendor" v
SET "verificationStatus" = (CASE
  WHEN v."isVerified" = true AND vr.status = 'APPROVED' THEN 'VERIFIED'
  WHEN vr.status = 'REJECTED' THEN 'REJECTED'
  WHEN vr.status = 'PENDING_REVIEW' AND (vr."selfieUrl" IS NOT NULL OR vr."idPhotoFrontUrl" IS NOT NULL) THEN 'PENDING_DOCS'
  ELSE 'NOT_STARTED'
END)::"VendorVerificationStatus"
FROM "VerificationRequest" vr
WHERE vr."vendorId" = v.id;

-- Bug real confirmado en vivo antes de este bloque: tiendas sembradas con
-- isVerified=true sin verificación completa nunca llegan a 'VERIFIED' por el
-- CASE de arriba (exige ambas condiciones a la vez) — quedan sin el Plan
-- Business que nunca deberían haber tenido.
UPDATE "Vendor"
SET "planType" = 'REGULAR'
WHERE "isVerified" = true AND "verificationStatus" != 'VERIFIED';

-- Decisión confirmada con el usuario: las tiendas que sí quedan VERIFIED de
-- verdad migran con 7 días de plazo para resolver el cobro recurrente nuevo.
UPDATE "Vendor"
SET "nextPaymentDueDate" = now() + interval '7 days'
WHERE "verificationStatus" = 'VERIFIED';

ALTER TABLE "Vendor" DROP COLUMN "isVerified";

-- VerificationRequest pierde su propio status — vive solo en
-- Vendor.verificationStatus de ahora en más.
ALTER TABLE "VerificationRequest" DROP COLUMN "status";
DROP TYPE "VerificationStatus";

CREATE TABLE "VerificationStatusLog" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "fromStatus" "VendorVerificationStatus" NOT NULL,
    "toStatus" "VendorVerificationStatus" NOT NULL,
    "reason" TEXT,
    "actorId" TEXT,
    "source" "VerificationStatusSource" NOT NULL,
    "at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "VerificationStatusLog_pkey" PRIMARY KEY ("id")
);
ALTER TABLE "VerificationStatusLog" ADD CONSTRAINT "VerificationStatusLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationStatusLog" ADD CONSTRAINT "VerificationStatusLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE "SiteSettings" ADD COLUMN "cupBankAccountNumber" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "cupBankAccountHolder" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "cupBankInstructions" TEXT;
ALTER TABLE "SiteSettings" ADD COLUMN "cupSubscriptionPriceCup" INTEGER NOT NULL DEFAULT 2500;
