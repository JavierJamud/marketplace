CREATE TABLE "SearchTerm" (
    "id" TEXT NOT NULL,
    "term" TEXT NOT NULL,
    "count" INTEGER NOT NULL DEFAULT 1,
    "blocked" BOOLEAN NOT NULL DEFAULT false,
    "lastSearchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "SearchTerm_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "SearchTerm_term_key" ON "SearchTerm"("term");
CREATE INDEX "SearchTerm_count_idx" ON "SearchTerm"("count");
ALTER TABLE "SiteSettings" ADD COLUMN "trendingSearches" JSONB;
