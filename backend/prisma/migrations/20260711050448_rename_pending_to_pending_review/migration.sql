-- Renombra el valor del enum en vez de agregar uno nuevo y borrar el viejo:
-- ALTER TYPE ... RENAME VALUE es atómico y seguro con filas existentes (el
-- valor se guarda por OID interno, no por el texto de la etiqueta) — a
-- diferencia de ADD VALUE + DROP VALUE, que falla si hay filas usando el
-- valor que se intenta borrar.
ALTER TYPE "VerificationStatus" RENAME VALUE 'PENDING' TO 'PENDING_REVIEW';

-- Actualiza el default de la columna para que apunte al nuevo nombre.
ALTER TABLE "VerificationRequest" ALTER COLUMN "status" SET DEFAULT 'PENDING_REVIEW';
