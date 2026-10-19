-- Moneda de cada código de descuento: un código en CUP solo descuenta productos en CUP (y viceversa).
ALTER TABLE "DiscountCode" ADD COLUMN "currency" "ProductCurrency" NOT NULL DEFAULT 'CUP';

-- Los de monto fijo se crearon con el formulario que decía "Monto fijo (CUP)": se quedan en CUP.
-- Los de porcentaje antes valían para cualquier producto: toman la moneda en la que la tienda publica la mayoría de
-- sus productos (o la moneda de la tienda si no tiene productos), para no dejar de funcionar de un día para otro.
UPDATE "DiscountCode" d
SET "currency" = COALESCE(
  (SELECT p."currency" FROM "Product" p WHERE p."vendorId" = d."vendorId" GROUP BY p."currency" ORDER BY COUNT(*) DESC LIMIT 1),
  v."currency"
)
FROM "Vendor" v
WHERE v."id" = d."vendorId" AND d."type" = 'PERCENTAGE';
