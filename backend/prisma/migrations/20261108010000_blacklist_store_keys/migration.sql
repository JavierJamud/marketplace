-- La lista negra también bloquea el nombre de la tienda y su nombre de usuario (enlace). storeKey es el nombre normalizado
-- (sin mayúsculas, tildes ni signos) para comparar; las filas viejas lo reciben al arrancar el servidor (lib/blacklist.js).
ALTER TABLE "BlacklistEntry" ADD COLUMN "storeKey" TEXT;
ALTER TABLE "BlacklistEntry" ADD COLUMN "username" TEXT;
CREATE INDEX "BlacklistEntry_storeKey_idx" ON "BlacklistEntry"("storeKey");
CREATE INDEX "BlacklistEntry_username_idx" ON "BlacklistEntry"("username");
