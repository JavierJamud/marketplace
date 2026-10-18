-- Instalaciones de las aplicaciones (Marketplace, Tienda, Admin). Cada app instalada guarda en el dispositivo un identificador
-- propio (installId) y avisa al servidor cada vez que se abre. Sirve para no ofrecer instalar a quien ya la tiene (sobre todo en
-- iPhone, donde Safari y la app instalada no comparten datos) y para saber si dejó de usarse (lastSeenAt viejo = probablemente
-- desinstalada). identityVersion es la versión del nombre y los íconos con que se instaló: si cambia, la app avisa de la novedad.
CREATE TABLE "AppInstall" (
  "id" TEXT NOT NULL,
  "installId" TEXT NOT NULL,
  "app" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "userId" TEXT,
  "userAgent" TEXT,
  "identityVersion" INTEGER NOT NULL DEFAULT 1,
  "firstSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppInstall_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "AppInstall_installId_app_key" ON "AppInstall"("installId", "app");
CREATE INDEX "AppInstall_userId_app_idx" ON "AppInstall"("userId", "app");
CREATE INDEX "AppInstall_lastSeenAt_idx" ON "AppInstall"("lastSeenAt");
ALTER TABLE "AppInstall" ADD CONSTRAINT "AppInstall_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
