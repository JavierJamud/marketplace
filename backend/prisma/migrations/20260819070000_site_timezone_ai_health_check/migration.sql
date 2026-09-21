-- Bloque 85: zona horaria configurable del sitio + marca de la última
-- verificación automática de proveedores de IA.

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "timezone" TEXT NOT NULL DEFAULT 'America/Havana';
ALTER TABLE "SiteSettings" ADD COLUMN "lastAiHealthCheckAt" TIMESTAMP(3);
