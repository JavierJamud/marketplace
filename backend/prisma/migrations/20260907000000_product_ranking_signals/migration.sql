-- Bloque 98: señales agregadas para el algoritmo de "Destacados" — ver
-- lib/productRanking.js. Contadores acumulados en vez de una tabla de
-- eventos, a propósito (ver comentario largo en schema.prisma).

-- AlterTable
ALTER TABLE "Product"
  ADD COLUMN "viewCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "clickCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "searchClickCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "totalDwellMs" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "salesCount" INTEGER NOT NULL DEFAULT 0;
