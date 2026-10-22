-- Monedas y formas de pago dejan de ser listas fijas: el admin las agrega, renombra, activa o elimina (si nadie las usa).
-- Productos, tiendas y pedidos siguen guardando el código (USD, cod...), que nunca cambia; el nombre visible sale de esta tabla.
CREATE TYPE "CatalogKind" AS ENUM ('CURRENCY', 'PRODUCT_PAYMENT', 'CHECKOUT_PAYMENT', 'STORE_PAYMENT');

CREATE TABLE "CatalogOption" (
  "id" TEXT NOT NULL,
  "kind" "CatalogKind" NOT NULL,
  "code" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT,
  "icon" TEXT,
  "isActive" BOOLEAN NOT NULL DEFAULT true,
  "isUniversal" BOOLEAN NOT NULL DEFAULT false,
  "sortOrder" INTEGER NOT NULL DEFAULT 0,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CatalogOption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "CatalogOption_kind_code_key" ON "CatalogOption"("kind", "code");

-- Valores de hoy, con el mismo estado activo que tenían en la configuración.
INSERT INTO "CatalogOption" ("id", "kind", "code", "label", "description", "icon", "isActive", "isUniversal", "sortOrder") VALUES
  ('cat_cur_cup', 'CURRENCY', 'CUP', 'CUP', 'Peso cubano', 'banknote', COALESCE((SELECT 'CUP' = ANY("availableCurrencies") FROM "SiteSettings" LIMIT 1), true), false, 0),
  ('cat_cur_usd', 'CURRENCY', 'USD', 'USD', 'Dólar estadounidense', 'dollar', COALESCE((SELECT 'USD' = ANY("availableCurrencies") FROM "SiteSettings" LIMIT 1), true), false, 1),
  ('cat_cur_eur', 'CURRENCY', 'EUR', 'EUR', 'Euro', 'euro', COALESCE((SELECT 'EUR' = ANY("availableCurrencies") FROM "SiteSettings" LIMIT 1), true), false, 2),
  ('cat_cur_mxn', 'CURRENCY', 'MXN', 'MXN', 'Peso mexicano', 'coins', COALESCE((SELECT 'MXN' = ANY("availableCurrencies") FROM "SiteSettings" LIMIT 1), true), false, 3),
  ('cat_pp_whatsapp', 'PRODUCT_PAYMENT', 'whatsapp', 'WhatsApp', 'Se acuerda el pago por WhatsApp con el vendedor', 'message', true, true, 0),
  ('cat_pp_cod', 'PRODUCT_PAYMENT', 'cod', 'Contra entrega', 'Se paga al recibir el pedido', 'truck', COALESCE((SELECT 'cod' = ANY("productPaymentMethods") FROM "SiteSettings" LIMIT 1), true), false, 1),
  ('cat_pp_prepaid', 'PRODUCT_PAYMENT', 'prepaid', 'Pago anticipado', 'Se paga antes de recibir el pedido', 'wallet', COALESCE((SELECT 'prepaid' = ANY("productPaymentMethods") FROM "SiteSettings" LIMIT 1), true), false, 2),
  ('cat_cp_cod', 'CHECKOUT_PAYMENT', 'cod', 'Pago contra entrega', 'Coordinado por WhatsApp con el vendedor', 'truck', true, false, 0),
  ('cat_cp_online', 'CHECKOUT_PAYMENT', 'online', 'Pago en línea con el vendedor', 'Transferencia, Zelle, etc. Arreglan método y monto directo por WhatsApp', 'card', true, false, 1),
  ('cat_cp_cash', 'CHECKOUT_PAYMENT', 'cash', 'Efectivo', 'Coordinas el lugar y momento por WhatsApp', 'banknote', true, false, 2),
  ('cat_sp_zelle', 'STORE_PAYMENT', 'zelle', 'Zelle', NULL, 'send', true, false, 0),
  ('cat_sp_visa', 'STORE_PAYMENT', 'visa', 'Visa', NULL, 'card', true, false, 1),
  ('cat_sp_mastercard', 'STORE_PAYMENT', 'mastercard', 'Mastercard', NULL, 'card', true, false, 2),
  ('cat_sp_usdt', 'STORE_PAYMENT', 'usdt', 'USDT', NULL, 'coins', true, false, 3),
  ('cat_sp_tropipay', 'STORE_PAYMENT', 'tropipay', 'Tropipay', NULL, 'wallet', true, false, 4),
  ('cat_sp_card', 'STORE_PAYMENT', 'card', 'Tarjeta de crédito/débito', NULL, 'card', true, false, 5),
  ('cat_sp_bizum', 'STORE_PAYMENT', 'bizum', 'Bizum', NULL, 'phone', true, false, 6),
  ('cat_sp_postepay', 'STORE_PAYMENT', 'postepay', 'Postepay', NULL, 'card', true, false, 7),
  ('cat_sp_iban', 'STORE_PAYMENT', 'iban', 'IBAN / Transferencia', NULL, 'bank', true, false, 8),
  ('cat_sp_paypal', 'STORE_PAYMENT', 'paypal', 'PayPal', NULL, 'wallet', true, false, 9),
  ('cat_sp_cashapp', 'STORE_PAYMENT', 'cashapp', 'Cash App', NULL, 'phone', true, false, 10),
  ('cat_sp_venmo', 'STORE_PAYMENT', 'venmo', 'Venmo', NULL, 'phone', true, false, 11);

-- Las columnas de moneda pasan de la lista fija de Postgres a texto: así una moneda nueva no exige tocar la base.
ALTER TABLE "Product" ALTER COLUMN "currency" DROP DEFAULT, ALTER COLUMN "currency" TYPE TEXT USING "currency"::text, ALTER COLUMN "currency" SET DEFAULT 'CUP';
ALTER TABLE "Product" ALTER COLUMN "shippingCurrency" TYPE TEXT USING "shippingCurrency"::text;
ALTER TABLE "Vendor" ALTER COLUMN "currency" DROP DEFAULT, ALTER COLUMN "currency" TYPE TEXT USING "currency"::text, ALTER COLUMN "currency" SET DEFAULT 'CUP';
ALTER TABLE "Vendor" ALTER COLUMN "storeShippingCurrency" TYPE TEXT USING "storeShippingCurrency"::text;
ALTER TABLE "OrderItem" ALTER COLUMN "currency" DROP DEFAULT, ALTER COLUMN "currency" TYPE TEXT USING "currency"::text, ALTER COLUMN "currency" SET DEFAULT 'CUP';
ALTER TABLE "OrderItem" ALTER COLUMN "shippingCurrency" TYPE TEXT USING "shippingCurrency"::text;
ALTER TABLE "CustomerListing" ALTER COLUMN "currency" DROP DEFAULT, ALTER COLUMN "currency" TYPE TEXT USING "currency"::text, ALTER COLUMN "currency" SET DEFAULT 'USD';
ALTER TABLE "DiscountCode" ALTER COLUMN "currency" DROP DEFAULT, ALTER COLUMN "currency" TYPE TEXT USING "currency"::text, ALTER COLUMN "currency" SET DEFAULT 'CUP';
DROP TYPE "ProductCurrency";

-- Igual con la forma de cobro del pedido: una forma nueva del checkout se guarda con su código en mayúsculas.
ALTER TABLE "Order" ALTER COLUMN "channel" TYPE TEXT USING "channel"::text;
DROP TYPE "OrderChannel";
