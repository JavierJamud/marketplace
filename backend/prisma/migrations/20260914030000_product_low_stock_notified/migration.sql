-- Bloque 194: marca de "ya se avisó por bajo stock" para no repetir el
-- correo todos los días mientras el stock siga bajo.
ALTER TABLE "Product" ADD COLUMN "lowStockNotifiedAt" TIMESTAMP(3);
