-- Bloque 69: reportar reseñas (vendedor/cliente) + revisión del admin.

-- CreateEnum
CREATE TYPE "ReviewReportStatus" AS ENUM ('REPORTED', 'KEPT', 'SUSPENDED');

-- AlterTable
ALTER TABLE "Review" ADD COLUMN "reportStatus" "ReviewReportStatus";
ALTER TABLE "Review" ADD COLUMN "reportedById" TEXT;
ALTER TABLE "Review" ADD COLUMN "reportReason" TEXT;
ALTER TABLE "Review" ADD COLUMN "reportedAt" TIMESTAMP(3);
ALTER TABLE "Review" ADD COLUMN "reportResolvedById" TEXT;
ALTER TABLE "Review" ADD COLUMN "reportResolvedAt" TIMESTAMP(3);

-- AddForeignKey
ALTER TABLE "Review" ADD CONSTRAINT "Review_reportedById_fkey" FOREIGN KEY ("reportedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "Review" ADD CONSTRAINT "Review_reportResolvedById_fkey" FOREIGN KEY ("reportResolvedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
