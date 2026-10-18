-- Producto elegido a mano para el cupo de productos visibles del plan.
ALTER TABLE "Product" ADD COLUMN "quotaPinnedAt" TIMESTAMP(3);
