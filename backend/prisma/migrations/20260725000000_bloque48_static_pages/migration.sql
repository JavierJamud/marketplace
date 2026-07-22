-- Bloque 48: páginas legales/ayuda editables desde el admin.
CREATE TABLE "StaticPage" (
    "slug" TEXT NOT NULL,
    "htmlContent" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "StaticPage_pkey" PRIMARY KEY ("slug")
);
