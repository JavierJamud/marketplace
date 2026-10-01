-- Bloque 52: tabla propia por plan, reemplaza las columnas pareadas Regular/
-- Business de SiteSettings — con ~20 ajustes por plan, seguir pareando
-- columnas sería inmanejable. Seedea con los valores EFECTIVOS de hoy
-- (defaults viejos de SiteSettings + lo que hasta ahora era código
-- hardcodeado) para que ninguna tienda cambie de capacidades al desplegar.
CREATE TABLE "PlanConfig" (
    "id" TEXT NOT NULL,
    "planType" "PlanType" NOT NULL,
    "displayName" TEXT NOT NULL,
    "features" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
    "maxProducts" INTEGER,
    "maxProvinces" INTEGER,
    "maxDeliveryCountries" INTEGER,
    "maxMonthlyOrderEmails" INTEGER,
    "maxStaffUsers" INTEGER,
    "maxTables" INTEGER,
    "maxActiveStoreOffers" INTEGER,
    "maxDiscountCodes" INTEGER,
    "allowAiChatbot" BOOLEAN NOT NULL DEFAULT true,
    "allowHomeOffers" BOOLEAN NOT NULL DEFAULT true,
    "allowStoreOffers" BOOLEAN NOT NULL DEFAULT true,
    "allowDiscountCodes" BOOLEAN NOT NULL DEFAULT true,
    "allowQrTables" BOOLEAN NOT NULL DEFAULT true,
    "allowStaffUsers" BOOLEAN NOT NULL DEFAULT true,
    "allowAdminChat" BOOLEAN NOT NULL DEFAULT true,
    "allowReviewPhotos" BOOLEAN NOT NULL DEFAULT true,
    "allowSchedules" BOOLEAN NOT NULL DEFAULT true,
    "allowPublicProfile" BOOLEAN NOT NULL DEFAULT true,
    "allowWhatsappOrders" BOOLEAN NOT NULL DEFAULT true,
    "allowPanelOrders" BOOLEAN NOT NULL DEFAULT true,
    "featuredInHome" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "PlanConfig_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PlanConfig_planType_key" ON "PlanConfig"("planType");

-- Plan Regular: mismos valores que REGULAR_PLAN_PRODUCT_LIMIT=20
-- (products.controller.js) y REGULAR_MONTHLY_EMAIL_LIMIT=10
-- (orders.controller.js), antes hardcodeados — y los que ya eran
-- configurables en SiteSettings. Las funciones que hoy dependían SOLO de
-- verificationStatus (chatbot, ofertas, destacado, etc.) quedan en false acá
-- porque ninguna tienda Regular llegaba a VERIFIED en la práctica (el admin
-- solo otorga BUSINESS junto con la verificación) — comportamiento idéntico
-- al de hoy, ver isPremiumActive en lib/planConfig.js.
INSERT INTO "PlanConfig" (
  "id", "planType", "displayName", "features",
  "maxProducts", "maxProvinces", "maxDeliveryCountries", "maxMonthlyOrderEmails",
  "maxActiveStoreOffers",
  "allowAiChatbot", "allowHomeOffers", "allowStoreOffers", "allowDiscountCodes",
  "allowQrTables", "allowStaffUsers", "allowAdminChat", "allowReviewPhotos",
  "allowSchedules", "allowPublicProfile", "allowWhatsappOrders", "allowPanelOrders",
  "featuredInHome", "updatedAt"
)
SELECT
  'plan_regular', 'REGULAR', 'Regular',
  COALESCE((SELECT "planFeaturesRegular" FROM "SiteSettings" LIMIT 1),
    ARRAY['Hasta 20 productos','Pedidos por WhatsApp','Perfil de tienda público','Sin comisiones por venta']),
  20,
  COALESCE((SELECT "maxProvincesRegular" FROM "SiteSettings" LIMIT 1), 1),
  COALESCE((SELECT "maxDeliveryCountriesRegular" FROM "SiteSettings" LIMIT 1), 1),
  10,
  COALESCE((SELECT "maxActiveStoreOffersPerVendor" FROM "SiteSettings" LIMIT 1), 1),
  false, false, false, true, true, true, false, false, true, true, true, true, false,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PlanConfig" WHERE "planType" = 'REGULAR');

-- Plan Premium (BUSINESS en la base, ver nota en schema.prisma): todo
-- ilimitado/habilitado, mismo comportamiento de siempre.
INSERT INTO "PlanConfig" (
  "id", "planType", "displayName", "features",
  "maxProducts", "maxProvinces", "maxDeliveryCountries", "maxMonthlyOrderEmails",
  "maxActiveStoreOffers",
  "allowAiChatbot", "allowHomeOffers", "allowStoreOffers", "allowDiscountCodes",
  "allowQrTables", "allowStaffUsers", "allowAdminChat", "allowReviewPhotos",
  "allowSchedules", "allowPublicProfile", "allowWhatsappOrders", "allowPanelOrders",
  "featuredInHome", "updatedAt"
)
SELECT
  'plan_business', 'BUSINESS', 'Premium',
  COALESCE((SELECT "planFeaturesBusiness" FROM "SiteSettings" LIMIT 1),
    ARRAY['Productos ilimitados','Sello de tienda verificada','Destacada en la home','Recomendaciones con IA','Horarios de atención']),
  NULL,
  (SELECT "maxProvincesBusiness" FROM "SiteSettings" LIMIT 1),
  COALESCE((SELECT "maxDeliveryCountriesBusiness" FROM "SiteSettings" LIMIT 1), 5),
  NULL,
  COALESCE((SELECT "maxActiveStoreOffersPerVendor" FROM "SiteSettings" LIMIT 1), 1),
  true, true, true, true, true, true, true, true, true, true, true, true, true,
  CURRENT_TIMESTAMP
WHERE NOT EXISTS (SELECT 1 FROM "PlanConfig" WHERE "planType" = 'BUSINESS');

-- Columnas que PlanConfig reemplaza — ya migradas arriba.
ALTER TABLE "SiteSettings"
  DROP COLUMN "maxDeliveryCountriesRegular",
  DROP COLUMN "maxDeliveryCountriesBusiness",
  DROP COLUMN "maxProvincesRegular",
  DROP COLUMN "maxProvincesBusiness",
  DROP COLUMN "planFeaturesRegular",
  DROP COLUMN "planFeaturesBusiness",
  DROP COLUMN "maxActiveStoreOffersPerVendor";

-- Teléfono de pago CUP (pedido explícito) — opcional, igual que el resto de
-- los datos bancarios de la transferencia.
ALTER TABLE "SiteSettings" ADD COLUMN "cupBankPhone" TEXT;

-- Bloque 52: cupo de productos cuando el admin baja maxProducts por debajo
-- de lo que una tienda ya tenía publicado — ver recalcVendorProductQuota en
-- lib/planConfig.js. false = dentro del cupo (visible en la web pública),
-- true = excedente (sigue existiendo y el vendedor lo ve en su panel, pero
-- no sale en ningún listado público) hasta que el vendedor intercambie cuál
-- producto ocupa el cupo.
ALTER TABLE "Product" ADD COLUMN "overQuota" BOOLEAN NOT NULL DEFAULT false;
