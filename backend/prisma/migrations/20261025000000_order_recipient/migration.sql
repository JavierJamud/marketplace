-- Pedido: quien compra puede no ser quien recibe (por ejemplo, alguien fuera de Cuba que compra para su familia). Nombre y
-- teléfono de la persona que recibe la entrega; vacíos cuando recibe la misma persona que compra.
ALTER TABLE "Order" ADD COLUMN "recipientName" TEXT, ADD COLUMN "recipientPhone" TEXT;
