-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "notificationChannel" "OrderDestination" NOT NULL DEFAULT 'WHATSAPP';
