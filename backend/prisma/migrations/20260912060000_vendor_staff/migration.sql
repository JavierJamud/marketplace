-- AlterEnum
ALTER TYPE "Role" ADD VALUE 'VENDOR_STAFF';

-- AlterEnum
ALTER TYPE "ActivityActorRole" ADD VALUE 'VENDOR_STAFF';

-- AlterTable
ALTER TABLE "User" ADD COLUMN     "mustSetPassword" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "VendorStaff" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "allowedSections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "photoUrl" TEXT,
    "createdByUserId" TEXT NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "VendorStaff_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "VendorStaff_userId_key" ON "VendorStaff"("userId");

-- CreateIndex
CREATE INDEX "VendorStaff_vendorId_idx" ON "VendorStaff"("vendorId");

-- AddForeignKey
ALTER TABLE "VendorStaff" ADD CONSTRAINT "VendorStaff_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorStaff" ADD CONSTRAINT "VendorStaff_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "VendorStaff" ADD CONSTRAINT "VendorStaff_createdByUserId_fkey" FOREIGN KEY ("createdByUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
