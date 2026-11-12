-- Avisos del panel de tiendas: público "SELECTED" (solo las tiendas que el admin elige).
ALTER TABLE "VendorPanelNotice" ADD COLUMN "vendorIds" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
