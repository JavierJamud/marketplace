-- Bloqueo que tenía la tienda antes de pasar a eliminación pendiente. deleteVendor (admin.controller.js) lo guarda aquí
-- antes de poner su propio motivo, y restoreVendorDeletion lo devuelve. Antes restaurar dejaba desbloqueada a una tienda
-- que el admin había bloqueado por incumplir las normas. Las dos columnas en null = no estaba bloqueada.
ALTER TABLE "Vendor" ADD COLUMN "preDeletionBlockReason" TEXT;
ALTER TABLE "Vendor" ADD COLUMN "preDeletionBlockedAt" TIMESTAMP(3);
