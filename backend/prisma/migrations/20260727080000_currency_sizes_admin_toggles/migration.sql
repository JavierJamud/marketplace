-- Bloque 52: moneda por producto, tallas + inventario por talla, toggle del
-- chatbot del Home, y lista de métodos de pago de producto administrable.

CREATE TYPE "ProductCurrency" AS ENUM ('CUP', 'USD', 'EUR');

ALTER TABLE "Product" ADD COLUMN "currency" "ProductCurrency" NOT NULL DEFAULT 'CUP';
ALTER TABLE "Product" ADD COLUMN "sizes" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Product" ADD COLUMN "sizeStock" JSONB;

ALTER TABLE "OrderItem" ADD COLUMN "size" TEXT;
ALTER TABLE "OrderItem" ADD COLUMN "currency" "ProductCurrency" NOT NULL DEFAULT 'CUP';

ALTER TABLE "SiteSettings" ADD COLUMN "showChatWidget" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "SiteSettings" ADD COLUMN "productPaymentMethods" TEXT[] NOT NULL DEFAULT ARRAY['cod', 'prepaid']::TEXT[];
