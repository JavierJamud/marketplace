CREATE TYPE "ShippingMode" AS ENUM ('FREE', 'FIXED', 'COORDINATE');

ALTER TABLE "Product" ADD COLUMN "shippingMode" "ShippingMode" NOT NULL DEFAULT 'FREE',
ADD COLUMN "shippingLocal" DECIMAL(12,2),
ADD COLUMN "shippingOther" DECIMAL(12,2),
ADD COLUMN "shippingCurrency" "ProductCurrency",
ADD COLUMN "shippingPerUnit" BOOLEAN NOT NULL DEFAULT false;

ALTER TABLE "Vendor" ADD COLUMN "storeShippingMode" "ShippingMode",
ADD COLUMN "storeShippingLocal" DECIMAL(12,2),
ADD COLUMN "storeShippingOther" DECIMAL(12,2),
ADD COLUMN "storeShippingCurrency" "ProductCurrency";

ALTER TABLE "Order" ADD COLUMN "shippingFees" JSONB,
ADD COLUMN "shippingCoordinate" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "shippingSource" TEXT,
ADD COLUMN "shippingZone" TEXT;

ALTER TABLE "OrderItem" ADD COLUMN "shippingMode" "ShippingMode",
ADD COLUMN "shippingAmount" DECIMAL(12,2),
ADD COLUMN "shippingCurrency" "ProductCurrency";
