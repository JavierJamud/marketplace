-- Bloque 299: acceso de los socios de la API a su propio panel.
ALTER TYPE "Role" ADD VALUE IF NOT EXISTS 'PARTNER';
ALTER TABLE "Partner" ADD COLUMN "userId" TEXT;
CREATE UNIQUE INDEX "Partner_userId_key" ON "Partner"("userId");
ALTER TABLE "Partner" ADD CONSTRAINT "Partner_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
