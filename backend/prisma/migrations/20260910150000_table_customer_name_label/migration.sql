-- Bloque 141 (pedido explícito): sistema de mesas/QR de restaurante — el
-- pedido de mesa pasa a pedir el NOMBRE del cliente en vez de su correo
-- ("el cliente solo debe poner su nombre y más nada, ya que los demás
-- datos no son necesarios"). customerName nullable a nivel de columna
-- (compatibilidad con pedidos de mesa viejos, ya creados sin este campo)
-- pero obligatorio a nivel de zod para cualquier pedido nuevo (ver
-- createTableOrderSchema, tables.controller.js) — mismo criterio exacto
-- que ya usa customerEmail (columna nullable + obligatorio en el schema de
-- validación cuando corresponde). customerEmail pasa a ser 100% opcional
-- en el formulario público (TableOrder.jsx) — ya era nullable acá, no
-- hace falta tocar la columna.
ALTER TABLE "TableOrder" ADD COLUMN "customerName" TEXT;

-- Nombre propio opcional por mesa (ej. "Terraza 1", "Mesa VIP") — si el
-- vendedor no lo carga, se sigue mostrando "Mesa {tableNumber}" como
-- siempre (ver VendorTables.jsx/TableOrder.jsx).
ALTER TABLE "Table" ADD COLUMN "label" TEXT;
