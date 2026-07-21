-- CreateTable
CREATE TABLE "MarketplaceChatMessage" (
    "id" TEXT NOT NULL,
    "sessionId" TEXT NOT NULL,
    "userId" TEXT,
    "role" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "hasImage" BOOLEAN NOT NULL DEFAULT false,
    "productIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketplaceChatMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AssistantDocument" (
    "id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "originalName" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AssistantDocument_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MarketplaceChatMessage_sessionId_idx" ON "MarketplaceChatMessage"("sessionId");

-- CreateIndex
CREATE INDEX "MarketplaceChatMessage_userId_hasImage_createdAt_idx" ON "MarketplaceChatMessage"("userId", "hasImage", "createdAt");

-- AddForeignKey
ALTER TABLE "MarketplaceChatMessage" ADD CONSTRAINT "MarketplaceChatMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
