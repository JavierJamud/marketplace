-- Planes configurables: precio por plan (CUP y USD), precio de lista tachado mientras es gratis, descuentos por meses,
-- plan destacado, insignia por plan y plan "por WhatsApp". Básico y Premium conservan los límites y funciones que ya tenían
-- configurados; Estándar y Empresarial se crean a partir de ellos para que cada plan siempre incluya lo del anterior.

ALTER TABLE "PlanConfig"
  ADD COLUMN "tagline" TEXT,
  ADD COLUMN "sortOrder" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "priceCup" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "priceUsd" DOUBLE PRECISION NOT NULL DEFAULT 0,
  ADD COLUMN "listPriceCup" INTEGER,
  ADD COLUMN "listPriceUsd" DOUBLE PRECISION,
  ADD COLUMN "isFree" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "contactOnly" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "highlighted" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "grantsBadge" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isPublic" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN "monthDiscounts" JSONB NOT NULL DEFAULT '[]';

ALTER TABLE "SiteSettings" ADD COLUMN "unpaidSuspendDays" INTEGER NOT NULL DEFAULT 30;

ALTER TABLE "SubscriptionPayment"
  ADD COLUMN "planType" "PlanType",
  ADD COLUMN "discountPercent" INTEGER;

ALTER TABLE "VerificationRequest"
  ADD COLUMN "paymentPlanType" "PlanType",
  ADD COLUMN "paymentDiscountPercent" INTEGER;

-- Descuentos iniciales por pagar varios meses juntos (el mismo % en CUP y en USD; se ajustan en el admin).
-- Básico: el gratis por ahora, con su precio real tachado.
UPDATE "PlanConfig" SET
  "displayName" = 'Básico', "tagline" = 'Para empezar a vender en línea', "sortOrder" = 1,
  "priceCup" = 700, "priceUsd" = 1.99, "listPriceCup" = 700, "listPriceUsd" = 1.99, "isFree" = true,
  "grantsBadge" = false, "highlighted" = false,
  "monthDiscounts" = '[{"months":3,"cup":5,"usd":5},{"months":6,"cup":10,"usd":10},{"months":12,"cup":20,"usd":20}]'
WHERE "planType" = 'REGULAR';

-- Premium: el plan de pago de siempre, ahora a 2500 CUP o 4,99 USD.
UPDATE "PlanConfig" SET
  "displayName" = 'Premium', "tagline" = 'Todo para vender más y crecer', "sortOrder" = 3,
  "priceCup" = 2500, "priceUsd" = 4.99, "isFree" = false, "grantsBadge" = true, "highlighted" = false,
  "monthDiscounts" = '[{"months":3,"cup":5,"usd":5},{"months":6,"cup":10,"usd":10},{"months":12,"cup":20,"usd":20}]'
WHERE "planType" = 'BUSINESS';

-- Estándar: copia las funciones de Premium y las recorta; cada límite nunca queda por debajo del de Básico.
INSERT INTO "PlanConfig" ("id", "planType", "displayName", "updatedAt")
VALUES ('plan_standard', 'STANDARD', 'Estándar', CURRENT_TIMESTAMP)
ON CONFLICT ("planType") DO NOTHING;

UPDATE "PlanConfig" s SET
  "allowStoreOffers" = b."allowStoreOffers", "allowDiscountCodes" = b."allowDiscountCodes", "allowQrTables" = b."allowQrTables",
  "allowStaffUsers" = b."allowStaffUsers", "allowAdminChat" = b."allowAdminChat", "allowReviewPhotos" = b."allowReviewPhotos",
  "allowSchedules" = b."allowSchedules", "allowPublicProfile" = b."allowPublicProfile", "allowWhatsappOrders" = b."allowWhatsappOrders",
  "allowPanelOrders" = b."allowPanelOrders", "allowPos" = b."allowPos", "allowCustomerEmails" = b."allowCustomerEmails",
  "allowAiChatbot" = false, "allowLoyalty" = false, "featuredInHome" = false
FROM "PlanConfig" b
WHERE s."planType" = 'STANDARD' AND b."planType" = 'BUSINESS';

UPDATE "PlanConfig" s SET
  "tagline" = 'Para el negocio que ya vende todos los días', "sortOrder" = 2,
  "priceCup" = 1200, "priceUsd" = 3.99, "isFree" = false, "grantsBadge" = true, "highlighted" = true,
  "monthDiscounts" = '[{"months":3,"cup":5,"usd":5},{"months":6,"cup":10,"usd":10},{"months":12,"cup":20,"usd":20}]',
  "features" = ARRAY['Sin comisiones por venta'],
  "maxProducts" = GREATEST(COALESCE(r."maxProducts", 0), 100),
  "maxProvinces" = GREATEST(COALESCE(r."maxProvinces", 0), 3),
  "maxDeliveryCountries" = GREATEST(COALESCE(r."maxDeliveryCountries", 0), 3),
  "maxMonthlyOrderEmails" = GREATEST(COALESCE(r."maxMonthlyOrderEmails", 0), 100),
  "maxStaffUsers" = GREATEST(COALESCE(r."maxStaffUsers", 0), 2),
  "maxTables" = GREATEST(COALESCE(r."maxTables", 0), 10),
  "maxActiveStoreOffers" = GREATEST(COALESCE(r."maxActiveStoreOffers", 0), 1),
  "maxDiscountCodes" = GREATEST(COALESCE(r."maxDiscountCodes", 0), 5)
FROM "PlanConfig" r
WHERE s."planType" = 'STANDARD' AND r."planType" = 'REGULAR';

-- Empresarial: todo lo de Premium, sin límites, y sin precio publicado (se contrata por WhatsApp).
INSERT INTO "PlanConfig" ("id", "planType", "displayName", "updatedAt")
VALUES ('plan_enterprise', 'ENTERPRISE', 'Empresarial', CURRENT_TIMESTAMP)
ON CONFLICT ("planType") DO NOTHING;

UPDATE "PlanConfig" e SET
  "tagline" = 'Para cadenas y negocios con mucho volumen', "sortOrder" = 4,
  "priceCup" = 0, "priceUsd" = 0, "isFree" = false, "contactOnly" = true, "grantsBadge" = true, "highlighted" = false,
  "features" = ARRAY['Acompañamiento personal del equipo', 'Configuración a la medida de tu negocio'],
  "maxProducts" = NULL, "maxProvinces" = NULL, "maxDeliveryCountries" = NULL, "maxMonthlyOrderEmails" = NULL,
  "maxStaffUsers" = NULL, "maxTables" = NULL, "maxActiveStoreOffers" = NULL, "maxDiscountCodes" = NULL,
  "allowAiChatbot" = true, "allowStoreOffers" = true, "allowDiscountCodes" = true, "allowQrTables" = true,
  "allowStaffUsers" = true, "allowAdminChat" = true, "allowReviewPhotos" = true, "allowSchedules" = true,
  "allowPublicProfile" = true, "allowWhatsappOrders" = true, "allowPanelOrders" = true, "featuredInHome" = true,
  "allowLoyalty" = true, "allowPos" = true, "allowCustomerEmails" = true
WHERE e."planType" = 'ENTERPRISE';
