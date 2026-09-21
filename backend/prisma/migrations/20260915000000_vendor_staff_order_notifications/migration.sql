-- Bloque 205: si un usuario de sistema recibe (o no) el aviso en pantalla de
-- pedidos nuevos/pendientes (NewOrderPopup/StaleOrderAlert) — default false
-- a nivel de columna, el "true si es mesero" es una decisión de UX al crear
-- el usuario (ver CreateStaffModal, VendorUsers.jsx), no algo que la base de
-- datos deba asumir sola.
ALTER TABLE "VendorStaff" ADD COLUMN     "receivesOrderNotifications" BOOLEAN NOT NULL DEFAULT false;
