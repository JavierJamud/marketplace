-- Bloque 72: archivo permanente de la documentación de verificación de cada
-- tienda — una rama por verificación exitosa, nunca se reemplaza.

-- CreateTable
CREATE TABLE "VerificationArchive" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "companyName" TEXT NOT NULL,
    "ownerName" TEXT,
    "ownerIdNumber" TEXT,
    "companyTaxId" TEXT,
    "companyAddress" TEXT,
    "description" TEXT,
    "idDocumentType" "IdDocumentType",
    "fullName" TEXT,
    "idNumber" TEXT,
    "registrationCountryName" TEXT,
    "legalProvinceName" TEXT,
    "legalMunicipalityName" TEXT,
    "selfieUrl" TEXT,
    "idPhotoFrontUrl" TEXT,
    "idPhotoBackUrl" TEXT,
    "submittedAt" TIMESTAMP(3),
    "reviewedAt" TIMESTAMP(3),
    "reviewedById" TEXT,
    "notes" TEXT,
    "archivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VerificationArchive_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "VerificationArchive_vendorId_archivedAt_idx" ON "VerificationArchive"("vendorId", "archivedAt");

-- AddForeignKey
ALTER TABLE "VerificationArchive" ADD CONSTRAINT "VerificationArchive_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VerificationArchive" ADD CONSTRAINT "VerificationArchive_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
