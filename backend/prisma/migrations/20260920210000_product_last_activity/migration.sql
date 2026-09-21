-- Bloque 230 (Fase 3 del blindaje del ranking — pedido explícito):
-- ancla de recencia para el decaimiento temporal en productRanking.js.
ALTER TABLE "Product" ADD COLUMN "lastActivityAt" TIMESTAMP(3);
