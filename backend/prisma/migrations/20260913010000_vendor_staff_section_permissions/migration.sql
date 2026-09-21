-- Bloque 185: permisos granulares (lectura/escritura) por sección para
-- usuarios de sistema. Default '{}' = todas las secciones ya asignadas se
-- siguen tratando como "manage" (ver sectionLevel() en requireVendorAccess.js)
-- así ningún usuario ya creado pierde acceso de golpe con esta migración.
ALTER TABLE "VendorStaff" ADD COLUMN "sectionPermissions" JSONB NOT NULL DEFAULT '{}';
