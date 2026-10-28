-- Ganancia aproximada de la tienda para proteger su margen, y tipo de correo de los avisos de puntos al cliente.
ALTER TABLE "LoyaltyProgram" ADD COLUMN "marginPercent" INTEGER;
ALTER TYPE "EmailType" ADD VALUE 'LOYALTY_POINTS';
