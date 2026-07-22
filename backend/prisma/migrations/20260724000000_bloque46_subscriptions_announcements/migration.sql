-- Bloque 46: suscripciones Business (admin, sobre datos ya existentes, sin
-- tabla nueva) + anuncios programados (banners públicos).

-- Nuevo valor del ciclo de notificaciones de verificación/cobro.
ALTER TYPE "VendorNotificationType" ADD VALUE 'VERIFICATION_BUSINESS_REVOKED';

-- Anuncios programados
CREATE TYPE "AnnouncementPage" AS ENUM ('HOME', 'STORES', 'ALL');
CREATE TYPE "AnnouncementPosition" AS ENUM ('HERO', 'TOP_BAR');

CREATE TABLE "Announcement" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "page" "AnnouncementPage" NOT NULL,
    "position" "AnnouncementPosition" NOT NULL,
    "imageUrl" TEXT,
    "startAt" TIMESTAMP(3) NOT NULL,
    "endAt" TIMESTAMP(3) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Announcement_pkey" PRIMARY KEY ("id")
);
