-- Bloque 208: si el menú digital (availableForTableMenu) del restaurante se
-- ve en su tienda pública o solo escaneando el QR de la mesa. Default true
-- preserva el comportamiento de siempre para tiendas ya existentes.
ALTER TABLE "Vendor" ADD COLUMN     "menuPublic" BOOLEAN NOT NULL DEFAULT true;
