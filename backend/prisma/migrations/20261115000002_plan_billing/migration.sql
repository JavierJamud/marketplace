-- Cobro de planes de pago sin insignia (el Básico cuando deja de ser gratis): suspensión por falta de pago y avisos.
ALTER TABLE "Vendor" ADD COLUMN "billingSuspendedAt" TIMESTAMP(3),
ADD COLUMN "billingNoticeStage" TEXT,
ADD COLUMN "billingNoticeDue" TIMESTAMP(3);
