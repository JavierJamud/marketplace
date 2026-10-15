-- AlterTable
ALTER TABLE "Review" ADD COLUMN "title" TEXT,
ADD COLUMN "adminReply" TEXT,
ADD COLUMN "adminRepliedAt" TIMESTAMP(3);

-- Las respuestas que ya había dado el equipo de la plataforma pasan a su propio campo (antes iban en el de la tienda con una marca).
UPDATE "Review" SET "adminReply" = "vendorReply", "adminRepliedAt" = "vendorRepliedAt", "vendorReply" = NULL, "vendorRepliedAt" = NULL WHERE "repliedByAdmin" = true;

-- AlterTable
ALTER TABLE "Review" DROP COLUMN "repliedByAdmin";
