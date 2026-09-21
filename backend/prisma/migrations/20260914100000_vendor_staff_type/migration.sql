-- Bloque 200: tipo opcional de usuario de sistema (agente de ventas / mesero).
CREATE TYPE "VendorStaffType" AS ENUM ('SALES_AGENT', 'WAITER');

ALTER TABLE "VendorStaff" ADD COLUMN     "staffType" "VendorStaffType";
