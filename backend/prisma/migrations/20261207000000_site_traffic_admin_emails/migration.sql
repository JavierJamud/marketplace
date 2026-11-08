-- Correos al admin: aviso de tienda nueva y resumen semanal de la plataforma.
ALTER TYPE "EmailType" ADD VALUE 'ADMIN_NEW_VENDOR';
ALTER TYPE "EmailType" ADD VALUE 'ADMIN_WEEKLY_SUMMARY';

-- Visitas al sitio público por día y zona (sin datos de quién visitó).
CREATE TABLE "SiteTrafficDay" (
    "day" DATE NOT NULL,
    "area" TEXT NOT NULL,
    "views" INTEGER NOT NULL DEFAULT 0,
    "sessions" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "SiteTrafficDay_pkey" PRIMARY KEY ("day","area")
);
CREATE INDEX "SiteTrafficDay_day_idx" ON "SiteTrafficDay"("day");
