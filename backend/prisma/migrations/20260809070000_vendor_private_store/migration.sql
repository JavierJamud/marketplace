-- Bloque 77: tienda privada — desaparece de descubrimiento público, sigue
-- 100% funcional por su link directo.

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "isPrivate" BOOLEAN NOT NULL DEFAULT false;
