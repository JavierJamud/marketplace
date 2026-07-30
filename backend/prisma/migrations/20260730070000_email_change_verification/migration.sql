-- Bloque 71: cambiar de correo pasa a exigir un código enviado al correo
-- viejo antes de aplicar el cambio.

-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'EMAIL_CHANGE_CODE';

-- AlterTable
ALTER TABLE "User" ADD COLUMN "pendingEmail" TEXT;
ALTER TABLE "User" ADD COLUMN "emailChangeCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "emailChangeCodeExpiresAt" TIMESTAMP(3);
