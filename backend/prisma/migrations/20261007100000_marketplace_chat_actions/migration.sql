-- Bloque 270: los botones "Ver todas las tiendas / Ver todos los productos" del chat
-- principal guardan su enlace filtrado para que sigan al volver a abrir el chat.
ALTER TABLE "MarketplaceChatMessage" ADD COLUMN "actions" JSONB;
