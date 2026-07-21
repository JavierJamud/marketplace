-- CreateEnum
CREATE TYPE "ChatBotType" AS ENUM ('TIENDA', 'GENERAL');

-- CreateTable
CREATE TABLE "ChatTrainingExample" (
    "id" TEXT NOT NULL,
    "botTipo" "ChatBotType" NOT NULL,
    "entradaCliente" TEXT NOT NULL,
    "respuestaIdeal" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoPorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ChatTrainingExample_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ChatTrainingExample_botTipo_activo_createdAt_idx" ON "ChatTrainingExample"("botTipo", "activo", "createdAt");

-- AddForeignKey
ALTER TABLE "ChatTrainingExample" ADD CONSTRAINT "ChatTrainingExample_creadoPorId_fkey" FOREIGN KEY ("creadoPorId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
