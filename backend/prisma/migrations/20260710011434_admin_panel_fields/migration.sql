-- AlterTable
ALTER TABLE "Campaign" ADD COLUMN     "provinceId" TEXT,
ADD COLUMN     "segment" TEXT NOT NULL DEFAULT 'all_customers';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "isSuspended" BOOLEAN NOT NULL DEFAULT false;
