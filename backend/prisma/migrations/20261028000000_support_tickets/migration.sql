-- Tickets de errores visuales reportados desde el panel de la tienda (captura, consola y lo que la persona hizo).
ALTER TYPE "EmailType" ADD VALUE 'SUPPORT_TICKET';

CREATE TYPE "SupportTicketStatus" AS ENUM ('NEW', 'IN_REVIEW', 'WAITING_REPORTER', 'RESOLVED', 'CLOSED_NO_EVIDENCE', 'CLOSED_NOT_A_BUG');

CREATE TABLE "SupportTicket" (
    "id" TEXT NOT NULL,
    "number" SERIAL NOT NULL,
    "vendorId" TEXT,
    "reporterId" TEXT,
    "reporterName" TEXT,
    "reporterEmail" TEXT NOT NULL,
    "reporterRole" TEXT NOT NULL,
    "pagePath" TEXT NOT NULL,
    "section" TEXT,
    "description" TEXT NOT NULL,
    "screenshotFile" TEXT,
    "consoleLog" JSONB,
    "activityTrail" JSONB,
    "device" JSONB,
    "status" "SupportTicketStatus" NOT NULL DEFAULT 'NEW',
    "resolution" TEXT,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "SupportTicket_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "SupportTicketMessage" (
    "id" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "authorId" TEXT,
    "body" TEXT NOT NULL,
    "statusChange" "SupportTicketStatus",
    "emailedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SupportTicketMessage_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "SupportTicket_number_key" ON "SupportTicket"("number");
CREATE INDEX "SupportTicket_status_createdAt_idx" ON "SupportTicket"("status", "createdAt");
CREATE INDEX "SupportTicket_vendorId_createdAt_idx" ON "SupportTicket"("vendorId", "createdAt");
CREATE INDEX "SupportTicket_createdAt_idx" ON "SupportTicket"("createdAt");
CREATE INDEX "SupportTicketMessage_ticketId_createdAt_idx" ON "SupportTicketMessage"("ticketId", "createdAt");

ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicket" ADD CONSTRAINT "SupportTicket_reporterId_fkey" FOREIGN KEY ("reporterId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
ALTER TABLE "SupportTicketMessage" ADD CONSTRAINT "SupportTicketMessage_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "SupportTicket"("id") ON DELETE CASCADE ON UPDATE CASCADE;
