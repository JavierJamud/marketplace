-- Bloque 145 (pedido explícito): nuevo tipo de notificación para cuando
-- vence el plazo de 24h de una aprobación de documentos sin completar el
-- pago (ver expireStalePendingPaymentApprovals, verificationPayment.job.js).
ALTER TYPE "VendorNotificationType" ADD VALUE 'VERIFICATION_APPROVAL_EXPIRED';
