-- Bloque 241 (pedido explícito): las listas del admin (productos, tiendas,
-- clientes) pasan a paginar en el servidor y ordenar por métricas reales —
-- sin estos índices cada página recorría la tabla entera. Solo índices, no
-- cambia ningún dato.
CREATE INDEX "Product_vendorId_createdAt_idx" ON "Product"("vendorId", "createdAt");
CREATE INDEX "Product_salesCount_idx" ON "Product"("salesCount");
CREATE INDEX "Product_isActive_idx" ON "Product"("isActive");
CREATE INDEX "Order_vendorId_createdAt_idx" ON "Order"("vendorId", "createdAt");
CREATE INDEX "User_role_createdAt_idx" ON "User"("role", "createdAt");
CREATE INDEX "Vendor_planType_createdAt_idx" ON "Vendor"("planType", "createdAt");
