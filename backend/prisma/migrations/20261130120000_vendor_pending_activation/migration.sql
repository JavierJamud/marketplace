-- Plan con insignia que el equipo activó (o un pago que se confirmó) mientras la tienda no tenía completos los requisitos
-- de la verificación: queda guardado aquí y se aplica solo cuando la tienda los completa. Mientras tanto no tiene insignia
-- ni funciones del plan.
ALTER TABLE "Vendor" ADD COLUMN "pendingActivation" JSONB;

-- Avisos a la tienda: el plan quedó pendiente de completar la cuenta, o su insignia se pausó porque le faltan documentos.
ALTER TYPE "VendorNotificationType" ADD VALUE 'PLAN_PENDING_COMPLETION';
ALTER TYPE "VendorNotificationType" ADD VALUE 'PLAN_PAUSED_INCOMPLETE';
