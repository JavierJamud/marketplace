-- Bloque 85: nuevo origen de ErrorLog para la verificación diaria
-- automática de los proveedores de IA.

-- AlterEnum
ALTER TYPE "ErrorOrigin" ADD VALUE 'AI_HEALTH_CHECK';
