-- Planes dinámicos: el admin podrá crear y archivar planes sin desplegar.
-- Decisión de diseño: no se crea un id nuevo para los planes. El enum PlanType pasa a TEXTO con el mismo valor y la clave
-- del plan es PlanConfig.planType (única). Las claves REGULAR, STANDARD, BUSINESS y ENTERPRISE se conservan tal cual, así
-- que ningún dato cambia y el código que compara cadenas sigue funcionando. Los planes nuevos reciben una clave estable
-- generada de su nombre (planKeyFromName en lib/planConfig.js, ej. PLAN_RESTAURANTE).

-- 1) PlanType deja de ser enum: todas las columnas que lo usaban pasan a TEXT con el mismo valor.
ALTER TABLE "PlanConfig" ALTER COLUMN "planType" TYPE TEXT USING "planType"::text;

-- El valor por defecto de Vendor está tipado con el enum: se quita antes de cambiar el tipo y se vuelve a poner como texto.
ALTER TABLE "Vendor" ALTER COLUMN "planType" DROP DEFAULT;
ALTER TABLE "Vendor" ALTER COLUMN "planType" TYPE TEXT USING "planType"::text;
ALTER TABLE "Vendor" ALTER COLUMN "planType" SET DEFAULT 'REGULAR';

ALTER TABLE "VerificationRequest" ALTER COLUMN "paymentPlanType" TYPE TEXT USING "paymentPlanType"::text;
ALTER TABLE "SubscriptionPayment" ALTER COLUMN "planType" TYPE TEXT USING "planType"::text;

-- Es parte de la clave primaria compuesta (partnerId, planType): Postgres reconstruye el índice de la PK al cambiar el
-- tipo, sin soltarla, y ninguna otra tabla apunta a esta PK.
ALTER TABLE "PartnerPlanPrice" ALTER COLUMN "planType" TYPE TEXT USING "planType"::text;

DROP TYPE "PlanType";

-- 2) Columnas nuevas de PlanConfig: los papeles que antes se deducían de la clave pasan a ser banderas.
ALTER TABLE "PlanConfig"
  ADD COLUMN "isDefault" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "isTrialPlan" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "customFeatures" JSONB NOT NULL DEFAULT '{}';

-- Por si a una base le faltara la fila de algún plan que ya usan tiendas o pagos (no debería: las migraciones anteriores
-- crean las cuatro), se crea oculta con su clave como nombre para que las claves foráneas de abajo no fallen y el admin la
-- vea y la configure.
INSERT INTO "PlanConfig" ("id", "planType", "displayName", "isPublic", "updatedAt")
SELECT 'plan_' || lower(s.k), s.k, s.k, false, CURRENT_TIMESTAMP
FROM (
  SELECT "planType" AS k FROM "Vendor"
  UNION SELECT "paymentPlanType" FROM "VerificationRequest"
  UNION SELECT "planType" FROM "SubscriptionPayment"
  UNION SELECT "planType" FROM "PartnerPlanPrice"
) s
WHERE s.k IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "PlanConfig" p WHERE p."planType" = s.k);

-- Hoy: el Básico es el plan de registro y de bajada; Premium es el de la prueba gratis.
UPDATE "PlanConfig" SET "isDefault" = true WHERE "planType" = 'REGULAR';
UPDATE "PlanConfig" SET "isTrialPlan" = true WHERE "planType" = 'BUSINESS';

-- Formato de la clave (el mismo que genera planKeyFromName) y papeles que no se pueden archivar.
ALTER TABLE "PlanConfig" ADD CONSTRAINT "PlanConfig_planType_format_check" CHECK ("planType" ~ '^[A-Z][A-Z0-9_]{0,29}$');
ALTER TABLE "PlanConfig" ADD CONSTRAINT "PlanConfig_default_not_archived_check" CHECK (NOT ("isDefault" AND "archivedAt" IS NOT NULL));
ALTER TABLE "PlanConfig" ADD CONSTRAINT "PlanConfig_trial_not_archived_check" CHECK (NOT ("isTrialPlan" AND "archivedAt" IS NOT NULL));

-- Como mucho un plan por defecto y un plan de prueba. Índices únicos parciales: Prisma no los describe (igual que
-- Product_vendorId_barcode_key). Para cambiar cuál es el plan por defecto, dentro de una transacción se apaga primero el
-- actual y después se enciende el nuevo.
CREATE UNIQUE INDEX "PlanConfig_single_default_key" ON "PlanConfig"("isDefault") WHERE "isDefault";
CREATE UNIQUE INDEX "PlanConfig_single_trial_key" ON "PlanConfig"("isTrialPlan") WHERE "isTrialPlan";

