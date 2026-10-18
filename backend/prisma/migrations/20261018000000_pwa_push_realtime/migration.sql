-- PWA: notificaciones push, interruptor de emergencia y avisos nuevos para el vendedor.
ALTER TYPE "VendorNotificationType" ADD VALUE 'ADMIN_NOTICE';
ALTER TYPE "VendorNotificationType" ADD VALUE 'NEW_CUSTOMER';
ALTER TYPE "VendorNotificationType" ADD VALUE 'NEW_MESSAGE';
ALTER TYPE "VendorNotificationType" ADD VALUE 'ORDER_OVERDUE';
ALTER TYPE "VendorNotificationType" ADD VALUE 'LOW_STOCK';

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "app" TEXT NOT NULL,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastUsedAt" TIMESTAMP(3),
    CONSTRAINT "PushSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PushSubscription_endpoint_key" ON "PushSubscription"("endpoint");
CREATE INDEX "PushSubscription_userId_idx" ON "PushSubscription"("userId");
ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Claves VAPID del servidor (la privada va cifrada). Una sola fila.
CREATE TABLE "WebPushKey" (
    "id" TEXT NOT NULL DEFAULT 'main',
    "publicKey" TEXT NOT NULL,
    "privateKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "WebPushKey_pkey" PRIMARY KEY ("id")
);

-- Categorías de aviso que la persona silenció (ver lib/pushCategories.js).
ALTER TABLE "User" ADD COLUMN "pushMuted" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- Interruptor de emergencia de la PWA: apagado, los teléfonos desinstalan el service worker y vacían su caché al siguiente acceso.
ALTER TABLE "SiteSettings" ADD COLUMN "pwaEnabled" BOOLEAN NOT NULL DEFAULT true;
