-- AlterTable
ALTER TABLE "User" ADD COLUMN     "country" TEXT,
ADD COLUMN     "resetCodeExpiresAt" TIMESTAMP(3),
ADD COLUMN     "resetCodeHash" TEXT;

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "ownerName" TEXT;
