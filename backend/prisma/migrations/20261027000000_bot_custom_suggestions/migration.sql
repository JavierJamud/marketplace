-- Preguntas sugeridas del chat del marketplace escritas por el admin (vacía = usar las automáticas).
ALTER TABLE "SiteSettings" ADD COLUMN "botCustomSuggestions" TEXT[] DEFAULT ARRAY[]::TEXT[];
