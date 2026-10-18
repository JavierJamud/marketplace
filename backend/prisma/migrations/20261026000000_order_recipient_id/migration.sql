-- Pedido para otra persona: además de nombre y teléfono, su documento de identidad (la tienda lo comprueba al entregar).
-- recipientIdType: CU_ID (carné de identidad cubano, 11 dígitos con fecha de nacimiento válida) u OTHER (pasaporte u otro
-- documento, 6 a 20 letras o números).
ALTER TABLE "Order" ADD COLUMN "recipientIdType" TEXT, ADD COLUMN "recipientIdNumber" TEXT;
