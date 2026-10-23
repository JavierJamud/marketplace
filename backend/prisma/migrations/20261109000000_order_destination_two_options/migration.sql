-- Todo pedido entra siempre al panel de la tienda; WhatsApp es un extra que el cliente puede usar después de enviarlo.
-- Quedan dos opciones: PANEL (solo panel) y BOTH (panel y botón de WhatsApp). Las tiendas que tenían "Solo WhatsApp"
-- pasan a BOTH: el cliente sigue viendo el botón de WhatsApp como antes. Si su plan no permite WhatsApp, a PANEL.
-- El valor WHATSAPP sigue en el enum solo para los pedidos viejos (Order.notificationChannel guarda lo que había al pedir).
UPDATE "Vendor" v
SET "orderDestination" = CASE WHEN COALESCE(pc."allowWhatsappOrders", true) THEN 'BOTH'::"OrderDestination" ELSE 'PANEL'::"OrderDestination" END
FROM "Vendor" v2
LEFT JOIN "PlanConfig" pc ON pc."planType" = v2."planType"
WHERE v2.id = v.id AND v."orderDestination" = 'WHATSAPP';

ALTER TABLE "Vendor" ALTER COLUMN "orderDestination" SET DEFAULT 'BOTH';
ALTER TABLE "Order" ALTER COLUMN "notificationChannel" SET DEFAULT 'BOTH';

-- Correo a la tienda cuando un pedido lleva 30 minutos sin confirmar.
ALTER TYPE "EmailType" ADD VALUE 'ORDER_OVERDUE_VENDOR';
