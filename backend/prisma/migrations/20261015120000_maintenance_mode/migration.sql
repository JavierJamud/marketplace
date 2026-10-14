-- CreateEnum
CREATE TYPE "MaintenanceMode" AS ENUM ('OFF', 'HOME', 'FULL');

-- AlterTable
ALTER TABLE "SiteSettings" ADD COLUMN "maintenanceMode" "MaintenanceMode" NOT NULL DEFAULT 'OFF',
ADD COLUMN "maintenanceMessage" TEXT;

-- Por pedido del dueño, el sitio queda en mantenimiento completo hasta que lo desactive desde Admin > Configuración.
UPDATE "SiteSettings" SET "maintenanceMode" = 'FULL';
