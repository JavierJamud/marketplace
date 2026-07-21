-- Bloque 14: consolida OrderChannel de 4 valores a 3 opciones claras de
-- checkout (COD y TABLE quedan igual) + agrega Vendor.acceptedPaymentMethods
-- (informativo, ver comentario en schema.prisma).
--
-- ALTER TYPE ... RENAME VALUE es atómico y seguro con filas existentes (el
-- valor se guarda por OID interno, no por el texto de la etiqueta) — a
-- diferencia de ADD VALUE + DROP VALUE, que falla si hay filas usando el
-- valor que se intenta borrar. Ningún pedido histórico pierde datos: los que
-- tenían channel=WHATSAPP pasan a leerse CASH, los que tenían TRANSFER pasan
-- a ONLINE, automáticamente.
ALTER TYPE "OrderChannel" RENAME VALUE 'WHATSAPP' TO 'CASH';
ALTER TYPE "OrderChannel" RENAME VALUE 'TRANSFER' TO 'ONLINE';

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN "acceptedPaymentMethods" TEXT[] DEFAULT ARRAY[]::TEXT[];
