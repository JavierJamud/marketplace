-- Programa de fidelidad: el valor del punto se escribe como un par ("10 USD = 1 punto" o "1000 puntos = 10 USD") y se guarda
-- tal cual para mostrarlo igual que la tienda lo escribió. pointValue queda como dato derivado con más decimales, porque con
-- pares como 1000 puntos = 10 USD un punto vale 0,01 y con 4 decimales se perdían valores. Se quita el tope de puntos por
-- pedido: el tope en porcentaje del pedido ya protege el margen de la tienda.
CREATE TYPE "LoyaltyValueOrder" AS ENUM ('AMOUNT_FIRST', 'POINTS_FIRST');

ALTER TABLE "LoyaltyProgram"
  ADD COLUMN "valuePoints" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN "valueAmount" DECIMAL(14,4) NOT NULL DEFAULT 1,
  ADD COLUMN "valueOrder" "LoyaltyValueOrder" NOT NULL DEFAULT 'AMOUNT_FIRST',
  ALTER COLUMN "pointValue" TYPE DECIMAL(18,8);

-- Programas que ya existían: un punto de 1 o más se lee "N <moneda> = 1 punto"; uno menor que 1, "100 puntos = N <moneda>".
UPDATE "LoyaltyProgram" SET "valuePoints" = 1, "valueAmount" = "pointValue", "valueOrder" = 'AMOUNT_FIRST' WHERE "pointValue" >= 1;
UPDATE "LoyaltyProgram" SET "valuePoints" = 100, "valueAmount" = "pointValue" * 100, "valueOrder" = 'POINTS_FIRST' WHERE "pointValue" < 1;

ALTER TABLE "LoyaltyProgram" DROP COLUMN "maxRedeemPoints";
