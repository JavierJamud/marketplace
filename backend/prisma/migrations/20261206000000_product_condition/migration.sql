-- Estado del producto (Nuevo, Caja abierta, Como nuevo, De uso, Reacondicionado). Los productos ya cargados quedan como nuevos.
ALTER TABLE "Product" ADD COLUMN "condition" TEXT NOT NULL DEFAULT 'NEW';
CREATE INDEX "Product_condition_idx" ON "Product"("condition");
