-- Bloque 207 (pedido explícito): las tiendas ya no tendrán imagen de
-- banner/portada — el banner pasa a ser siempre color de marca + un patrón
-- de íconos (ver StoreHeaderBanner.jsx). Se retira la configuración del
-- panel de vendedor y la columna misma.
ALTER TABLE "Vendor" DROP COLUMN "coverUrl";
