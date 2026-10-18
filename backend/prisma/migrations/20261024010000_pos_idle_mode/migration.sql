-- Caja: qué muestra la pantalla del cliente sin venta en curso. SHOWCASE = vitrina animada con los productos y ofertas de la
-- tienda (elegidos por demanda); IMAGE = la imagen fija que sube la tienda.
ALTER TABLE "PosSettings" ADD COLUMN "idleMode" TEXT NOT NULL DEFAULT 'SHOWCASE';
-- Quien ya había subido una imagen la sigue viendo igual.
UPDATE "PosSettings" SET "idleMode" = 'IMAGE' WHERE "idleImageUrl" IS NOT NULL;
