-- Bloque 55: precios por cantidad (mayoreo), opcionales por producto.
CREATE TABLE "ProductPriceTier" (
    "id" TEXT NOT NULL,
    "productId" TEXT NOT NULL,
    "minQty" INTEGER NOT NULL,
    "price" DECIMAL(12,2) NOT NULL,

    CONSTRAINT "ProductPriceTier_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "ProductPriceTier_productId_minQty_key" ON "ProductPriceTier"("productId", "minQty");
CREATE INDEX "ProductPriceTier_productId_minQty_idx" ON "ProductPriceTier"("productId", "minQty");

ALTER TABLE "ProductPriceTier" ADD CONSTRAINT "ProductPriceTier_productId_fkey" FOREIGN KEY ("productId") REFERENCES "Product"("id") ON DELETE CASCADE ON UPDATE CASCADE;
