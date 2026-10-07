-- Nombre y apellidos privados del administrador (solo visibles en su "Mi perfil").
ALTER TABLE "User" ADD COLUMN "firstName" TEXT, ADD COLUMN "lastName" TEXT;

-- Quita el nombre provisional que puso un script de una sola vez: el dueño lo define en "Mi perfil".
UPDATE "User" SET "fullName" = NULL WHERE "role" = 'ADMIN' AND "fullName" = 'Xavi Admin';
