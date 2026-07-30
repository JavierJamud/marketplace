-- Bloque 65: moneda operativa única por tienda.

ALTER TABLE "Vendor" ADD COLUMN "currency" "ProductCurrency" NOT NULL DEFAULT 'CUP';
ALTER TABLE "SiteSettings" ADD COLUMN "availableCurrencies" TEXT[] NOT NULL DEFAULT ARRAY['CUP', 'USD', 'EUR', 'MXN']::TEXT[];