-- 3) Claves foráneas a PlanConfig(planType). ON UPDATE CASCADE por si algún día se corrige una clave; ON DELETE RESTRICT
-- porque los planes no se borran, se archivan (los pagos y cambios viejos siguen apuntando a su plan).
ALTER TABLE "Vendor" ADD CONSTRAINT "Vendor_planType_fkey" FOREIGN KEY ("planType") REFERENCES "PlanConfig"("planType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PartnerPlanPrice" ADD CONSTRAINT "PartnerPlanPrice_planType_fkey" FOREIGN KEY ("planType") REFERENCES "PlanConfig"("planType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VerificationRequest" ADD CONSTRAINT "VerificationRequest_paymentPlanType_fkey" FOREIGN KEY ("paymentPlanType") REFERENCES "PlanConfig"("planType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SubscriptionPayment" ADD CONSTRAINT "SubscriptionPayment_planType_fkey" FOREIGN KEY ("planType") REFERENCES "PlanConfig"("planType") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 4) Catálogo de funciones de los planes. Las filas 'flag' y 'limit' son las que el servidor sabe hacer cumplir
-- (FEATURE_REGISTRY en lib/planFeatures.js, que tiene estos mismos textos por defecto); las 'custom' las crea el admin.
CREATE TABLE "PlanFeature" (
    "key" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "group" TEXT NOT NULL DEFAULT 'Otras',
    "kind" TEXT NOT NULL,
    "column" TEXT,
    "requiresBadge" BOOLEAN NOT NULL DEFAULT false,
    "publicLabel" TEXT,
    "unlimitedLabel" TEXT,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlanFeature_pkey" PRIMARY KEY ("key"),
    CONSTRAINT "PlanFeature_key_format_check" CHECK ("key" ~ '^[A-Za-z][A-Za-z0-9_]{0,59}$'),
    CONSTRAINT "PlanFeature_kind_check" CHECK ("kind" IN ('flag', 'limit', 'custom')),
    CONSTRAINT "PlanFeature_group_check" CHECK ("group" IN ('Ventas', 'Equipo', 'Marketing', 'Visibilidad', 'Cobro', 'Otras')),
    -- Una personalizada no tiene columna (no se hace cumplir); una del registro siempre la tiene.
    CONSTRAINT "PlanFeature_column_check" CHECK (("kind" = 'custom') = ("column" IS NULL))
);

-- allowPanelOrders queda apagada: el servidor ya no la usa (todo pedido entra al panel en cualquier plan). La columna de
-- PlanConfig se conserva para no romper datos viejos.
INSERT INTO "PlanFeature" ("key", "label", "description", "group", "kind", "column", "requiresBadge", "publicLabel", "unlimitedLabel", "sortOrder", "isActive", "updatedAt") VALUES
  ('maxProducts', 'Productos publicados', 'Cuántos productos puede tener visibles al público a la vez. Se cumple al crear un producto y cada vez que uno se activa: los que pasan del tope quedan en el panel como ''Fuera del cupo'' y no se ven en la tienda. Al cambiar el tope se recalcula el cupo de todas las tiendas del plan. Vacío = ilimitado, 0 = ninguno.', 'Ventas', 'limit', 'maxProducts', false, 'Hasta {n} {producto publicado|productos publicados}', 'Productos ilimitados', 10, true, CURRENT_TIMESTAMP),
  ('maxProvinces', 'Provincias donde vende', 'En cuántas provincias distintas puede tener zonas de venta. Se cumple al agregar una zona en una provincia nueva; las que ya tenía no se quitan. Vacío = todas las provincias.', 'Ventas', 'limit', 'maxProvinces', false, 'Vende en hasta {n} {provincia|provincias}', 'Vende en todas las provincias', 20, true, CURRENT_TIMESTAMP),
  ('maxDeliveryCountries', 'Países de entrega', 'A cuántos países puede enviar pedidos. Se cumple al agregar un país de entrega. Vacío = sin tope (y no se anuncia en la página de planes).', 'Ventas', 'limit', 'maxDeliveryCountries', false, 'Envíos a hasta {n} {país|países}', NULL, 30, true, CURRENT_TIMESTAMP),
  ('allowWhatsappOrders', 'Pedido también por WhatsApp', 'Todo pedido entra al panel en cualquier plan. Con esto encendido la tienda puede ofrecer además el botón para que el cliente le mande el pedido por WhatsApp. Al apagarlo, las tiendas del plan pasan a recibir solo en el panel.', 'Ventas', 'flag', 'allowWhatsappOrders', false, 'Pedido también por WhatsApp', NULL, 40, true, CURRENT_TIMESTAMP),
  ('allowPos', 'Caja (punto de venta)', 'Caja con código de barras: ventas de mostrador, pantalla para el cliente, tablero de pedidos y movimientos de dinero. Sin esto la caja no abre y los enlaces de las pantallas dejan de funcionar.', 'Ventas', 'flag', 'allowPos', false, 'Caja con código de barras', NULL, 50, true, CURRENT_TIMESTAMP),
  ('allowAiChatbot', 'Chat con IA en la tienda', 'Asistente con IA que responde a los clientes en la tienda y en sus productos. Solo funciona si además la tienda está verificada.', 'Ventas', 'flag', 'allowAiChatbot', true, 'Chat con IA en tu tienda', NULL, 60, true, CURRENT_TIMESTAMP),
  ('allowStaffUsers', 'Usuarios del equipo', 'La tienda puede crear usuarios para su personal. Si se apaga, el personal ya creado tampoco puede entrar al panel de la tienda.', 'Equipo', 'flag', 'allowStaffUsers', false, NULL, NULL, 70, true, CURRENT_TIMESTAMP),
  ('maxStaffUsers', 'Tope de usuarios del equipo', 'Cuántos usuarios del equipo puede crear. Se cumple al crear uno nuevo. Vacío = ilimitado.', 'Equipo', 'limit', 'maxStaffUsers', false, 'Hasta {n} {usuario del sistema|usuarios del sistema}', 'Usuarios del sistema ilimitados', 71, true, CURRENT_TIMESTAMP),
  ('allowQrTables', 'Mesas con QR (restaurantes)', 'Mesas con código QR: el cliente pide desde su mesa y la caja puede pasar ventas a una mesa. Sin esto no se crean mesas y los QR ya impresos dejan de aceptar pedidos.', 'Ventas', 'flag', 'allowQrTables', false, NULL, NULL, 80, true, CURRENT_TIMESTAMP),
  ('maxTables', 'Tope de mesas', 'Cuántas mesas puede tener. Se cumple al crear una mesa y al registrar un restaurante. Vacío = ilimitado.', 'Ventas', 'limit', 'maxTables', false, 'Menú con QR para hasta {n} {mesa|mesas}', 'Menú con QR para mesas', 81, true, CURRENT_TIMESTAMP),
  ('allowDiscountCodes', 'Códigos de descuento', 'La tienda puede crear códigos de descuento. Si se apaga, el carrito rechaza sus códigos (se conservan, sin aplicarse) y sus ofertas de tienda se apagan, porque cada oferta usa un código.', 'Marketing', 'flag', 'allowDiscountCodes', false, NULL, NULL, 90, true, CURRENT_TIMESTAMP),
  ('maxDiscountCodes', 'Tope de códigos de descuento', 'Cuántos códigos de descuento puede tener. Se cumple al crear uno nuevo. Vacío = ilimitado.', 'Marketing', 'limit', 'maxDiscountCodes', false, 'Hasta {n} {código de descuento|códigos de descuento}', 'Códigos de descuento', 91, true, CURRENT_TIMESTAMP),
  ('allowStoreOffers', 'Ofertas de tienda', 'Ofertas visibles en la tienda pública, cada una con su código. Exige también ''Códigos de descuento'' y que la tienda esté verificada. Si se apaga, las ofertas encendidas de las tiendas del plan se apagan.', 'Marketing', 'flag', 'allowStoreOffers', true, NULL, NULL, 100, true, CURRENT_TIMESTAMP),
  ('maxActiveStoreOffers', 'Tope de ofertas encendidas', 'Cuántas ofertas de tienda puede tener encendidas a la vez. Se cumple al encender una; si se baja el tope, se apagan las más viejas. Vacío = ilimitado.', 'Marketing', 'limit', 'maxActiveStoreOffers', false, 'Hasta {n} {oferta de tienda activa|ofertas de tienda activas}', 'Ofertas de tienda', 101, true, CURRENT_TIMESTAMP),
  ('allowLoyalty', 'Programa de puntos', 'La tienda puede encender su programa de puntos para clientes. Si el plan no lo incluye, los clientes no ganan ni canjean puntos en esa tienda.', 'Marketing', 'flag', 'allowLoyalty', false, 'Programa de puntos para tus clientes', NULL, 110, true, CURRENT_TIMESTAMP),
  ('allowCustomerEmails', 'Correos a clientes', 'Correos con el nombre de la tienda a sus clientes (pedidos, mensajes, facturas, garantías, reseñas, recordatorios) y avisos automáticos de gestión (stock bajo, cierre de caja). Los correos de seguridad y de cuenta salen siempre.', 'Marketing', 'flag', 'allowCustomerEmails', false, NULL, NULL, 120, true, CURRENT_TIMESTAMP),
  ('maxMonthlyOrderEmails', 'Correos escritos a mano por mes', 'Cuántos correos puede escribir la tienda a mano desde un pedido cada mes. Los correos automáticos no cuentan. Vacío = ilimitado.', 'Marketing', 'limit', 'maxMonthlyOrderEmails', false, 'Correos a tus clientes (hasta {n} al mes)', 'Correos a tus clientes con el nombre de tu tienda', 121, true, CURRENT_TIMESTAMP),
  ('allowSchedules', 'Horario de atención', 'La tienda puede guardar su horario de atención para que los clientes lo vean.', 'Visibilidad', 'flag', 'allowSchedules', false, 'Horario de atención', NULL, 130, true, CURRENT_TIMESTAMP),
  ('allowReviewPhotos', 'Fotos en las reseñas', 'Los clientes pueden adjuntar fotos a las reseñas de la tienda. Solo funciona si además la tienda está verificada.', 'Visibilidad', 'flag', 'allowReviewPhotos', true, 'Reseñas con fotos', NULL, 140, true, CURRENT_TIMESTAMP),
  ('allowAdminChat', 'Chat con el equipo de la plataforma', 'La tienda puede escribir al equipo de la plataforma desde su panel. Solo funciona si además la tienda está verificada.', 'Otras', 'flag', 'allowAdminChat', true, 'Chat con el equipo de la plataforma', NULL, 150, true, CURRENT_TIMESTAMP),
  ('featuredInHome', 'Destacada en la portada', 'Los productos de la tienda reciben un empujón en la portada y en la búsqueda (menor que el destacado a mano del admin). Solo funciona si además la tienda está verificada.', 'Visibilidad', 'flag', 'featuredInHome', true, 'Destacada en la portada', NULL, 160, true, CURRENT_TIMESTAMP),
  ('allowPublicProfile', 'Opción de tienda privada', 'La tienda puede marcarse como privada: no aparece en búsquedas ni listados y solo se entra con su enlace. Sin esto, al guardar su perfil queda siempre pública.', 'Visibilidad', 'flag', 'allowPublicProfile', false, 'Opción de tienda privada (solo con tu enlace)', NULL, 170, true, CURRENT_TIMESTAMP),
  ('allowPanelOrders', 'Pedidos en el panel (sin uso)', 'Ya no se usa: todo pedido entra al panel de la tienda en cualquier plan.', 'Ventas', 'flag', 'allowPanelOrders', false, NULL, NULL, 900, false, CURRENT_TIMESTAMP)
ON CONFLICT ("key") DO NOTHING;

-- 5) Historial de cambios de plan de cada tienda: de aquí salen las altas y bajas de cada plan en las estadísticas. No se
-- rellena hacia atrás: antes de esta migración no hay forma fiable de saber cuándo cambió cada tienda de plan.
CREATE TABLE "VendorPlanChange" (
    "id" TEXT NOT NULL,
    "vendorId" TEXT NOT NULL,
    "fromPlan" TEXT,
    "toPlan" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "VendorPlanChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VendorPlanChange_toPlan_createdAt_idx" ON "VendorPlanChange"("toPlan", "createdAt");
CREATE INDEX "VendorPlanChange_fromPlan_createdAt_idx" ON "VendorPlanChange"("fromPlan", "createdAt");
CREATE INDEX "VendorPlanChange_vendorId_idx" ON "VendorPlanChange"("vendorId");

ALTER TABLE "VendorPlanChange" ADD CONSTRAINT "VendorPlanChange_vendorId_fkey" FOREIGN KEY ("vendorId") REFERENCES "Vendor"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "VendorPlanChange" ADD CONSTRAINT "VendorPlanChange_fromPlan_fkey" FOREIGN KEY ("fromPlan") REFERENCES "PlanConfig"("planType") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "VendorPlanChange" ADD CONSTRAINT "VendorPlanChange_toPlan_fkey" FOREIGN KEY ("toPlan") REFERENCES "PlanConfig"("planType") ON DELETE RESTRICT ON UPDATE CASCADE;
