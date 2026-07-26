-- Bloque 53: preguntas frecuentes reales (CRUD), separadas de StaticPage.
CREATE TYPE "FaqAudience" AS ENUM ('CUSTOMER', 'VENDOR');

CREATE TABLE "FaqItem" (
    "id" TEXT NOT NULL,
    "audience" "FaqAudience" NOT NULL,
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FaqItem_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "FaqItem_audience_createdAt_idx" ON "FaqItem"("audience", "createdAt");
