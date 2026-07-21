-- AlterEnum
ALTER TYPE "EmailType" ADD VALUE 'DOCUMENT';

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "ownerIdNumber" TEXT,
ADD COLUMN     "companyAddress" TEXT;
