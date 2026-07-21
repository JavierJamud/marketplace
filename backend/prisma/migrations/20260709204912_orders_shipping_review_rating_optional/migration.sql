-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "shippingAddress" TEXT,
ADD COLUMN     "shippingMunicipalityId" TEXT,
ADD COLUMN     "shippingProvinceId" TEXT;

-- AlterTable
ALTER TABLE "Review" ALTER COLUMN "rating" DROP NOT NULL;
