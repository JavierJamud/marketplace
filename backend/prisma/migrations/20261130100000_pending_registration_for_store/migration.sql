-- Registro de tienda con el correo de una cuenta de cliente: al verificar el código, la tienda se crea en esa misma cuenta.
ALTER TABLE "PendingRegistration" ADD COLUMN "forStore" BOOLEAN NOT NULL DEFAULT false;
