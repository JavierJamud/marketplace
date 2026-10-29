-- Moneda de cada venta manual del personal (Productos Asignados). Antes la venta no la guardaba y el panel ponía "CUP" a
-- todo, también a productos en USD, y sumaba monedas distintas en un solo total. Se guarda la del producto al vender
-- (si el producto cambia de moneda después, la venta conserva la suya). Las ventas viejas toman la moneda actual de su
-- producto; las de un producto ya borrado quedan en null (no se sabe cuál era y no se inventa).
-- OJO al desplegar: esta migración va junto con el cambio de vendorStaffSales.controller.js que guarda currency al crear
-- la venta (registerManualSale y registerManualSalesBatch). El UPDATE de abajo corre una sola vez: una venta creada entre
-- esta migración y ese cambio quedaría en null para siempre. Si se despliegan por separado, volver a correr el mismo
-- UPDATE después de subir el controlador (es seguro repetirlo: solo toca las que siguen en null y tienen producto).
ALTER TABLE "VendorStaffSale" ADD COLUMN "currency" TEXT;

UPDATE "VendorStaffSale" s
SET "currency" = p."currency"
FROM "Product" p
WHERE s."productId" = p."id" AND s."currency" IS NULL;
