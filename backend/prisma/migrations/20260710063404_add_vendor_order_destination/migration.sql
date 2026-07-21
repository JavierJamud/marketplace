-- CreateEnum
CREATE TYPE "OrderDestination" AS ENUM ('WHATSAPP', 'PANEL');

-- AlterTable
ALTER TABLE "Vendor" ADD COLUMN     "orderDestination" "OrderDestination" NOT NULL DEFAULT 'WHATSAPP';
