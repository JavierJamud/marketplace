-- Al eliminar una cuenta el correo se reescribe (deleted+id@zeudin.invalid) para liberar el correo a un registro nuevo.
-- Estos campos guardan, solo para el admin, el correo real y quién, cuándo y por qué se eliminó.
ALTER TABLE "User" ADD COLUMN "deletedEmail" TEXT;
ALTER TABLE "User" ADD COLUMN "deletionSource" TEXT;
ALTER TABLE "User" ADD COLUMN "deletedById" TEXT;
ALTER TABLE "User" ADD COLUMN "deletionReason" TEXT;
