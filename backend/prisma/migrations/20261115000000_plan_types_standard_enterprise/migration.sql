-- Dos planes nuevos: Estándar (entre Básico y Premium) y Empresarial (se contrata por WhatsApp). Va sola porque Postgres no
-- deja usar un valor nuevo de un enum en la misma transacción que lo agrega.
ALTER TYPE "PlanType" ADD VALUE IF NOT EXISTS 'STANDARD';
ALTER TYPE "PlanType" ADD VALUE IF NOT EXISTS 'ENTERPRISE';
