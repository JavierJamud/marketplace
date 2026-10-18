-- Caja: minutos que un pedido "Listo para recoger" se queda en la pantalla de pedidos antes de darse por recogido solo (por si
-- la tienda olvida marcarlo). La tienda lo cambia en Caja > Pantallas.
ALTER TABLE "PosSettings" ADD COLUMN "readyAutoClearMinutes" INTEGER NOT NULL DEFAULT 15;
