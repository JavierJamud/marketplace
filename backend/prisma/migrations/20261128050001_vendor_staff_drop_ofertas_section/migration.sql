-- La sección "ofertas" del panel de la tienda se quitó en el Bloque 297 (los vendedores ya no publican en la portada) y el
-- backend valida allowedSections y sectionPermissions con z.enum(VENDOR_SECTION_KEYS). Un usuario de sistema creado antes
-- que todavía la tenga guardada no se podría editar (400), porque el formulario reenvía sus secciones tal cual. Se limpia.
UPDATE "VendorStaff"
SET "allowedSections" = array_remove("allowedSections", 'ofertas')
WHERE 'ofertas' = ANY("allowedSections");

UPDATE "VendorStaff"
SET "sectionPermissions" = "sectionPermissions" - 'ofertas'
WHERE "sectionPermissions" ? 'ofertas';
