-- Bloque 231 (pedido explícito — "cuando un cliente envía un pedido se debe
-- llegar y notificar en tiempo real en el panel del vendedor"): antes crear
-- un pedido normal (no de mesa) no generaba ninguna VendorNotification.
ALTER TYPE "VendorNotificationType" ADD VALUE 'NEW_ORDER';
