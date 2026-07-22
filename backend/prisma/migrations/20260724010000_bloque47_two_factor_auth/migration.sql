-- Bloque 47: 2FA opt-in por código de correo.
ALTER TABLE "User" ADD COLUMN "twoFactorEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN "twoFactorCodeHash" TEXT;
ALTER TABLE "User" ADD COLUMN "twoFactorCodeExpiresAt" TIMESTAMP(3);
