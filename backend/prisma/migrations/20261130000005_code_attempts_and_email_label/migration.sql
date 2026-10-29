-- Tope de intentos por código de un solo uso (auth.controller.js, takeCodeAttempt). Antes el único freno era el límite por
-- IP y, repartiendo IPs, se podía recorrer el millón de combinaciones de un código de 6 dígitos. Cada columna cuenta las
-- pruebas del código vigente y vuelve a 0 cada vez que se emite uno nuevo.
ALTER TABLE "User" ADD COLUMN "resetCodeAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "twoFactorCodeAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "PendingRegistration" ADD COLUMN "codeAttempts" INTEGER NOT NULL DEFAULT 0;

-- Texto público del tope de correos del plan. Decía "Correos a tus clientes (hasta N al mes)", como si fuera un tope de
-- todos los correos, pero solo cuenta los que la tienda escribe a mano desde un pedido (orders.controller.js,
-- countManualEmailsThisMonth): los automáticos (pedido, factura, garantía, recordatorios) no cuentan. Solo se cambia si el
-- admin no lo editó (sigue el texto sembrado en 20261129000000_dynamic_plans).
UPDATE "PlanFeature"
SET "publicLabel" = 'Hasta {n} {correo escrito|correos escritos} a mano al mes a tus clientes (los automáticos no cuentan)',
    "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'maxMonthlyOrderEmails'
  AND "publicLabel" = 'Correos a tus clientes (hasta {n} al mes)';
