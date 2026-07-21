-- CreateEnum
CREATE TYPE "EngagementType" AS ENUM ('VISIT', 'CART_ADD');

-- CreateEnum
CREATE TYPE "MessageSenderRole" AS ENUM ('VENDOR', 'ADMIN');

-- CreateTable
CREATE TABLE "VendorEngagement" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "customerId" TEXT NOT NULL,
    "type" "EngagementType" NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorEngagement_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "VendorMessage" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "senderRole" "MessageSenderRole" NOT NULL,
    "senderId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorMessage_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "VendorEngagement" ADD CONSTRAINT "VendorEngagement_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorEngagement" ADD CONSTRAINT "VendorEngagement_customerId_fkey" FOREIGN KEY ("customerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorMessage" ADD CONSTRAINT "VendorMessage_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorMessage" ADD CONSTRAINT "VendorMessage_senderId_fkey" FOREIGN KEY ("senderId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
