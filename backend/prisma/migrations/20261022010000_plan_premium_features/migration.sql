-- Plan gratis = lo básico (decisión del dueño, 2026-10-17). Dos interruptores nuevos por plan:
--   allowPos            caja con código de barras (ventas de mostrador, pantallas, movimientos de dinero);
--   allowCustomerEmails correos a clientes con el nombre de la tienda (confirmación y estado de pedidos, mensajes y facturas por
--                       correo, respuesta a reseñas, recordatorios y recuperación de clientes) y correos automáticos de gestión
--                       (stock bajo, cierre de caja). Los correos de seguridad y de cuenta no dependen del plan.
ALTER TABLE "PlanConfig"
  ADD COLUMN "allowPos" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "allowCustomerEmails" BOOLEAN NOT NULL DEFAULT true;

-- Pasan a Premium: caja, correos, programa de fidelidad, códigos de descuento, mesas con QR y usuarios del equipo.
-- El admin puede volver a cambiar cualquiera desde Suscripciones › Configuración de planes.
UPDATE "PlanConfig"
SET "allowPos" = false,
    "allowCustomerEmails" = false,
    "allowLoyalty" = false,
    "allowDiscountCodes" = false,
    "allowQrTables" = false,
    "allowStaffUsers" = false,
    "maxMonthlyOrderEmails" = 0
WHERE "planType" = 'REGULAR';

UPDATE "PlanConfig"
SET "allowPos" = true, "allowCustomerEmails" = true, "allowLoyalty" = true, "allowDiscountCodes" = true, "allowQrTables" = true, "allowStaffUsers" = true
WHERE "planType" = 'BUSINESS';
