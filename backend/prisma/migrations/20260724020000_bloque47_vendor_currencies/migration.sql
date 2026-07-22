-- Bloque 47: monedas aceptadas por la tienda (informativo, sin conversión).
ALTER TABLE "Vendor" ADD COLUMN "acceptedCurrencies" TEXT[] NOT NULL DEFAULT ARRAY['CUP']::TEXT[];
