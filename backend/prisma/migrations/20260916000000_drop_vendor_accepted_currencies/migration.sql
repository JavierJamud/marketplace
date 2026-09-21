-- Bloque 206: acceptedCurrencies quedó reemplazado por Vendor.currency —
-- sin lectores ni escritores reales (VendorSettings.jsx ya no lo manda).
ALTER TABLE "Vendor" DROP COLUMN "acceptedCurrencies";
