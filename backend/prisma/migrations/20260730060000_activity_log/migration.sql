-- Bloque 70: registro general de actividad de vendedores/clientes + campos
-- ya usados por el bug fix de correos liberados en soft-delete (no requiere
-- columna nueva, solo lee/escribe User.email existente).

-- CreateEnum
CREATE TYPE "ActivityActorRole" AS ENUM ('VENDOR', 'CUSTOMER');

-- CreateTable
CREATE TABLE "ActivityLog" (
    "id" TEXT NOT NULL,
    "actorId" TEXT NOT NULL,
    "actorRole" "ActivityActorRole" NOT NULL,
    "vendorId" TEXT,
    "action" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ActivityLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ActivityLog_actorId_createdAt_idx" ON "ActivityLog"("actorId", "createdAt");
CREATE INDEX "ActivityLog_vendorId_createdAt_idx" ON "ActivityLog"("vendorId", "createdAt");
CREATE INDEX "ActivityLog_createdAt_idx" ON "ActivityLog"("createdAt");

-- AddForeignKey
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "ActivityLog" ADD CONSTRAINT "ActivityLog_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
