-- Cliente y vendedor son cuentas separadas (pedido del dueño, 2026-10-30, modelo Uber Eats): la misma persona puede tener
-- una cuenta de cliente y otra de negocio con el mismo correo, y nunca se unen. Ver src/lib/accountRealm.js.

-- 1) El correo deja de ser único en toda la tabla y pasa a serlo dentro de cada lado: entre clientes, y entre cuentas de
--    negocio (vendedor, personal de tienda, socio y admin). Prisma no describe índices parciales: viven solo aquí, y el
--    código busca con findFirst (nunca findUnique por correo).
DROP INDEX "User_email_key";
CREATE UNIQUE INDEX "User_email_customer_key" ON "User"("email") WHERE "role" = 'CUSTOMER';
CREATE UNIQUE INDEX "User_email_business_key" ON "User"("email") WHERE "role" <> 'CUSTOMER';

-- 2) Registro pendiente: uno por correo y por tipo (forStore = registro de tienda). Así un registro de cliente y uno de
--    tienda con el mismo correo no se pisan.
DROP INDEX "PendingRegistration_email_key";
CREATE UNIQUE INDEX "PendingRegistration_email_forStore_key" ON "PendingRegistration"("email", "forStore");

-- 3) Hasta ahora abrir una tienda convertía la cuenta de cliente en cuenta de vendedor, y sus compras quedaban en la misma
--    cuenta. A cada vendedor con algo de cliente (pedidos como comprador, direcciones, favoritos, reseñas, anuncios de venta
--    rápida, puntos, carrito, visitas, ofertas dirigidas, solicitudes de producto, interacciones con tiendas) se le crea su
--    cuenta de cliente con el mismo correo y la misma contraseña, y todo eso pasa a ella. Lo de la tienda (su tienda,
--    sesiones, notificaciones, reportes, soporte, mensajes del chat) se queda en la cuenta de vendedor.
--    La cuenta nueva no tiene dispositivo de confianza: la primera vez que entre como cliente se le pide el código del correo.
CREATE TEMP TABLE "_SplitAccount" AS
SELECT u."id" AS "vendorUserId", 'cs' || substr(md5(u."id" || ':customer-split'), 1, 23) AS "customerUserId"
FROM "User" u
WHERE u."role" = 'VENDOR'
  AND u."deletedAt" IS NULL
  AND (
       EXISTS (SELECT 1 FROM "Order" o WHERE o."customerId" = u."id")
    OR EXISTS (SELECT 1 FROM "Address" a WHERE a."userId" = u."id")
    OR EXISTS (SELECT 1 FROM "Favorite" f WHERE f."userId" = u."id")
    OR EXISTS (SELECT 1 FROM "Review" r WHERE r."userId" = u."id")
    OR EXISTS (SELECT 1 FROM "CustomerListing" l WHERE l."ownerId" = u."id")
    OR EXISTS (SELECT 1 FROM "LoyaltyAccount" la WHERE la."userId" = u."id")
    OR EXISTS (SELECT 1 FROM "CartSnapshot" c WHERE c."userId" = u."id")
  );

INSERT INTO "User" (
  "id", "email", "passwordHash", "role", "fullName", "phone", "address", "provinceId", "registrationCountryId",
  "registrationCountryOther", "municipalityId", "stateOther", "municipalityOther", "country", "marketingEmails", "createdAt"
)
SELECT s."customerUserId", u."email", u."passwordHash", 'CUSTOMER', u."fullName",
       -- Sin teléfono si ya lo usa otro cliente: el teléfono no se repite entre clientes (lib/phoneUniqueness.js).
       CASE WHEN EXISTS (SELECT 1 FROM "User" c WHERE c."role" = 'CUSTOMER' AND c."phone" = u."phone") THEN NULL ELSE u."phone" END,
       u."address", u."provinceId",
       u."registrationCountryId", u."registrationCountryOther", u."municipalityId", u."stateOther", u."municipalityOther",
       u."country", u."marketingEmails", NOW()
FROM "_SplitAccount" s
JOIN "User" u ON u."id" = s."vendorUserId";

UPDATE "Order" t SET "customerId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."customerId" = s."vendorUserId";
UPDATE "Address" t SET "userId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."userId" = s."vendorUserId";
UPDATE "Favorite" t SET "userId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."userId" = s."vendorUserId";
UPDATE "Review" t SET "userId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."userId" = s."vendorUserId";
UPDATE "CustomerListing" t SET "ownerId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."ownerId" = s."vendorUserId";
UPDATE "LoyaltyAccount" t SET "userId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."userId" = s."vendorUserId";
UPDATE "CartSnapshot" t SET "userId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."userId" = s."vendorUserId";
UPDATE "StoreVisit" t SET "userId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."userId" = s."vendorUserId";
UPDATE "TargetedOfferView" t SET "userId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."userId" = s."vendorUserId";
UPDATE "TargetedOffer" t SET "targetUserId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."targetUserId" = s."vendorUserId";
UPDATE "WinbackEmailLog" t SET "customerId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."customerId" = s."vendorUserId";
UPDATE "VendorEngagement" t SET "customerId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."customerId" = s."vendorUserId";
UPDATE "ProductRequest" t SET "customerId" = s."customerUserId" FROM "_SplitAccount" s WHERE t."customerId" = s."vendorUserId";

DROP TABLE "_SplitAccount";
