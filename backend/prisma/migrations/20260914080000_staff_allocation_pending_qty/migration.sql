-- Bloque 199: lote reasignado por el dueño, pendiente de aceptación del usuario.
ALTER TABLE "VendorStaffAllocation" ADD COLUMN     "pendingQty" INTEGER NOT NULL DEFAULT 0;
