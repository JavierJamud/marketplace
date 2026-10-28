-- Tipo de correo para los avisos de cobro de planes sin insignia (va solo: ADD VALUE no puede ir con otros cambios).
ALTER TYPE "EmailType" ADD VALUE IF NOT EXISTS 'PLAN_BILLING_NOTICE';
